import { useRef, useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { n } from '../../../services/planHelpers';
import config from '../../../services/config';
import ImageField from '../ImageField';
import { usePresence, ROLE_ICONS } from '../../../hooks/usePresence';
import { dbGetAllAuditLog, dbGetAllDeliveryStatus, dbGetAllSnapshots, dbInsertAuditBulk, dbUpsertDeliveryRows, dbUpsertSnapshotsBulk } from '../../../services/db';
import { setTheme as saveMyTheme } from '../../../services/userPrefs';

const PREMIUM_LOCKABLE_PAGES = [
  ['notes', 'Notas'], ['payroll', 'Sueldos'], ['inventory', 'Inventario'], ['audit', 'Auditoría'],
  ['metrics', 'Métricas'], ['weeklySchedule', 'Horario semanal (Clientes)'], ['returnDate', 'Reactivación automática por fecha'],
  ['specialDietPrint', 'Exportar dietas especiales'], ['clientPortal', 'Portal de clientes'],
];

export default function SettingsPage({ user, theme, onThemeChange }) {
  const {
    settings, saveSettings, serverToday, showNotice,
    clients, notes, plans, days, drivers, routes, staffUsers, currentDate, inventory,
    saveClients, saveNotes, saveDays,
    saveDrivers: saveDrivers2, saveRoutes: saveRoutes2, savePlans: savePlans2, saveStaffUsers: saveStaffUsers2,
  } = useOperations();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const [premiumDays, setPremiumDays] = useState('');
  const [exportScope, setExportScope] = useState('all');
  const [working, setWorking] = useState(false);
  const importInputRef = useRef(null);
  const { counts, detail } = usePresence();

  function handleThemeChange(value) {
    saveMyTheme(user.id, value); // cachea local al instante + sincroniza con la cuenta en Supabase
    onThemeChange(value);
  }

  function field(key, transform = (v) => v) {
    return {
      value: settings[key] ?? '',
      onBlur: (e) => saveSettings({ ...settings, [key]: transform(e.target.value) }),
    };
  }

  function activatePremium(untilDate) {
    saveSettings({ ...settings, plan: 'premium', premiumUntil: untilDate || '' });
  }
  function activateBasic() {
    if (!confirm('¿Volver al plan Básico? El equipo perderá acceso a las funciones Premium.')) return;
    saveSettings({ ...settings, plan: 'basico', premiumUntil: '' });
  }
  function activatePremiumDays() {
    const days = n(premiumDays);
    if (days <= 0) return;
    const until = new Date(serverToday + 'T00:00:00Z');
    until.setUTCDate(until.getUTCDate() + days);
    activatePremium(until.toISOString().slice(0, 10));
  }
  function togglePremiumPage(key, checked) {
    saveSettings({ ...settings, premiumLockedPages: { ...settings.premiumLockedPages, [key]: checked } });
  }

  const isPremium = settings.plan === 'premium';
  const daysLeft = isPremium && settings.premiumUntil ? Math.max(0, Math.ceil((new Date(settings.premiumUntil) - new Date(serverToday)) / 86400000)) : null;

  function downloadJson(data, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function handleExport() {
    if (exportScope !== 'all') {
      const scopes = {
        clientes: { data: { clients, plans, days, currentDate }, label: 'clientes' },
        personal: { data: { drivers, routes, settings, staffUsers }, label: 'personal' },
        inventario: { data: { inventory }, label: 'inventario' },
      };
      const chosen = scopes[exportScope];
      downloadJson(chosen.data, `catering-${chosen.label}-${serverToday}.json`);
      return;
    }
    setWorking(true);
    showNotice('Preparando respaldo completo (incluye auditoría, despachos y snapshots de los últimos 2 años)…');
    const cutoff = new Date(serverToday + 'T00:00:00');
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const [auditLog, deliveryStatus, snapshots] = await Promise.all([
      dbGetAllAuditLog(cutoffDate),
      dbGetAllDeliveryStatus(cutoffDate),
      dbGetAllSnapshots(cutoffDate),
    ]);
    const trimmedDays = Object.fromEntries(Object.entries(days || {}).filter(([d]) => d >= cutoffDate));
    const data = { clients, plans, days: trimmedDays, currentDate, drivers, routes, settings, staffUsers, notes, inventory, auditLog: auditLog || [], deliveryStatus: deliveryStatus || [], snapshots: snapshots || [] };
    downloadJson(data, `catering-respaldo-completo-${serverToday}.json`);
    showNotice('Respaldo completo descargado (últimos 2 años).');
    setWorking(false);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      e.target.value = '';
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch (_) { showNotice('El archivo no es un JSON válido.', true); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { showNotice('El archivo no tiene el formato esperado.', true); return; }

      const knownKeys = ['clients', 'plans', 'days', 'currentDate', 'drivers', 'routes', 'settings', 'inventory', 'notes'];
      const foundKeys = knownKeys.filter((k) => k in parsed);
      const hasStaffUsers = Array.isArray(parsed.staffUsers) && parsed.staffUsers.length > 0;
      const hasAuditLog = Array.isArray(parsed.auditLog) && parsed.auditLog.length > 0;
      const hasDeliveryStatus = Array.isArray(parsed.deliveryStatus) && parsed.deliveryStatus.length > 0;
      const hasSnapshots = Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0;
      if (!foundKeys.length && !hasStaffUsers && !hasAuditLog && !hasDeliveryStatus && !hasSnapshots) { showNotice('El archivo no contiene datos reconocibles de Catering Control.', true); return; }

      const resumen = [...foundKeys, ...(hasStaffUsers ? ['staffUsers'] : []), ...(hasAuditLog ? ['auditoría'] : []), ...(hasDeliveryStatus ? ['despachos'] : []), ...(hasSnapshots ? ['snapshots'] : [])].join(', ');
      if (!confirm(`Vas a restaurar: ${resumen}.\n\nEsto reemplaza esos datos en este dispositivo y, al guardar, también en Supabase (para los demás dispositivos). ¿Continuar?`)) return;

      setWorking(true);
      if (Array.isArray(parsed.clients) && parsed.clients.length) saveClients(parsed.clients);
      if (Array.isArray(parsed.notes) && parsed.notes.length) saveNotes(parsed.notes);
      if (parsed.days) saveDays(parsed.days);
      if (parsed.drivers) saveDrivers2(parsed.drivers);
      if (parsed.routes) saveRoutes2(parsed.routes);
      if (parsed.plans) savePlans2(parsed.plans);
      if (parsed.settings) saveSettings({ ...settings, ...parsed.settings });
      if (hasStaffUsers) saveStaffUsers2(parsed.staffUsers);
      const [okAudit, okDelivery, okSnapshots] = await Promise.all([
        hasAuditLog ? dbInsertAuditBulk(parsed.auditLog) : Promise.resolve(true),
        hasDeliveryStatus ? dbUpsertDeliveryRows(parsed.deliveryStatus.map((d) => ({ date: d.date, clientId: d.clientId, payload: d.payload }))) : Promise.resolve(true),
        hasSnapshots ? dbUpsertSnapshotsBulk(parsed.snapshots) : Promise.resolve(true),
      ]);
      setWorking(false);
      const ok = okAudit && okDelivery && okSnapshots;
      showNotice(ok ? 'Respaldo restaurado.' : 'Se restauró parcialmente: algo falló al guardar auditoría/despachos/snapshots.', !ok);
    };
    reader.readAsText(file);
  }

  return (
    <section className="page active">
      <div className="page-head"><div><h1>Configuración</h1><p>Preferencias visuales y datos de la empresa.</p></div></div>

      <div className="two-col">
        <div className="card card-pad stack">
          <h3>Tu tema</h3>
          <p className="muted">Es personal tuyo (no afecta a los demás usuarios) y viaja con tu cuenta: si entrás desde otro celular o computadora, vas a ver este mismo tema.</p>
          <label>Tema
            <select value={theme} onChange={(e) => handleThemeChange(e.target.value)}>
              <option value="light">Claro</option>
              <option value="night">Nocturno</option>
              <option value="forest">Bosque</option>
            </select>
          </label>
          <p className="muted" style={{ fontSize: 12 }}>El orden, ancho y columnas ocultas que elijas en las tablas (Día de trabajo, Clientes, Drivers, etc.) también viajan con tu cuenta de la misma forma.</p>
        </div>

        {isAdmin && (
          <div className="card card-pad stack">
            <h3>Empresa</h3>
            <label>Nombre de la empresa<input defaultValue={settings.companyName} placeholder={config.companyName} onBlur={(e) => saveSettings({ ...settings, companyName: e.target.value })} /></label>
            <ImageField label="Logo" name="_logo" value={settings.logoUrl} onChange={(url) => saveSettings({ ...settings, logoUrl: url })} folder="branding" maxDim={300} />
            <label>Número de WhatsApp<input defaultValue={settings.whatsappNumber} placeholder="Ej: 59171234567" onBlur={(e) => saveSettings({ ...settings, whatsappNumber: e.target.value.replace(/\D/g, '') })} /></label>
            <p className="muted" style={{ marginTop: -6 }}>Solo números, con código de país. Se usa en los botones de contacto del portal del cliente.</p>
            <label>Link de Instagram<input defaultValue={settings.instagramUrl} placeholder="https://instagram.com/tu_empresa" onBlur={(e) => saveSettings({ ...settings, instagramUrl: e.target.value.trim() })} /></label>
            <label>Usuario de Instagram (@handle)<input defaultValue={settings.instagramHandle} placeholder="@tu_empresa" onBlur={(e) => saveSettings({ ...settings, instagramHandle: e.target.value.trim() })} /></label>
            <ImageField label="Imagen publicitaria (banner del portal de clientes)" name="_ad" value={settings.adImageUrl} onChange={(url) => saveSettings({ ...settings, adImageUrl: url })} folder="branding" maxDim={800} />
            <ImageField label="QR de pago (para renovar/cambiar de plan desde el portal)" name="_qr" value={settings.paymentQrUrl} onChange={(url) => saveSettings({ ...settings, paymentQrUrl: url })} folder="branding" maxDim={500} />
          </div>
        )}

        {isAdmin && (
          <div className="card card-pad stack">
            <h3>Aviso de renovación</h3>
            <p className="muted">Cuando a un cliente le queden estos días o menos, verá un cartel invitándolo a renovar su plan.</p>
            <label>Días restantes para mostrar el aviso<input type="number" min="0" max="30" defaultValue={n(settings.renewalWarningDays)} onBlur={(e) => saveSettings({ ...settings, renewalWarningDays: Math.max(0, n(e.target.value)) })} /></label>
          </div>
        )}

        {isSuperAdmin && (
          <div className="card card-pad stack">
            <h3>Plan de la cuenta</h3>
            <p className="muted">En Básico, algunas pantallas quedan bloqueadas (lista abajo). Elegí una opción:</p>
            <label>Tu WhatsApp (para que el equipo te contacte si quiere activar Premium)
              <input defaultValue={settings.premiumWhatsapp} placeholder="Ej: 59171234567" onBlur={(e) => saveSettings({ ...settings, premiumWhatsapp: e.target.value.replace(/\D/g, '') })} />
            </label>
            <div className="plan-options">
              <button
                type="button"
                className={`plan-option ${isPremium && !settings.premiumUntil ? 'is-active' : 'is-inactive'}`}
                onClick={() => activatePremium('')}
                disabled={isPremium && !settings.premiumUntil}
              >
                <span>Premium sin vencimiento</span>
                {isPremium && !settings.premiumUntil && <span className="plan-option-tag">Activo</span>}
              </button>

              <div className={`plan-option plan-option-days ${isPremium && settings.premiumUntil ? 'is-active' : 'is-inactive'}`}>
                <span>Premium por días</span>
                <input type="number" min="1" placeholder="Días" value={premiumDays} onChange={(e) => setPremiumDays(e.target.value)} />
                <button type="button" onClick={activatePremiumDays}>Activar</button>
                {isPremium && settings.premiumUntil && <span className="plan-option-tag">Vence {settings.premiumUntil.split('-').reverse().join('/')} · {daysLeft}d</span>}
              </div>

              <button type="button" className={`plan-option ${!isPremium ? 'is-active' : 'is-inactive'}`} onClick={activateBasic} disabled={!isPremium}>
                <span>Básico</span>
                {!isPremium && <span className="plan-option-tag">Activo</span>}
              </button>
            </div>
            <h3 style={{ marginTop: 10 }}>Qué menús requieren Premium</h3>
            <div className="toggle-list-col">
              {PREMIUM_LOCKABLE_PAGES.map(([key, label]) => (
                <label key={key}><input type="checkbox" checked={!!settings.premiumLockedPages?.[key]} onChange={(e) => togglePremiumPage(key, e.target.checked)} /> {label}</label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="two-col" style={{ marginTop: 18 }}>
        <div className="card card-pad stack">
          <h3>Conectados ahora</h3>
          <div className="summary-grid compact" style={{ marginBottom: 4 }}>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>Clientes</div><strong>{counts.cliente}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>Drivers</div><strong>{counts.driver}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>Personal</div><strong>{counts.staff}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>Total</div><strong>{counts.total}</strong></div>
          </div>
          {detail.length ? (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {detail.map((m, i) => (
                <div key={i} className="presence-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', padding: '8px 4px', borderBottom: '1px solid var(--panel-line)' }}>
                  <span style={{ flex: '0 1 auto' }}>{ROLE_ICONS[m.role] || '●'} {m.role === 'cliente' ? 'Cliente' : m.role === 'driver' ? 'Driver' : 'Personal'}</span>
                  <b style={{ flex: '1 1 90px' }}>{m.name || '(sin nombre)'}</b>
                  <span className="muted" style={{ fontSize: 12, flex: '1 1 80px' }}>{m.device || ''}</span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, flex: '0 0 auto' }}>{m.at ? `desde ${new Date(m.at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ marginTop: 8 }}>Nadie conectado ahora mismo.</p>}
        </div>

        {isAdmin && (
          <div className="card card-pad stack">
            <h3>Respaldo</h3>
            <p className="muted">Descarga una copia de los datos, o restaura un respaldo guardado antes.</p>
            <label>Qué exportar
              <select value={exportScope} onChange={(e) => setExportScope(e.target.value)}>
                <option value="all">Todo (incluye auditoría, despachos y snapshots de 2 años)</option>
                <option value="clientes">Solo clientes/planes/calendario</option>
                <option value="personal">Solo drivers/rutas/configuración/usuarios</option>
                <option value="inventario">Solo inventario</option>
              </select>
            </label>
            <button type="button" className="info" onClick={handleExport} disabled={working}>{working ? 'Preparando…' : 'Descargar respaldo (JSON)'}</button>
            <button type="button" className="warning" onClick={() => importInputRef.current?.click()} disabled={working}>Restaurar desde un archivo</button>
            <input ref={importInputRef} type="file" accept="application/json" hidden onChange={handleImportFile} />
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 18 }}>
        Pendiente para una próxima parte: mapa con ruta real por calles y GPS en vivo del driver en Despacho, y foto de respaldo al marcar una entrega.
      </p>
    </section>
  );
}

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { useCompanyPrefs } from '../../../context/CompanyPrefsContext';
import { SUPPORTED_LANGUAGES } from '../../../i18n';
import { CURRENCIES } from '../../../services/money';
import { n } from '../../../services/planHelpers';
import { usePresence, ROLE_ICONS } from '../../../hooks/usePresence';
import { useStaffPushSubscription } from '../../../hooks/useStaffPushSubscription';
import { dbGetAllAuditLog, dbGetAllDeliveryStatus, dbGetAllSnapshots, dbInsertAuditBulk, dbUpsertDeliveryRows, dbUpsertSnapshotsBulk } from '../../../services/db';
import { setTheme as saveMyTheme } from '../../../services/userPrefs';
import { fmtDate } from '../panelUtils';

const PREMIUM_LOCKABLE_PAGES = [
  'notes', 'payroll', 'inventory', 'audit', 'metrics', 'weeklySchedule', 'returnDate', 'specialDietPrint', 'clientPortal',
];

// Lista de zonas horarias para el selector de Configuración
const FALLBACK_TIMEZONES = [
  'America/La_Paz', 'America/Lima', 'America/Bogota', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Asuncion', 'America/Montevideo', 'America/Mexico_City', 'America/Guatemala', 'America/Panama',
  'America/Santo_Domingo', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'UTC',
];
function getTimezoneOptions() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch {/* navegador sin soporte -- se usa el fallback */}
  return FALLBACK_TIMEZONES;
}
const timezoneOptions = getTimezoneOptions();

export default function SettingsPage({ user, theme, onThemeChange }) {
  const { t } = useTranslation();
  const {
    settings, saveSettings, serverToday, syncToday, showNotice,
    clients, notes, plans, days, drivers, routes, staffUsers, currentDate, inventory,
    saveClients, saveNotes, saveDays, saveInventory,
    saveDrivers: saveDrivers2, saveRoutes: saveRoutes2, savePlans: savePlans2, saveStaffUsers: saveStaffUsers2,
  } = useOperations();
  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const canGetNoteAlerts = ['admin', 'editor', 'superadmin'].includes(user?.role);
  const { status: pushStatus, enable: enableNoteAlerts } = useStaffPushSubscription();
  const { language, currency, setCompanyPrefs } = useCompanyPrefs();
  const [premiumDays, setPremiumDays] = useState('');
  const [exportScope, setExportScope] = useState('all');
  const [working, setWorking] = useState(false);
  const importInputRef = useRef(null);
  const { counts, detail, refresh } = usePresence();
  // La presencia ya no trae nombres (el canal es público): se resuelven acá
  function presenceName(m) {
    if (m.role === 'cliente') return clients.find((c) => c.id === m.id)?.name || '';
    return staffUsers.find((u) => u.id === m.id)?.name || drivers.find((d) => d.id === m.id)?.firstName || '';
  }

  function handleThemeChange(value) {
    saveMyTheme(user.id, value); // cachea local al instante + sincroniza con la cuenta en…
    onThemeChange(value);
  }

  function changeLanguage(code) {
    saveSettings({ ...settings, language: code });
    setCompanyPrefs(code, currency);
  }
  function changeCurrency(code) {
    saveSettings({ ...settings, currency: code });
    setCompanyPrefs(language, code);
  }

  function activatePremium(untilDate) {
    saveSettings({ ...settings, plan: 'premium', premiumUntil: untilDate || '' });
  }
  function activateBasic() {
    if (!confirm(t('settings.plan.confirmBasic'))) return;
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
    showNotice(t('settings.backup.preparingFull'));
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
    showNotice(t('settings.backup.downloadedFull'));
    setWorking(false);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      e.target.value = '';
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch { showNotice(t('settings.backup.invalidJson'), true); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { showNotice(t('settings.backup.badFormat'), true); return; }

      const knownKeys = ['clients', 'plans', 'days', 'currentDate', 'drivers', 'routes', 'settings', 'inventory', 'notes'];
      const foundKeys = knownKeys.filter((k) => k in parsed);
      const hasStaffUsers = Array.isArray(parsed.staffUsers) && parsed.staffUsers.length > 0;
      const hasAuditLog = Array.isArray(parsed.auditLog) && parsed.auditLog.length > 0;
      const hasDeliveryStatus = Array.isArray(parsed.deliveryStatus) && parsed.deliveryStatus.length > 0;
      const hasSnapshots = Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0;
      if (!foundKeys.length && !hasStaffUsers && !hasAuditLog && !hasDeliveryStatus && !hasSnapshots) { showNotice(t('settings.backup.noData'), true); return; }

      const resumenKeys = [...foundKeys, ...(hasStaffUsers ? ['staffUsers'] : []), ...(hasAuditLog ? ['auditLog'] : []), ...(hasDeliveryStatus ? ['deliveryStatus'] : []), ...(hasSnapshots ? ['snapshots'] : [])];
      const resumen = resumenKeys.map((k) => t('settings.backup.k.' + k)).join(', ');
      if (!confirm(t('settings.backup.confirmRestore', { summary: resumen }))) return;

      setWorking(true);
      if (Array.isArray(parsed.clients) && parsed.clients.length) saveClients(parsed.clients);
      if (Array.isArray(parsed.notes) && parsed.notes.length) saveNotes(parsed.notes);
      if (parsed.days) saveDays(parsed.days);
      if (parsed.drivers) saveDrivers2(parsed.drivers);
      if (parsed.routes) saveRoutes2(parsed.routes);
      if (parsed.plans) savePlans2(parsed.plans);
      if (parsed.settings) saveSettings({ ...settings, ...parsed.settings });
      // El respaldo completo también incluye el inventario, así que una restauración total lo…
      if (parsed.inventory) saveInventory(parsed.inventory);
      if (hasStaffUsers) saveStaffUsers2(parsed.staffUsers);
      const [okAudit, okDelivery, okSnapshots] = await Promise.all([
        hasAuditLog ? dbInsertAuditBulk(parsed.auditLog) : Promise.resolve(true),
        hasDeliveryStatus ? dbUpsertDeliveryRows(parsed.deliveryStatus.map((d) => ({ date: d.date, clientId: d.clientId, payload: d.payload }))) : Promise.resolve(true),
        hasSnapshots ? dbUpsertSnapshotsBulk(parsed.snapshots) : Promise.resolve(true),
      ]);
      setWorking(false);
      const ok = okAudit && okDelivery && okSnapshots;
      showNotice(ok ? t('settings.backup.restored') : t('settings.backup.partialRestore'), !ok);
    };
    reader.readAsText(file);
  }

  return (
    <section className="page active">
      <div className="page-head"><div><h1>{t('settings.title')}</h1><p>{t('settings.subtitle')}</p></div></div>

      <div className="settings-grid">
        <div className="card card-pad stack">
          <h3>{t('settings.theme.title')}</h3>
          <p className="muted">{t('settings.theme.desc')}</p>
          <label>{t('common.theme')}
            <select id="settings-theme" name="settings-theme" value={theme} onChange={(e) => handleThemeChange(e.target.value)}>
              <option value="light">{t('common.themeLight')}</option>
              <option value="night">{t('common.themeNight')}</option>
              <option value="forest">{t('common.themeForest')}</option>
            </select>
          </label>
          <p className="muted" style={{ fontSize: 12 }}>{t('settings.theme.tableHint')}</p>
        </div>

        {canGetNoteAlerts && (
          <div className="card card-pad stack">
            <h3>{t('settings.notes.title')}</h3>
            <p className="muted">{t('settings.notes.desc')}</p>
            {pushStatus === 'unsupported' && <p className="muted">{t('settings.notes.unsupported')}</p>}
            {pushStatus === 'granted' && <span className="badge active">{t('settings.notes.granted')}</span>}
            {pushStatus === 'denied' && <p className="muted">{t('settings.notes.denied')}</p>}
            {(pushStatus === 'idle' || pushStatus === 'default') && (
              <button type="button" className="primary" onClick={enableNoteAlerts}>{t('settings.notes.activate')}</button>
            )}
            {pushStatus === 'asking' && <button type="button" className="primary" disabled>{t('settings.notes.activating')}</button>}
            {pushStatus === 'error' && (
              <>
                <p className="muted">{t('settings.notes.error')}</p>
                <button type="button" className="primary" onClick={enableNoteAlerts}>{t('settings.notes.retry')}</button>
              </>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="card card-pad stack">
            <h3>{t('settings.company.title')}</h3>
            <label>{t('settings.company.timezone')}
              <select defaultValue={settings.timezone || 'America/La_Paz'} onChange={(e) => saveSettings({ ...settings, timezone: e.target.value }).then(() => syncToday())}>
                {timezoneOptions.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <p className="muted" style={{ marginTop: -6 }}>{t('settings.company.timezoneHint')}</p>
            <label>{t('settings.company.cutoff')}
              <select defaultValue={settings.dayCutoffHour ?? 4} onChange={(e) => saveSettings({ ...settings, dayCutoffHour: Number(e.target.value) }).then(() => syncToday())}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00{h === 0 ? t('settings.company.midnight') : ''}</option>)}
              </select>
            </label>
            <p className="muted" style={{ marginTop: -6 }}>{t('settings.company.cutoffHint')}</p>
          </div>
        )}

        {isSuperAdmin && (
          <div className="card card-pad stack">
            <h3>{t('settings.languageAndCurrency')}</h3>
            <label>{t('settings.languageLabel')}
              <select value={language} onChange={(e) => changeLanguage(e.target.value)}>
                {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <p className="muted" style={{ marginTop: -6 }}>{t('settings.languageHint')}</p>
            <label>{t('settings.currencyLabel')}
              <select value={currency} onChange={(e) => changeCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <p className="muted" style={{ marginTop: -6 }}>{t('settings.currencyHint')}</p>
          </div>
        )}

        {isSuperAdmin && (
          <div className="card card-pad stack">
            <h3>{t('settings.plan.title')}</h3>
            <p className="muted">{t('settings.plan.intro')}</p>
            <label>{t('settings.plan.whatsappLabel')}
              <input defaultValue={settings.premiumWhatsapp} placeholder={t('settings.plan.whatsappPlaceholder')} onBlur={(e) => saveSettings({ ...settings, premiumWhatsapp: e.target.value.replace(/\D/g, '') })} />
            </label>
            <div className="plan-options">
              <button
                type="button"
                className={`plan-option ${isPremium && !settings.premiumUntil ? 'is-active' : 'is-inactive'}`}
                onClick={() => activatePremium('')}
                disabled={isPremium && !settings.premiumUntil}
              >
                <span>{t('settings.plan.premiumNoExpiry')}</span>
                {isPremium && !settings.premiumUntil && <span className="plan-option-tag">{t('settings.plan.active')}</span>}
              </button>

              <div className={`plan-option plan-option-days ${isPremium && settings.premiumUntil ? 'is-active' : 'is-inactive'}`}>
                <span>{t('settings.plan.premiumDays')}</span>
                <input type="number" min="1" placeholder={t('settings.plan.daysPlaceholder')} value={premiumDays} onChange={(e) => setPremiumDays(e.target.value)} />
                <button type="button" className="success" onClick={activatePremiumDays}>{t('settings.plan.activate')}</button>
                {isPremium && settings.premiumUntil && <span className="plan-option-tag">{t('settings.plan.expires', { date: fmtDate(settings.premiumUntil), days: daysLeft })}</span>}
              </div>

              <button type="button" className={`plan-option ${!isPremium ? 'is-active' : 'is-inactive'}`} onClick={activateBasic} disabled={!isPremium}>
                <span>{t('settings.plan.basic')}</span>
                {!isPremium && <span className="plan-option-tag">{t('settings.plan.active')}</span>}
              </button>
            </div>
            <h3 style={{ marginTop: 10 }}>{t('settings.plan.menusTitle')}</h3>
            <div className="toggle-list-col">
              {PREMIUM_LOCKABLE_PAGES.map((key) => (
                <label key={key}><input type="checkbox" checked={!!settings.premiumLockedPages?.[key]} onChange={(e) => togglePremiumPage(key, e.target.checked)} /> {t('settings.pages.' + key)}</label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-grid" style={{ marginTop: 18 }}>
        <div className="card card-pad stack">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{t('settings.presence.title')}</h3>
            <button type="button" className="primary" onClick={refresh}>{t('settings.presence.refresh')}</button>
          </div>
          <div className="summary-grid compact" style={{ marginBottom: 4 }}>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>{t('settings.presence.clients')}</div><strong>{counts.cliente}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>{t('settings.presence.drivers')}</div><strong>{counts.driver}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>{t('settings.presence.staff')}</div><strong>{counts.staff}</strong></div>
            <div className="card metric"><div className="muted" style={{ fontSize: 11 }}>{t('settings.presence.total')}</div><strong>{counts.total}</strong></div>
          </div>
          {detail.length ? (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {detail.map((m, i) => (
                <div key={i} className="presence-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', padding: '8px 4px', borderBottom: '1px solid var(--panel-line)' }}>
                  <span style={{ flex: '0 1 auto' }}>{ROLE_ICONS[m.role] || '●'} {m.role === 'cliente' ? t('settings.presence.roleClient') : m.role === 'driver' ? t('settings.presence.roleDriver') : t('settings.presence.roleStaff')}</span>
                  <b style={{ flex: '1 1 90px' }}>{presenceName(m) || t('settings.presence.noName')}</b>
                  <span className="muted" style={{ fontSize: 12, flex: '1 1 80px' }}>{m.device || ''}</span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, flex: '0 0 auto' }}>{m.at ? t('settings.presence.since', { time: new Date(m.at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) }) : ''}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ marginTop: 8 }}>{t('settings.presence.empty')}</p>}
        </div>

        {isAdmin && (
          <div className="card card-pad stack">
            <h3>{t('settings.backup.title')}</h3>
            <p className="muted">{t('settings.backup.desc')}</p>
            <label>{t('settings.backup.whatExport')}
              <select id="settings-export-scope" name="settings-export-scope" value={exportScope} onChange={(e) => setExportScope(e.target.value)}>
                <option value="all">{t('settings.backup.scopeAll')}</option>
                <option value="clientes">{t('settings.backup.scopeClients')}</option>
                <option value="personal">{t('settings.backup.scopeStaff')}</option>
                <option value="inventario">{t('settings.backup.scopeInventory')}</option>
              </select>
            </label>
            <button type="button" className="info" onClick={handleExport} disabled={working}>{working ? t('settings.backup.preparing') : t('settings.backup.download')}</button>
            <button type="button" className="warning" onClick={() => importInputRef.current?.click()} disabled={working}>{t('settings.backup.restore')}</button>
            <input ref={importInputRef} type="file" accept="application/json" hidden onChange={handleImportFile} />
          </div>
        )}
      </div>

    </section>
  );
}

import { useMemo, useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { n } from '../../../services/planHelpers';
import { dbSendManualPush } from '../../../services/supabaseClient';
import ImageField from '../ImageField';

const FILTERS = [
  ['all', 'Todos los clientes activos'],
  ['tenure', 'Con más de X días activos (antigüedad)'],
  ['expiring', 'A Y días o menos de que se les venza el plan'],
];

export default function PublicidadPage() {
  const { settings, saveSettings, clients, showNotice } = useOperations();
  const [filter, setFilter] = useState('all');
  const [tenureDays, setTenureDays] = useState(30);
  const [expiringDays, setExpiringDays] = useState(3);
  const [title, setTitle] = useState('Recordatorio de tu plan');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const activeClients = useMemo(() => (clients || []).filter((c) => c.status !== 'Retorno pendiente'), [clients]);

  const targetClients = useMemo(() => {
    if (filter === 'tenure') return activeClients.filter((c) => n(c.consumedDays) > n(tenureDays));
    if (filter === 'expiring') {
      return activeClients.filter((c) => {
        const remaining = Math.max(0, n(c.paidDays) - n(c.consumedDays));
        return remaining > 0 && remaining <= n(expiringDays);
      });
    }
    return activeClients;
  }, [activeClients, filter, tenureDays, expiringDays]);

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      showNotice('Escribe un título y un texto para la notificación.', true);
      return;
    }
    if (!targetClients.length) {
      showNotice('No hay clientes que cumplan ese filtro.', true);
      return;
    }
    if (!confirm(`¿Enviar esta notificación a ${targetClients.length} cliente(s)?`)) return;

    setSending(true);
    const result = await dbSendManualPush(targetClients.map((c) => c.id), title.trim(), body.trim());
    setSending(false);

    if (!result?.ok) {
      showNotice(result?.error || 'No se pudo enviar. Revisa que las claves VAPID estén configuradas en la Edge Function.', true);
      return;
    }
    showNotice(`Notificación enviada: ${result.sent} recibida(s), ${result.failed} fallida(s) de ${result.subscriptionsFound} dispositivo(s) suscriptos.`);
  }

  return (
    <section className="p-3">
      <h1 className="h5 mb-3">Publicidad</h1>

      <div className="settings-grid">
        <div className="card card-pad stack">
          <h3>Datos públicos de la empresa</h3>
          <p className="muted" style={{ marginTop: -6 }}>Esto es lo que ven los clientes: el portal, el banner y los botones de contacto.</p>
          <label>Nombre de la empresa<input defaultValue={settings.companyName} onBlur={(e) => saveSettings({ ...settings, companyName: e.target.value })} /></label>
          <label>Número de WhatsApp<input defaultValue={settings.whatsappNumber} placeholder="Ej: 59171234567" onBlur={(e) => saveSettings({ ...settings, whatsappNumber: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Link de Instagram<input defaultValue={settings.instagramUrl} placeholder="https://instagram.com/tu_empresa" onBlur={(e) => saveSettings({ ...settings, instagramUrl: e.target.value.trim() })} /></label>
          <label>Usuario de Instagram (@handle)<input defaultValue={settings.instagramHandle} placeholder="@tu_empresa" onBlur={(e) => saveSettings({ ...settings, instagramHandle: e.target.value.trim() })} /></label>
          <ImageField label="Imagen publicitaria (banner del portal de clientes)" name="_ad" value={settings.adImageUrl} onChange={(url) => saveSettings({ ...settings, adImageUrl: url })} folder="branding" maxDim={800} />
          <ImageField label="QR de pago (para renovar/cambiar de plan desde el portal)" name="_qr" value={settings.paymentQrUrl} onChange={(url) => saveSettings({ ...settings, paymentQrUrl: url })} folder="branding" maxDim={500} />
          <label>Días antes del vencimiento para mostrar el aviso de renovación
            <input type="number" min="0" max="30" defaultValue={n(settings.renewalWarningDays)} onBlur={(e) => saveSettings({ ...settings, renewalWarningDays: Math.max(0, n(e.target.value)) })} />
          </label>
        </div>

        <div className="card card-pad stack">
          <h3>Recordatorio automático (todos los días, 9 AM)</h3>
          <p className="muted" style={{ marginTop: -6 }}>
            Se manda solo a los clientes Activos a quienes les quedan entre 1 y 3 días de plan. Este es el
            texto que reciben.
          </p>
          <label>Texto de la notificación
            <textarea
              rows={3}
              defaultValue={settings.pushReminderText || ''}
              placeholder="Ej. Tu plan está por vencer en pocos días. ¡Renueva para no quedarte sin tu catering!"
              onBlur={(e) => saveSettings({ ...settings, pushReminderText: e.target.value })}
            />
          </label>
          <p className="muted" style={{ fontSize: 12 }}>
            El envío en sí lo hace un cron en Supabase, no esta pantalla — acá solo se guarda el texto que
            usa. Si todavía no configuraste el cron, revisá <code>install/supabase-push-notifications-migration.sql</code>.
          </p>
        </div>
      </div>

      <div className="card card-pad stack" style={{ marginTop: 18 }}>
        <h3>Enviar notificación manual</h3>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Recordatorio de tu plan" /></label>
        <label>Mensaje<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ej. No te olvides de renovar tu plan esta semana." /></label>

        <label>Enviar a
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {filter === 'tenure' && (
          <label style={{ maxWidth: 220 }}>Más de cuántos días activos
            <input type="number" min="0" value={tenureDays} onChange={(e) => setTenureDays(e.target.value)} />
          </label>
        )}
        {filter === 'expiring' && (
          <label style={{ maxWidth: 220 }}>Días o menos para vencer
            <input type="number" min="1" value={expiringDays} onChange={(e) => setExpiringDays(e.target.value)} />
          </label>
        )}

        <p className="muted" style={{ marginBottom: 4 }}>
          Esto le va a llegar a <b>{targetClients.length}</b> cliente(s) que tengan la notificación habilitada
          en su celular (no todos los que cumplen el filtro necesariamente la activaron).
        </p>
        <button type="button" className="primary" onClick={handleSend} disabled={sending || !title.trim() || !body.trim()}>
          {sending ? 'Enviando…' : 'Enviar notificación'}
        </button>
      </div>
    </section>
  );
}

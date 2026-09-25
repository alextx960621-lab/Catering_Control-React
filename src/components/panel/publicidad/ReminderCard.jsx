import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { n } from '../../../services/planHelpers';
import { dbInsertAudit } from '../../../services/supabaseClient';

// Recordatorio automático de plan. Lo guardado acá (settings.pushReminder) lo lee
// el SQL: un cron corre cada minuto y, si es la hora y el día elegidos, le pide a la
// Edge Function send-push que lo mande (ver run_push_reminder en supabase-setup-final.sql).
// Cada entrada: [número, etiqueta en español para la auditoría, clave i18n para mostrar]
const DAYS = [[1, 'Lun', 'mon'], [2, 'Mar', 'tue'], [3, 'Mié', 'wed'], [4, 'Jue', 'thu'], [5, 'Vie', 'fri'], [6, 'Sáb', 'sat'], [0, 'Dom', 'sun']]; // 0 = domingo
const MODES = [
  ['expiring', 'Clientes activos con pocos días de plan restantes', 'modeExpiring'],
  ['all_active', 'Todos los clientes activos', 'modeAllActive'],
  ['selected', 'Solo los clientes que yo elija', 'modeSelected'],
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function wholeNumber(value, fallback) {
  const num = Number(value);
  return value !== '' && value != null && Number.isFinite(num) ? Math.max(0, Math.floor(num)) : fallback;
}

// Igual criterio que get_push_reminder_config() en el SQL: lo guardado + valores por defecto.
function readReminder(settings) {
  const r = settings.pushReminder || {};
  const legacyHour = Number.isInteger(settings.pushReminderHour) && settings.pushReminderHour >= 0 && settings.pushReminderHour <= 23
    ? `${String(settings.pushReminderHour).padStart(2, '0')}:00`
    : '';
  return {
    enabled: r.enabled !== false,
    time: TIME_RE.test(r.time || '') ? r.time : (legacyHour || '09:00'),
    days: Array.isArray(r.days) ? r.days : [0, 1, 2, 3, 4, 5, 6],
    mode: MODES.some(([key]) => key === r.mode) ? r.mode : 'expiring',
    minDays: wholeNumber(r.minDays, 1),
    maxDays: Math.max(1, wholeNumber(r.maxDays, 3)),
    clientIds: Array.isArray(r.clientIds) ? r.clientIds : [],
  };
}

export default function ReminderCard() {
  const { t } = useTranslation();
  const { settings, saveSettings, clients } = useOperations();
  const cfg = readReminder(settings);
  const [search, setSearch] = useState('');
  const auditTimer = useRef(null);

  const remainingOf = (c) => Math.max(0, n(c.paidDays) - n(c.consumedDays));

  // A cuántos clientes les toca (mismo criterio que get_push_reminder_targets en el SQL)
  const targets = useMemo(() => {
    const list = clients || [];
    if (cfg.mode === 'selected') return list.filter((c) => cfg.clientIds.includes(c.id));
    const active = list.filter((c) => (c.status || 'Activo') === 'Activo');
    if (cfg.mode === 'all_active') return active;
    return active.filter((c) => {
      const left = Math.max(0, n(c.paidDays) - n(c.consumedDays));
      return left >= cfg.minDays && left <= cfg.maxDays;
    });
  }, [clients, cfg.mode, cfg.clientIds, cfg.minDays, cfg.maxDays]);

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...(clients || [])]
      .filter((c) => !q || String(c.name || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  }, [clients, search]);

  function update(patch, auditDetails) {
    saveSettings({ ...settings, pushReminder: { ...cfg, ...patch } });
    if (auditDetails) {
      dbInsertAudit({ action: 'Configuró el recordatorio automático', entity_type: 'configuracion', entity_label: 'Recordatorio automático', details: auditDetails });
    }
  }

  // Elegir clientes a mano puede ser muchos toques seguidos: se audita una sola vez al terminar.
  function updateClientIds(clientIds) {
    saveSettings({ ...settings, pushReminder: { ...cfg, clientIds } });
    window.clearTimeout(auditTimer.current);
    auditTimer.current = window.setTimeout(() => {
      dbInsertAudit({ action: 'Configuró el recordatorio automático', entity_type: 'configuracion', entity_label: 'Recordatorio automático', details: { destinatarios_elegidos: clientIds.length } });
    }, 1500);
  }

  function toggleDay(day) {
    const days = cfg.days.includes(day) ? cfg.days.filter((d) => d !== day) : [...cfg.days, day];
    update({ days }, { dias: DAYS.filter(([d]) => days.includes(d)).map(([, label]) => label).join(', ') || 'ninguno' });
  }

  function toggleClient(id) {
    updateClientIds(cfg.clientIds.includes(id) ? cfg.clientIds.filter((x) => x !== id) : [...cfg.clientIds, id]);
  }

  const dayText = cfg.days.length === 7
    ? t('panel.reminder.everyDay')
    : cfg.days.length
      ? DAYS.filter(([d]) => cfg.days.includes(d)).map(([, , key]) => t(`panel.reminder.days.${key}`)).join(', ')
      : t('panel.reminder.noDay');
  const whoText = cfg.mode === 'selected'
    ? t('panel.reminder.whoSelected')
    : cfg.mode === 'all_active'
      ? t('panel.reminder.whoAllActive')
      : t('panel.reminder.whoExpiring', { minDays: cfg.minDays, maxDays: cfg.maxDays });

  return (
    <div className="card card-pad stack">
      <h3>{t('panel.reminder.title')}</h3>
      <label className="check-row">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked }, { activado: e.target.checked ? 'sí' : 'no' })} />
        {t('panel.reminder.enableLabel')}
      </label>

      {cfg.enabled && (
        <>
          <p className="muted" style={{ marginTop: -4 }}>
            {t('panel.reminder.summaryPrefix')}<b>{cfg.time}</b>{t('panel.reminder.summaryMiddle', { days: dayText, who: whoText })}
            <b>{targets.length}</b>{' '}{t('panel.reminder.summaryClients', { count: targets.length })}
          </p>

          <div className="reminder-when">
            <label style={{ maxWidth: 180 }}>{t('panel.reminder.timeLabel')}
              <input
                type="time"
                value={cfg.time}
                onChange={(e) => TIME_RE.test(e.target.value) && update({ time: e.target.value }, { hora: e.target.value })}
              />
            </label>
            <div>
              <div className="muted" style={{ marginBottom: 4 }}>{t('panel.reminder.weekdaysLabel')}</div>
              <div className="day-chips">
                {DAYS.map(([day, , dayKey]) => (
                  <button key={day} type="button" className={`pill-tab${cfg.days.includes(day) ? ' active' : ''}`} onClick={() => toggleDay(day)}>{t(`panel.reminder.days.${dayKey}`)}</button>
                ))}
              </div>
            </div>
          </div>

          <label>{t('panel.reminder.recipientsLabel')}
            <select value={cfg.mode} onChange={(e) => update({ mode: e.target.value }, { destinatarios: MODES.find(([key]) => key === e.target.value)?.[1] })}>
              {MODES.map(([key, , modeKey]) => <option key={key} value={key}>{t(`panel.reminder.${modeKey}`)}</option>)}
            </select>
          </label>

          {cfg.mode === 'expiring' && (
            <div className="reminder-when">
              <label style={{ maxWidth: 180 }}>{t('panel.reminder.minDaysLabel')}
                <input type="number" min="0" max="365" defaultValue={cfg.minDays} key={`min-${cfg.minDays}`}
                  onBlur={(e) => {
                    const minDays = wholeNumber(e.target.value, 1);
                    if (minDays !== cfg.minDays) update({ minDays, maxDays: Math.max(cfg.maxDays, minDays, 1) }, { desde_dias_restantes: minDays });
                  }} />
              </label>
              <label style={{ maxWidth: 180 }}>{t('panel.reminder.maxDaysLabel')}
                <input type="number" min="1" max="365" defaultValue={cfg.maxDays} key={`max-${cfg.maxDays}`}
                  onBlur={(e) => {
                    const maxDays = Math.max(1, wholeNumber(e.target.value, 3));
                    if (maxDays !== cfg.maxDays) update({ maxDays, minDays: Math.min(cfg.minDays, maxDays) }, { hasta_dias_restantes: maxDays });
                  }} />
              </label>
            </div>
          )}

          {cfg.mode === 'selected' && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="reminder-when">
                <input type="search" placeholder={t('panel.reminder.searchClientPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 200px' }} />
                <button type="button" className="info" onClick={() => updateClientIds([...new Set([...cfg.clientIds, ...visibleClients.map((c) => c.id)])])}>{t('panel.reminder.selectVisible')}</button>
                <button type="button" className="danger" onClick={() => updateClientIds([])} disabled={!cfg.clientIds.length}>{t('panel.reminder.removeAll')}</button>
              </div>
              <div className="reminder-client-list">
                {visibleClients.length === 0 && <div className="muted" style={{ padding: 10 }}>{t('panel.reminder.noMatchingClients')}</div>}
                {visibleClients.map((c) => (
                  <label key={c.id} className="reminder-client-row">
                    <input type="checkbox" checked={cfg.clientIds.includes(c.id)} onChange={() => toggleClient(c.id)} />
                    <span className="reminder-client-name">{c.name}</span>
                    <span className="muted">{c.status || 'Activo'} · {t('panel.reminder.daysLeft', { count: remainingOf(c) })}</span>
                  </label>
                ))}
              </div>
              <div className="muted">{t('panel.reminder.chosenClients', { count: cfg.clientIds.length })}</div>
            </div>
          )}

          <label>{t('panel.reminder.notificationTextLabel')}
            <textarea
              rows={3}
              defaultValue={settings.pushReminderText || ''}
              placeholder={t('panel.reminder.textPlaceholder')}
              onBlur={(e) => saveSettings({ ...settings, pushReminderText: e.target.value })}
            />
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            {t('panel.reminder.placeholdersHint1')}<b>{'{nombre}'}</b>{t('panel.reminder.placeholdersHint2')}<b>{'{dias}'}</b>{t('panel.reminder.placeholdersHint3')}
          </p>
        </>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        {t('panel.reminder.footerBefore')}<b>send-push</b>{t('panel.reminder.footerAfter')}
      </p>
    </div>
  );
}

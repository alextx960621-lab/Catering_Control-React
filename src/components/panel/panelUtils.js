import { dbInsertAudit } from '../../services/supabaseClient';

// Id corto para filas nuevas creadas en el cliente antes de guardarse (clientes, notas,
// planes, productos, vínculos, usuarios, rutas). Usado por varias páginas del panel.
export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Formatea una fecha 'YYYY-MM-DD' (la que usa toda la app internamente) como 'DD/MM/YYYY'
// para mostrarla al staff. Usado por varias páginas del panel.
export function fmtDate(d) {
  return d.split('-').reverse().join('/');
}

// Auditoría de Configuración / Publicidad / Métricas. Cada clave de `settings` que se audita tiene su
// nombre legible; las que son imágenes no guardan la URL, solo si se agregó, reemplazó o quitó.
const SETTING_LABELS = {
  language: 'Idioma', currency: 'Moneda', plan: 'Plan', premiumUntil: 'Vencimiento del plan premium',
  premiumLockedPages: 'Páginas del plan premium', timezone: 'Zona horaria', dayCutoffHour: 'Hora de corte del día',
  premiumWhatsapp: 'WhatsApp de soporte premium', mapCity: 'Ciudad del mapa', logoUrl: 'Logo',
  companyName: 'Nombre de la empresa', whatsappNumber: 'WhatsApp de la empresa', instagramUrl: 'Link de Instagram',
  instagramHandle: 'Usuario de Instagram', adImageUrl: 'Imagen del anuncio', paymentQrUrl: 'QR de pago',
  renewalWarningDays: 'Días de aviso de renovación', costPerKm: 'Costo por km',
};
const IMAGE_KEYS = new Set(['logoUrl', 'adImageUrl', 'paymentQrUrl']);
const norm = (v) => (v == null ? '' : v);

export function auditConfig(user, action, label, details = {}) {
  if (!user?.id) return;
  dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action, entity_type: 'configuracion', entity_label: label, details });
}

// Compara los ajustes antes/después y deja UNA fila de auditoría con lo que cambió de verdad (si un
// campo se guarda sin cambios, por ejemplo un input que pierde el foco, no registra nada).
export function auditSettingsChange(user, prev, next) {
  const changed = Object.keys(SETTING_LABELS).filter((k) => JSON.stringify(norm(prev?.[k])) !== JSON.stringify(norm(next?.[k])));
  if (!changed.length) return;
  const details = {};
  changed.forEach((k) => {
    const label = SETTING_LABELS[k];
    if (IMAGE_KEYS.has(k)) details[label] = next[k] ? (prev?.[k] ? 'imagen reemplazada' : 'imagen agregada') : 'imagen quitada';
    else if (k === 'mapCity') details[label] = { de: prev?.mapCity?.name || '', a: next.mapCity?.name || '' };
    else if (k === 'premiumLockedPages') {
      details[label] = Object.keys({ ...prev?.premiumLockedPages, ...next.premiumLockedPages })
        .filter((pg) => !!prev?.premiumLockedPages?.[pg] !== !!next.premiumLockedPages?.[pg])
        .map((pg) => `${pg}: ${next.premiumLockedPages?.[pg] ? 'bloqueada' : 'libre'}`);
    } else details[label] = { de: norm(prev?.[k]), a: norm(next[k]) };
  });
  auditConfig(user, 'Configuración cambiada', changed.map((k) => SETTING_LABELS[k]).join(', '), details);
}

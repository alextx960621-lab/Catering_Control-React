import { dbGetAllDeliveryStatus, dbUpsertDeliveryRows } from './db';
import { removeStoredImage } from './imageUpload';
import { dispatchStatus } from './dispatchHelpers';

// Reglas de retención de datos (las mismas que describe la Política de Privacidad del…
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const INACTIVE_CLIENT_DAYS = 730; // 2 años

function extractProofUrl(text) {
  const m = String(text || '').match(/Comprobante:\s*(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

function daysSince(dateStr, refStr) {
  const d = new Date(dateStr);
  const r = new Date(refStr);
  if (isNaN(d) || isNaN(r)) return null;
  return Math.floor((r - d) / 86400000);
}

// Comprobantes de pago adjuntos a una nota (los deja PlanChangeModal.jsx del portal de…
export function cleanupOldProofImages(notes) {
  const now = Date.now();
  const stale = (notes || []).filter((nt) => {
    if (!nt.createdAt) return false;
    if (!extractProofUrl(nt.text)) return false;
    const age = now - new Date(nt.createdAt).getTime();
    return Number.isFinite(age) && age > FIFTEEN_DAYS_MS;
  });
  if (!stale.length) return null;
  return stale.map((nt) => {
    removeStoredImage(extractProofUrl(nt.text));
    const text = `${nt.text.replace(/\s*Comprobante:\s*https?:\/\/\S+/, '').trim()} (comprobante eliminado automáticamente: pasaron más de 15 días)`;
    return { ...nt, text };
  });
}

// Fotos de respaldo que se suben al marcar una entrega (Despacho)
export async function cleanupOldDeliveryPhotos(rows) {
  const list = rows || (await dbGetAllDeliveryStatus(null));
  if (!Array.isArray(list) || !list.length) return;
  const now = Date.now();
  const stale = list.filter((r) => {
    const img = r.payload?.image;
    const at = r.payload?.at;
    if (!img || !at) return false;
    const age = now - new Date(at).getTime();
    return Number.isFinite(age) && age > FIFTEEN_DAYS_MS;
  });
  if (!stale.length) return true;
  stale.forEach((r) => removeStoredImage(r.payload.image));
  const upserts = stale.map((r) => ({ date: r.date, clientId: r.clientId, payload: { ...r.payload, image: '' } }));
  return dbUpsertDeliveryRows(upserts);
}

// Un cliente en "Retorno pendiente" (agotó sus días pagados, sin renovar) y SIN ninguna…
export async function findInactiveClientsToDelete(clients, days, refDate, rows) {
  const list = rows || (await dbGetAllDeliveryStatus(null));
  const lastDeliveryByClient = {};
  if (Array.isArray(list)) {
    list.forEach((r) => {
      if (!r.date) return;
      if (!lastDeliveryByClient[r.clientId] || r.date > lastDeliveryByClient[r.clientId]) lastDeliveryByClient[r.clientId] = r.date;
    });
  }
  const dayInfo = days?.[refDate] || { laborable: true };
  const toDelete = [];
  (clients || []).forEach((c) => {
    if (dispatchStatus(c, refDate, dayInfo, false) !== 'Retorno pendiente') return;
    const lastActivity = lastDeliveryByClient[c.id] || c.startDate || '';
    if (!lastActivity) return; // sin ninguna fecha de referencia -> no tocar, por seguridad
    const d = daysSince(lastActivity, refDate);
    if (d !== null && d >= INACTIVE_CLIENT_DAYS) {
      toDelete.push(c);
      if (Array.isArray(list)) list.filter((r) => r.clientId === c.id && r.payload?.image).forEach((r) => removeStoredImage(r.payload.image));
    }
  });
  return toDelete;
}

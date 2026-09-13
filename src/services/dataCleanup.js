import { dbGetAllDeliveryStatus, dbUpsertDeliveryRows } from './db';
import { removeStoredImage } from './imageUpload';
import { dispatchStatus } from './dispatchHelpers';

// Reglas de retención de datos, tal como las describe la Política de
// Privacidad del portal: los comprobantes de pago y las fotos de
// respaldo de entrega se borran a los 7 días, y un cliente sin ninguna
// actividad por 2 años se borra directamente. En la versión vanilla
// (panel.html) estas 3 rutinas corren solas cada vez que la app carga o
// alguien toca "Actualizar" -- acá se replican con el mismo criterio,
// para que lo que dice la Política de Privacidad se cumpla de verdad.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
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

// Comprobantes de pago adjuntos a una nota (los deja PlanChangeModal.jsx
// del portal de cliente, como "...Comprobante: https://..." al final del
// texto): si pasaron más de 7 días desde que se creó la nota, se borra
// la imagen de Storage y se dejar constancia en el propio texto de la
// nota. Devuelve las notas ya modificadas (para guardar con el mismo
// saveNotes() de siempre), o null si no había ninguna vencida.
export function cleanupOldProofImages(notes) {
  const now = Date.now();
  const stale = (notes || []).filter((nt) => {
    if (!nt.createdAt) return false;
    if (!extractProofUrl(nt.text)) return false;
    const age = now - new Date(nt.createdAt).getTime();
    return Number.isFinite(age) && age > SEVEN_DAYS_MS;
  });
  if (!stale.length) return null;
  return stale.map((nt) => {
    removeStoredImage(extractProofUrl(nt.text));
    const text = `${nt.text.replace(/\s*Comprobante:\s*https?:\/\/\S+/, '').trim()} (comprobante eliminado automáticamente: pasaron más de 7 días)`;
    return { ...nt, text };
  });
}

// Fotos de respaldo que se suben al marcar una entrega (Despacho). A
// diferencia del logo/QR/fotos de perfil, estas nunca se reemplazan
// solas -- si nadie las revisa, se quedan para siempre en Storage. Por
// eso se revisa TODO el historial de `db_delivery_status` (todas las
// fechas), no solo lo que algún componente tenga cargado en caché.
//
// `rows` es opcional: si quien llama ya trajo el historial completo (ver
// runDataCleanup en OperationsContext.jsx, que lo comparte con
// findInactiveClientsToDelete para no pedirlo 2 veces seguidas), se
// puede pasar directo acá en vez de volver a pedirlo.
export async function cleanupOldDeliveryPhotos(rows) {
  const list = rows || (await dbGetAllDeliveryStatus(null));
  if (!Array.isArray(list) || !list.length) return;
  const now = Date.now();
  const stale = list.filter((r) => {
    const img = r.payload?.image;
    const at = r.payload?.at;
    if (!img || !at) return false;
    const age = now - new Date(at).getTime();
    return Number.isFinite(age) && age > SEVEN_DAYS_MS;
  });
  if (!stale.length) return true;
  stale.forEach((r) => removeStoredImage(r.payload.image));
  const upserts = stale.map((r) => ({ date: r.date, clientId: r.clientId, payload: { ...r.payload, image: '' } }));
  return dbUpsertDeliveryRows(upserts);
}

// Un cliente en "Retorno pendiente" (agotó sus días pagados, sin
// renovar) y SIN ninguna entrega marcada en 2 años seguidos se puede
// borrar directamente -- sin etapa intermedia de archivado: hasta el
// día antes de cumplir los 2 años sigue funcionando 100% normal,
// incluido su acceso al portal. La "última actividad" es la fecha de
// entrega más reciente en `db_delivery_status`; si el cliente nunca tuvo
// ninguna entrega registrada, se usa su `startDate` (para no borrar por
// error a uno recién creado que todavía no tuvo su primera entrega).
// Solo CALCULA quiénes hay que borrar y borra sus fotos de Storage de
// paso -- el borrado real (base de datos + estado + auditoría) lo hace
// quien llama, con las mismas funciones de siempre.
//
// `rows` opcional, mismo motivo que en cleanupOldDeliveryPhotos.
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

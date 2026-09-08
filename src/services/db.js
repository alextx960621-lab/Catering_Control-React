// Capa de datos del PANEL (lado staff). Equivalente a window.SupabaseDB en
// app.js original, pero como funciones exportadas en vez de un objeto
// global. Todo pasa por rpc() (ver supabaseClient.js), que ya valida el
// token de sesión del lado del servidor en cada llamada.
import { rpc, getSessionToken } from './supabaseClient';
import { supabase } from './supabaseClient';

const DB_TABLE_KEYS = ['clientes', 'personal', 'inventario'];

// dbGet/dbSet: leen y guardan un "bloque" completo (clientes, personal o
// inventario) de una sola vez. Se usan cuando hace falta TODO el bloque;
// para cambios puntuales conviene dbGetFields/dbSetFields de abajo, que
// pesan menos porque solo tocan los ids que realmente cambiaron.
export function dbGet(tableKey) {
  if (!DB_TABLE_KEYS.includes(tableKey)) return Promise.resolve(null);
  return rpc('staff_get_block', { p_token: getSessionToken(), p_table_key: tableKey });
}

export function dbSet(tableKey, payload) {
  if (!DB_TABLE_KEYS.includes(tableKey)) return Promise.resolve(false);
  return rpc('staff_set_block', { p_token: getSessionToken(), p_table_key: tableKey, p_payload: payload }).then((r) => r !== null);
}

export async function dbGetFields(tableKey, ids) {
  if (!DB_TABLE_KEYS.includes(tableKey) || !ids?.length) return {};
  const data = await rpc('staff_get_fields', { p_token: getSessionToken(), p_table_key: tableKey, p_ids: ids });
  // IMPORTANTE: null significa que la llamada falló de verdad (red/RPC).
  // Es distinto de un array vacío, que significa "no hay nada guardado
  // todavía" (cuenta nueva). Si se confunden los dos casos, quien llama
  // a esta función puede pensar que "no hay drivers/rutas/planes" cuando
  // en realidad la pregunta ni llegó a hacerse bien -- y si después
  // guarda con ese estado vacío, borra los datos reales del servidor.
  // Por eso acá se propaga null tal cual, en vez de convertirlo en {}.
  if (data === null) return null;
  const result = {};
  data.forEach((r) => {
    result[r.id] = r.payload;
  });
  return result;
}

export async function dbSetFields(tableKey, fieldsObj) {
  if (!DB_TABLE_KEYS.includes(tableKey)) return false;
  const ids = Object.keys(fieldsObj || {});
  if (!ids.length) return true;
  const result = await rpc('staff_set_fields', { p_token: getSessionToken(), p_table_key: tableKey, p_fields: fieldsObj });
  return result !== null;
}

// --- Clientes (tabla db_clientes_rows) ---------------------------------
export async function dbGetClientRows() {
  const data = await rpc('staff_get_client_rows', { p_token: getSessionToken() });
  return data ? data.map((r) => ({ ...r.payload, id: r.id })) : null;
}

export async function dbGetClientRowIds() {
  const data = await rpc('staff_get_client_row_ids', { p_token: getSessionToken() });
  return data ? data.map((r) => r.id) : null;
}

export async function dbGetClientRowsSince(sinceISO) {
  const data = await rpc('staff_get_client_rows_since', { p_token: getSessionToken(), p_since: sinceISO });
  return data ? data.map((r) => ({ ...r.payload, id: r.id })) : null;
}

export async function dbUpsertClientRows(clientsArray) {
  if (!clientsArray?.length) return true;
  const rows = clientsArray.map((c) => ({ ...c, id: c.id }));
  const result = await rpc('staff_upsert_client_rows', { p_token: getSessionToken(), p_rows: rows });
  return result !== null;
}

export async function dbDeleteClientRows(ids) {
  if (!ids?.length) return true;
  const result = await rpc('staff_delete_client_rows', { p_token: getSessionToken(), p_ids: ids });
  return result !== null;
}

// --- Auditoría (historial de cambios) -----------------------------------
export function dbGetAuditLog(limit = 200) {
  return rpc('staff_get_audit_log', { p_token: getSessionToken(), p_limit: limit });
}

export function dbGetAllAuditLog(sinceDate) {
  return rpc('staff_get_all_audit_log', { p_token: getSessionToken(), p_since: sinceDate || null });
}

export async function dbInsertAuditBulk(entries) {
  if (!entries?.length) return true;
  const cleanEntries = entries.map(({ id, ...rest }) => rest); // el id lo asigna la base
  const result = await rpc('staff_insert_audit_bulk', { p_token: getSessionToken(), p_entries: cleanEntries });
  return result !== null;
}

// --- Notas internas -------------------------------------------------------
export async function dbGetNoteRows() {
  const data = await rpc('staff_get_note_rows', { p_token: getSessionToken() });
  return data ? data.map((r) => ({ ...r.payload, id: r.id })) : null;
}

export async function dbUpsertNoteRows(notesArray) {
  if (!notesArray?.length) return true;
  const result = await rpc('staff_upsert_note_rows', { p_token: getSessionToken(), p_rows: notesArray });
  return result !== null;
}

export async function dbDeleteNoteRows(ids) {
  if (!ids?.length) return true;
  const result = await rpc('staff_delete_note_rows', { p_token: getSessionToken(), p_ids: ids });
  return result !== null;
}

// --- Snapshots del día (foto de cómo quedó el despacho de un día) --------
export async function dbUpsertSnapshot(date, payload) {
  const result = await rpc('staff_upsert_snapshot', { p_token: getSessionToken(), p_date: date, p_payload: payload });
  return result !== null;
}

export async function dbGetSnapshot(date) {
  const data = await rpc('staff_get_snapshot', { p_token: getSessionToken(), p_date: date });
  return Array.isArray(data) ? data[0] || null : data || null;
}

export function dbListSnapshotDates() {
  return rpc('staff_list_snapshot_dates', { p_token: getSessionToken() });
}

export function dbGetAllSnapshots(sinceDate) {
  return rpc('staff_get_all_snapshots', { p_token: getSessionToken(), p_since: sinceDate || null });
}

export async function dbUpsertSnapshotsBulk(snapshotsArray) {
  if (!snapshotsArray?.length) return true;
  const result = await rpc('staff_upsert_snapshots_bulk', { p_token: getSessionToken(), p_snapshots: snapshotsArray });
  return result !== null;
}

// --- Estado de entregas (quién recibió/no recibió cada día) --------------
export async function dbGetDeliveryRows(date) {
  const data = await rpc('staff_get_delivery_rows', { p_token: getSessionToken(), p_date: date });
  return data ? data.map((r) => ({ id: r.id, clientId: r.client_id, ...r.payload })) : null;
}

export async function dbUpsertDeliveryRows(rows) {
  if (!rows?.length) return true;
  const upsertRows = rows.map((r) => ({ date: r.date, clientId: r.clientId, payload: r.payload }));
  const result = await rpc('staff_upsert_delivery_rows', { p_token: getSessionToken(), p_rows: upsertRows });
  return result !== null;
}

export async function dbGetAllDeliveryStatus(sinceDate) {
  const data = await rpc('staff_get_all_delivery_status', { p_token: getSessionToken(), p_since: sinceDate || null });
  return data ? data.map((r) => ({ date: r.date, clientId: r.client_id, payload: r.payload })) : null;
}

// --- Imágenes (logo, fotos de plan, fotos de choferes, etc.) -------------
// NOTA DE SEGURIDAD heredada del original: el bucket sigue con
// subir/reemplazar/borrar abiertos a la clave pública (ver
// supabase-storage-setup.sql). Es un riesgo menor -- imágenes, no datos
// de clientes -- pero quedó pendiente de cerrar en un cambio aparte.
const IMAGES_BUCKET = 'app-images';

export async function storageUploadImage(path, blob, contentType) {
  try {
    const { error } = await supabase.storage.from(IMAGES_BUCKET).upload(path, blob, { contentType, upsert: true, cacheControl: '604800' });
    if (error) {
      console.error('[supabase] Error subiendo imagen:', error.message);
      return null;
    }
    const { data } = supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('[supabase] Fallo de red subiendo imagen:', err);
    return null;
  }
}

export async function storageRemoveImage(path) {
  if (!path) return true;
  try {
    const { error } = await supabase.storage.from(IMAGES_BUCKET).remove([path]);
    if (error) {
      console.error('[supabase] Error borrando imagen:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] Fallo de red borrando imagen:', err);
    return false;
  }
}

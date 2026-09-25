// Capa de datos del PANEL (lado staff)
import { rpc, getSessionToken } from './supabaseClient';
import { supabase } from './supabaseClient';

const DB_TABLE_KEYS = ['clientes', 'personal', 'inventario'];

// dbGet/dbSet: leen y guardan un "bloque" completo (clientes, personal o inventario) de una…
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
  // IMPORTANTE: null significa que la llamada falló de verdad (red/RPC)
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

// Preferencias personales (tema + orden/anchos/ocultas de columnas) A diferencia de…
export async function dbSaveOwnPrefs(prefs) {
  const result = await rpc('staff_save_own_prefs', { p_token: getSessionToken(), p_prefs: prefs || {} });
  return result !== null;
}

// Clientes (tabla db_clientes_rows)
export async function dbGetClientRows() {
  const data = await rpc('staff_get_client_rows', { p_token: getSessionToken() });
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

// Auditoría (historial de cambios)
export function dbGetAuditLog(limit = 200) {
  return rpc('staff_get_audit_log', { p_token: getSessionToken(), p_limit: limit });
}

export function dbGetAllAuditLog(sinceDate) {
  return rpc('staff_get_all_audit_log', { p_token: getSessionToken(), p_since: sinceDate || null });
}

export async function dbInsertAuditBulk(entries) {
  if (!entries?.length) return true;
  const cleanEntries = entries.map((e) => { const rest = { ...e }; delete rest.id; return rest; }); // el id lo asigna la base
  const result = await rpc('staff_insert_audit_bulk', { p_token: getSessionToken(), p_entries: cleanEntries });
  return result !== null;
}

// Notas internas
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

// Snapshots del día (foto de cómo quedó el despacho de un día)
export async function dbUpsertSnapshot(date, payload) {
  const result = await rpc('staff_upsert_snapshot', { p_token: getSessionToken(), p_date: date, p_payload: payload });
  return result !== null;
}

export async function dbGetSnapshot(date) {
  const data = await rpc('staff_get_snapshot', { p_token: getSessionToken(), p_date: date });
  return Array.isArray(data) ? data[0] || null : data || null;
}

export function dbGetAllSnapshots(sinceDate) {
  return rpc('staff_get_all_snapshots', { p_token: getSessionToken(), p_since: sinceDate || null });
}

export async function dbUpsertSnapshotsBulk(snapshotsArray) {
  if (!snapshotsArray?.length) return true;
  const result = await rpc('staff_upsert_snapshots_bulk', { p_token: getSessionToken(), p_snapshots: snapshotsArray });
  return result !== null;
}

// Estado de entregas (quién recibió/no recibió cada día)
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

// Imágenes (logo, fotos de plan, fotos de choferes, etc.) El bucket "app-images" ya NO…
const IMAGES_BUCKET = 'app-images';
// Comprobantes de pago y fotos de entrega: bucket privado, sin URL pública permanente. En el payload
// se guarda solo la ruta y la Edge Function firma una URL temporal cuando alguien la quiere ver.
const DOCS_BUCKET = 'app-docs';
const DOC_FOLDERS = ['comprobantes', 'delivery-proof'];

export function bucketForPath(path) {
  return DOC_FOLDERS.includes(String(path || '').split('/')[0]) ? DOCS_BUCKET : IMAGES_BUCKET;
}

async function invokeImageStorage(action, path) {
  const { data, error } = await supabase.functions.invoke('image-storage', {
    body: { action, p_token: getSessionToken(), p_path: path },
  });
  if (error) {
    console.error(`[supabase] Error en Edge Function image-storage (${action}):`, error.message);
    return null;
  }
  if (data?.error) {
    console.error(`[supabase] image-storage rechazó la acción ${action}:`, data.error);
    return null;
  }
  return data;
}

export async function storageUploadImage(path, blob, contentType) {
  const bucket = bucketForPath(path);
  try {
    const signed = await invokeImageStorage('upload-url', path);
    if (!signed?.signedUrl || !signed?.token) return null;
    const { error } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(signed.path || path, signed.token, blob, { contentType, upsert: true });
    if (error) {
      console.error('[supabase] Error subiendo imagen con URL firmada:', error.message);
      return null;
    }
    if (bucket === DOCS_BUCKET) return signed.path || path;
    const { data } = supabase.storage.from(bucket).getPublicUrl(signed.path || path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('[supabase] Fallo de red subiendo imagen:', err);
    return null;
  }
}

// URL válida unos minutos para un archivo del bucket privado (o para uno viejo, que sigue en público).
export async function storageSignedUrl(path) {
  const data = await invokeImageStorage('sign-url', path);
  return data?.url || null;
}

export async function storageRemoveImage(path) {
  if (!path) return true;
  try {
    const result = await invokeImageStorage('remove', path);
    return result?.ok === true;
  } catch (err) {
    console.error('[supabase] Fallo de red borrando imagen:', err);
    return false;
  }
}

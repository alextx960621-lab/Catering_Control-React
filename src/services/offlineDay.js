import config from './config';

// Modo sin señal de la jornada del chofer.
//
// El chofer reparte en zonas donde el teléfono pierde red. Sin esto, abrir la app sin señal dejaba
// la lista vacía (el arranque del Panel no trae datos) y "Marcar entregado" fallaba en silencio,
// así que el chofer volvía a la oficina y el día estaba sin marcar.
//
// Guarda en IndexedDB (no en localStorage: las fotos son Blob y ahí no caben):
//   snapshots -> una copia del día: las paradas visibles y las marcas leídas del servidor
//   marks     -> las marcas hechas sin señal, en orden, esperando sincronía
//   photos    -> la foto de respaldo de esas marcas, indexada por la ruta que tendrá en Storage
//
// Todo lo público devuelve null/false en vez de lanzar: si IndexedDB está bloqueado (otra pestaña,
// modo incógnito de algunos WebView) la app sigue funcionando como antes, solo pierde el offline.
// La base se nombra con storagePrefix para que las tres empresas en un mismo teléfono no compartan cola.
const DB_NAME = `${config.storagePrefix}-offline-v1`;
const SNAPSHOTS = 'snapshots';
const MARKS = 'marks';
const PHOTOS = 'photos';

// Un mes: sobra para el viaje de un día y acota lo que ocupa en el teléfono.
const MAX_ANTIGUEDAD_MS = 30 * 24 * 60 * 60 * 1000;

export function isOnline() {
  // navigator.onLine es false solo si el sistema dice "sin interfaz"; una red cautiva sigue
  // dando true, por eso las escrituras intentan primero contra el servidor.
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; }); // si falló, la próxima intentada abre de nuevo
  return dbPromise;
}

// fn() debe devolver su IDBRequest de forma síncrona: la transacción se cierra sola cuando ya no
// hay pedidos pendientes, así que esperar un await antes de crear el segundo la cortaría.
async function run(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
  });
}

const clave = (userId, date) => `${userId}|${date}`;
const claveMarca = (userId, date, clientId) => `${userId}|${date}|${clientId}`;

async function silencio(promesa, valorPorDefecto) {
  try { return await promesa; } catch (err) {
    console.warn('[offline] IndexedDB no respondió:', err?.message || err);
    return valorPorDefecto;
  }
}

// Borra lo más viejo que MAX_ANTIGUEDAD_MS. Se llama después de guardar, no con un cron: el
// chofer abre la app una vez por día y ahí alcanza para podar.
async function podar() {
  const corte = Date.now() - MAX_ANTIGUEDAD_MS;
  const viejo = (iso) => !iso || Date.parse(iso) < corte;
  for (const store of [SNAPSHOTS, MARKS, PHOTOS]) {
    const items = await silencio(run(store, 'readonly', (s) => s.getAll()), []);
    for (const item of items || []) {
      if (!viejo(item.savedAt || item.queuedAt)) continue;
      await silencio(run(store, 'readwrite', (s) => s.delete(item[store === PHOTOS ? 'path' : 'key'])), null);
    }
  }
}

// ---------------------------------------------------------------------------
// Copia del día (paradas visibles + marcas del servidor)
// ---------------------------------------------------------------------------

// Se guarda la lista de paradas ya resuelta (los objetos cliente que la tabla usa tal cual) junto
// con las marcas: sin red no hay clientes ni rutas en memoria, y la tabla quedaría vacía.
export async function saveDaySnapshot(userId, date, snapshot) {
  if (!userId) return false;
  const ok = await silencio(run(SNAPSHOTS, 'readwrite', (s) => s.put({
    key: clave(userId, date), ...snapshot, savedAt: new Date().toISOString(),
  })), null);
  podar();
  return ok !== null;
}

export async function loadDaySnapshot(userId, date) {
  if (!userId) return null;
  const row = await silencio(run(SNAPSHOTS, 'readonly', (s) => s.get(clave(userId, date))), null);
  return row ? { clients: row.clients || [], records: row.records || [], savedAt: row.savedAt } : null;
}

// ---------------------------------------------------------------------------
// Cola de marcas pendientes
// ---------------------------------------------------------------------------

export async function queueMark({ userId, date, clientId, payload, photoPaths = [] }) {
  const ok = await silencio(run(MARKS, 'readwrite', (s) => s.put({
    key: claveMarca(userId, date, clientId), userId, date, clientId, payload, photoPaths,
    queuedAt: new Date().toISOString(),
  })), null);
  return ok !== null;
}

// Ordenadas por cuándo se hicieron: si el chofer marcó y después corrigió, la última gana.
export async function listQueuedMarks(userId, date) {
  const all = await silencio(run(MARKS, 'readonly', (s) => s.getAll()), []);
  return (all || [])
    .filter((m) => m.userId === userId && m.date === date)
    .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
}

export async function removeQueuedMarks(keys) {
  for (const key of keys) await silencio(run(MARKS, 'readwrite', (s) => s.delete(key)), null);
  return true;
}

// ---------------------------------------------------------------------------
// Fotos tomadas sin señal
// ---------------------------------------------------------------------------

export async function saveLocalPhoto(path, blob) {
  const ok = await silencio(run(PHOTOS, 'readwrite', (s) => s.put({ path, blob, savedAt: new Date().toISOString() })), null);
  return ok !== null;
}

export async function loadLocalPhoto(path) {
  if (!path) return null;
  const row = await silencio(run(PHOTOS, 'readonly', (s) => s.get(path)), null);
  return row?.blob || null;
}

export async function removeLocalPhoto(path) {
  await silencio(run(PHOTOS, 'readwrite', (s) => s.delete(path)), null);
  return true;
}

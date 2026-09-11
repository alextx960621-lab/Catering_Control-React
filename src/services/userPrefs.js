// Preferencias PERSONALES de un usuario de staff: tema visual + orden/
// ocultas/anchos de columnas de cada tabla. Viven en dos lugares:
//
//   1. localStorage de este navegador (STORE_KEY) -- lectura y escritura
//      SIEMPRE síncronas, para que la UI pinte al instante sin esperar
//      a la red (mismo criterio que tenía columnPrefs.js antes).
//   2. db_personal(id='userPrefs') en Supabase, vía staff_save_own_prefs
//      -- para que viajen entre dispositivos de la misma cuenta. Ver
//      supabase-setup-final-v2.sql sección 15.
//
// El localStorage sigue siendo la fuente de verdad MIENTRAS carga la
// sesión; en cuanto OperationsContext confirma qué hay guardado en el
// servidor para este usuario, llama a hydrateFromServer() para que la
// próxima lectura ya devuelva el valor de la cuenta (y no se quede
// pegado en lo último que se vio en este único dispositivo).
import { dbSaveOwnPrefs } from './db';

const STORE_KEY = 'catering-user-prefs-v2';
const SYNC_DEBOUNCE_MS = 900;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}
function writeStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* localStorage lleno/bloqueado */ }
}

function emptyEntry() {
  return { theme: null, columns: {} };
}

function getEntry(userId) {
  const store = readStore();
  return store[userId || 'default'] || emptyEntry();
}

function setEntry(userId, entry) {
  const store = readStore();
  store[userId || 'default'] = entry;
  writeStore(store);
}

// Un usuario puede tener el Panel abierto en varias pestañas/dispositivos
// a la vez; cada uno mantiene su propio "¿ya sé qué hay en el servidor
// para este usuario?" -- hasta que eso pase, no se empuja nada a
// Supabase (mismo espíritu que el patrón `confirmed` de
// OperationsContext: no writeamos a ciegas antes de confirmar qué hay).
const readyUsers = new Set();
const syncTimers = new Map();

function scheduleSync(userId) {
  if (!readyUsers.has(userId)) return; // todavía no se confirmó la base -- no empujar
  clearTimeout(syncTimers.get(userId));
  syncTimers.set(userId, setTimeout(() => {
    dbSaveOwnPrefs(getEntry(userId));
  }, SYNC_DEBOUNCE_MS));
}

// Llamado UNA VEZ desde OperationsContext cuando se confirma con éxito
// qué hay guardado en el servidor para este usuario (o que no hay nada
// todavía). `serverEntry` es userPrefs[userId] tal cual vino de
// staff_get_fields -- puede ser undefined/null si el usuario nunca
// guardó nada desde ningún dispositivo.
export function hydrateFromServer(userId, serverEntry) {
  if (!userId) return;
  if (serverEntry && typeof serverEntry === 'object') {
    setEntry(userId, { theme: serverEntry.theme || null, columns: serverEntry.columns || {} });
  }
  // Si serverEntry viene vacío, se deja el cache local tal cual (por si
  // ya había algo elegido en ESTE dispositivo antes de que existiera la
  // sincronización) y, al marcar `ready`, ese valor local se sube solo.
  readyUsers.add(userId);
  scheduleSync(userId);
}

export function getTheme(userId) {
  return getEntry(userId).theme;
}

export function setTheme(userId, theme) {
  const entry = getEntry(userId);
  setEntry(userId, { ...entry, theme });
  scheduleSync(userId);
}

export function getColumnPrefs(userId, group) {
  const entry = getEntry(userId).columns[group] || {};
  return { hidden: entry.hidden || [], order: entry.order || [], widths: entry.widths || {} };
}

function updateColumnGroup(userId, group, patch) {
  const entry = getEntry(userId);
  const columns = { ...entry.columns, [group]: { ...getColumnPrefs(userId, group), ...patch } };
  setEntry(userId, { ...entry, columns });
  scheduleSync(userId);
}

export function saveHiddenColumns(userId, group, hidden) {
  updateColumnGroup(userId, group, { hidden });
}
export function saveColumnOrder(userId, group, order) {
  updateColumnGroup(userId, group, { order });
}
export function saveColumnWidths(userId, group, widths) {
  updateColumnGroup(userId, group, { widths });
}

// Aplica el orden guardado (si hay) a la lista de columnas por defecto,
// y saca las que el usuario ocultó. Las columnas nuevas que no estén en
// las preferencias guardadas (ej. un artículo de menú agregado después)
// se agregan al final, para no perderlas de vista.
export function arrangeColumns(columns, prefs) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = prefs.order.length ? [...prefs.order.filter((k) => byKey.has(k)), ...columns.map((c) => c.key).filter((k) => !prefs.order.includes(k))] : columns.map((c) => c.key);
  return ordered.filter((k) => !prefs.hidden.includes(k)).map((k) => byKey.get(k));
}

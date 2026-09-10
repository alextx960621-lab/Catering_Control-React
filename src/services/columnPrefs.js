// Preferencias de columnas de las tablas grandes (por ahora, Día de
// trabajo): qué columnas mostrar y en qué orden. Es una preferencia
// PERSONAL (por usuario, guardada en localStorage del navegador), no se
// sincroniza entre dispositivos ni afecta a otros usuarios del equipo.
const STORE_KEY = 'catering-column-prefs-v1';

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}
function writeStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* localStorage lleno/bloqueado */ }
}

export function getColumnPrefs(userId, group) {
  const store = readStore();
  const entry = store[userId || 'default']?.[group] || {};
  return { hidden: entry.hidden || [], order: entry.order || [], widths: entry.widths || {} };
}

function updateGroup(userId, group, patch) {
  const store = readStore();
  const key = userId || 'default';
  store[key] ||= {};
  store[key][group] = { ...getColumnPrefs(userId, group), ...patch };
  writeStore(store);
}

export function saveHiddenColumns(userId, group, hidden) {
  updateGroup(userId, group, { hidden });
}
export function saveColumnOrder(userId, group, order) {
  updateGroup(userId, group, { order });
}
export function saveColumnWidths(userId, group, widths) {
  updateGroup(userId, group, { widths });
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

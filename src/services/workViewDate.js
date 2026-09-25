// Fecha que cada usuario eligió mirar en vez del "hoy" operativo: Día de trabajo (panel) y la
// vista propia del driver (fusionado acá con driverViewDate.js, que solo reexporta lo suyo).
// Mismo patrón de storage (mapa por userId, invalidado si cambia el "hoy" real) con dos pares
// de funciones porque cada uno devuelve una forma distinta.
function makeStore(storeKey) {
  const read = () => { try { return JSON.parse(localStorage.getItem(storeKey)) || {}; } catch { return {}; } };
  const write = (store) => { try { localStorage.setItem(storeKey, JSON.stringify(store)); } catch {/* lleno/bloqueado */} };
  return { read, write };
}

const workStore = makeStore('catering-work-view-date-v1');
export function getWorkViewDate(userId, today) {
  const entry = workStore.read()[userId];
  return entry?.setOn === today && entry.date ? entry : null;
}
export function setWorkViewDate(userId, entry) {
  const store = workStore.read();
  if (entry?.date) store[userId] = entry;
  else delete store[userId];
  workStore.write(store);
}

const driverStore = makeStore('catering-driver-view-date-v1');
export function getDriverViewDate(userId, realToday) {
  const entry = driverStore.read()[userId];
  return entry?.setOn === realToday ? entry.date || '' : '';
}
export function setDriverViewDate(userId, dateStr, realToday) {
  const store = driverStore.read();
  if (dateStr) store[userId] = { date: dateStr, setOn: realToday };
  else delete store[userId];
  driverStore.write(store);
}

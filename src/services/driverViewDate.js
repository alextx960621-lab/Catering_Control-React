// La fecha que un driver elige mirar en Día de trabajo (para consultar un
// día pasado) se guarda por usuario, con la fecha en que se eligió
// (`setOn`). Si al volver a entrar ya pasó el día en el que se eligió, se
// ignora sola y vuelve a mostrar el día actual -- así no queda "pegada"
// para siempre una fecha vieja que el driver miró una sola vez.
const STORE_KEY = 'catering-driver-view-date-v1';

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}

export function getDriverViewDate(userId, realToday) {
  const entry = readStore()[userId];
  if (!entry || entry.setOn !== realToday) return '';
  return entry.date || '';
}

export function setDriverViewDate(userId, dateStr, realToday) {
  const store = readStore();
  if (dateStr) store[userId] = { date: dateStr, setOn: realToday };
  else delete store[userId];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* localStorage lleno/bloqueado */ }
}

// Compartido entre el editor del Panel (MenuPage.jsx) y la web pública
// (MenuSemanalPage.jsx) para que ambos usen exactamente las mismas claves
// de día y el mismo formateo de texto.

export const MENU_DAYS = [
  ['lun', 'Lunes'],
  ['mar', 'Martes'],
  ['mie', 'Miércoles'],
  ['jue', 'Jueves'],
  ['vie', 'Viernes'],
  ['sab', 'Sábado'],
  ['dom', 'Domingo'],
];

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convierte el texto plano que escribe el personal (una idea por línea)
// en HTML simple -- sin dejar pasar HTML propio de lo que se escribió,
// para no abrir la puerta a un script o link raro sin querer.
export function formatMenuText(text) {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return `<ul class="menu-day-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

// Índice (0 = lunes) del día de hoy según la clave usada acá arriba,
// para poder resaltar la ficha del día actual en la web pública.
export function todayMenuKey() {
  const jsDay = new Date().getDay(); // 0 = domingo ... 6 = sábado
  return MENU_DAYS[(jsDay + 6) % 7][0];
}

// Compartido entre el editor del Panel (MenuPage.jsx) y la web pública…

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

// Convierte el texto plano que escribe el personal (una idea por línea) en HTML simple…
export function formatMenuText(text) {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return `<ul class="menu-day-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

// Índice (0 = lunes) del día de hoy según la clave usada acá arriba, para poder resaltar la…
export function todayMenuKey() {
  const jsDay = new Date().getDay(); // 0 = domingo ..
  return MENU_DAYS[(jsDay + 6) % 7][0];
}

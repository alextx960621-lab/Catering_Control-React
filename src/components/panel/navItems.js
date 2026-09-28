// Fuente única de verdad del menú: Sidebar lo filtra para pintar y PanelPage lo recorre para
// corregir la pantalla activa. Vive aparte del componente para no mezclar constantes y
// componentes en el mismo módulo (fast refresh).
export const NAV_ITEMS = [
  ['dispatch', '📅'],
  ['notes', '🔔'],
  ['menu', '🍲'],
  ['publicidad', '📣'],
  ['clients', '👥'],
  ['delivery', '🚚'],
  ['drivers', '🛵'],
  ['routes', '🚦'],
  ['plans', '📝'],
  ['payroll', '💵'],
  ['inventory', '📊'],
  ['metrics', '📈'],
  ['users', '👨‍✈️'],
  ['audit', '🕘'],
  ['settings', '🛠️'],
];

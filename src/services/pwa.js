// Detecta si la app corre instalada como PWA (standalone), sin la barra
// de direcciones del navegador -- se usa para decidir cosas que solo
// tienen sentido ahí: mostrar "Compartir esta app" (no hay barra de la
// que copiar el link) y mantener la sesión del cliente guardada entre
// aperturas (ver session.js: en una pestaña normal del navegador la
// sesión se sigue cerrando sola al cerrar la pestaña, a propósito, por si
// alguien usa un navegador compartido).
export function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// Detecta si la app corre instalada como PWA (standalone), sin la barra de direcciones del…
export function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

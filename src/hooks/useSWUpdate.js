import { useRegisterSW } from 'virtual:pwa-register/react';

// Antes (main.jsx viejo) el service worker se actualizaba solo, en
// silencio, sin avisarle a nadie -- por eso, si por lo que sea la pestaña
// no terminaba de tomar la versión nueva (service worker viejo todavía
// activo, CDN sirviendo un index.html cacheado, etc.), no había ninguna
// forma de notarlo ni de forzarlo a mano. Esto es lo que pedía el dueño:
// el mismo botón de "hay una actualización" que tenía la versión vanilla.
//
// needRefresh pasa a true en cuanto el navegador terminó de descargar en
// segundo plano una versión nueva del service worker. No se recarga sola
// -- así no se pierde algo que la persona esté llenando -- hasta que
// alguien toque "Actualizar ahora".
export function useSWUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => registration.update(), 60 * 60 * 1000);
    },
  });

  return {
    needRefresh,
    dismiss: () => setNeedRefresh(false),
    update: () => updateServiceWorker(true),
  };
}

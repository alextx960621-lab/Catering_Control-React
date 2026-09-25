import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Cómo se entera la app de que hay una versión nueva (dos vías, por si una falla):
//   1. El service worker (registerType 'prompt'): detecta el sw.js nuevo y lo deja "en espera".
//   2. /version.json: se compara con __BUILD_ID__ (la compilación que está corriendo). Sirve
//      aunque el service worker se haya quedado trabado -- que era lo que obligaba a
//      desinstalar y reinstalar la app instalada en el celular.
// La actualización se aplica sola cuando es seguro (recién abierta la app, o al volver
// después de un buen rato en segundo plano); si no, sale el aviso "Actualizar ahora".
const CHECK_EVERY_MS = 10 * 60 * 1000; // con la app abierta
const AUTO_APPLY_AT_START_MS = 15 * 1000; // ventana al abrir la app en la que se actualiza sin preguntar
const AUTO_APPLY_AFTER_HIDDEN_MS = 30 * 60 * 1000; // volver de segundo plano después de tanto rato
const REMIND_AFTER_MS = 15 * 60 * 1000; // si tocan "Ahora no", el aviso vuelve a salir
const HARD_REFRESH_KEY = 'catering-hard-refresh-at';

async function fetchRemoteBuildId() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.id === 'string' ? data.id : null;
  } catch {
    return null;
  }
}

// Actualización a la fuerza: da de baja el service worker, borra sus cachés y recarga.
// No toca la sesión ni los datos guardados (localStorage/sessionStorage).
async function hardRefresh() {
  try {
    const last = Number(sessionStorage.getItem(HARD_REFRESH_KEY)) || 0;
    if (Date.now() - last < 2 * 60 * 1000) return; // evita un bucle de recargas
    sessionStorage.setItem(HARD_REFRESH_KEY, String(Date.now()));
  } catch { /* sin sessionStorage: se sigue igual */ }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* si algo falla igual se recarga */ }
  window.location.reload();
}

export function useSWUpdate() {
  const registrationRef = useRef(null);
  const startedAtRef = useRef(0);
  const autoApplyRef = useRef(false);
  const [outdated, setOutdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [swWaiting],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration || null;
    },
  });

  const updateAvailable = swWaiting || outdated;

  const applyUpdate = useCallback(() => {
    if (swWaiting) {
      updateServiceWorker(true); // activa el nuevo y recarga
      window.setTimeout(hardRefresh, 6000); // si no recargó sola, se fuerza
    } else {
      hardRefresh();
    }
  }, [swWaiting, updateServiceWorker]);

  useEffect(() => {
    startedAtRef.current = Date.now();
    if (import.meta.env.DEV) return undefined;
    let hiddenAt = 0;

    async function check() {
      registrationRef.current?.update().catch(() => {});
      const remote = await fetchRemoteBuildId();
      if (remote && remote !== __BUILD_ID__) setOutdated(true);
    }
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > AUTO_APPLY_AFTER_HIDDEN_MS) autoApplyRef.current = true;
      hiddenAt = 0;
      check();
    }

    check();
    const id = window.setInterval(() => { if (!document.hidden) check(); }, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', check);
    };
  }, []);

  // Recién abierta la app (o de vuelta tras mucho rato) todavía no hay nada a medio
  // escribir: se actualiza sin molestar.
  useEffect(() => {
    if (!updateAvailable) return;
    if (autoApplyRef.current || Date.now() - startedAtRef.current < AUTO_APPLY_AT_START_MS) applyUpdate();
  }, [updateAvailable, applyUpdate]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    window.setTimeout(() => setDismissed(false), REMIND_AFTER_MS);
  }, []);

  return { needRefresh: updateAvailable && !dismissed, dismiss, update: applyUpdate };
}

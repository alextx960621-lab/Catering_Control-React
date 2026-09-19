import { useEffect, useState } from 'react';
import { isStandalonePwa } from '../services/pwa';
import { pushSupported, subscribeToPush } from '../services/push';

// Se llama una vez al entrar al portal del cliente (ver Portal.jsx).
//
// OJO con una limitación real del navegador, no de este código: una vez
// que alguien TOCA "Bloquear" en el permiso de notificaciones, ningún
// sitio puede volver a mostrar ese cartel del sistema -- ni Chrome ni
// Safari lo permiten, es al revés de a propósito (para que un sitio no
// pueda insistir). Por eso acá:
//   - si el permiso todavía no se decidió ('default'), se pide. Como
//     `updateServiceWorker(true)` (ver useSWUpdate.js) recarga la
//     página entera después de cada actualización de la PWA, este hook
//     se vuelve a correr solo en cada actualización -- así se cumple
//     "pedir de nuevo cada vez que actualiza" para el único caso en el
//     que el navegador todavía lo permite.
//   - si ya está 'denied', no se puede re-preguntar por las buenas: se
//     devuelve `blocked: true` para que el portal pueda mostrar un
//     aviso explicando cómo habilitarlo a mano desde el navegador.
export function usePushSubscription(active) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!active || !pushSupported() || !isStandalonePwa()) return;

    if (Notification.permission === 'denied') {
      setBlocked(true);
      return;
    }
    setBlocked(false);

    if (Notification.permission === 'granted') {
      subscribeToPush();
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') subscribeToPush();
      else if (permission === 'denied') setBlocked(true);
    });
  }, [active]);

  return { blocked };
}

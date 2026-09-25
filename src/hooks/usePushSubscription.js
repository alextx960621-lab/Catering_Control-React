import { useEffect, useState } from 'react';
import { isStandalonePwa } from '../services/pwa';
import { pushSupported, subscribeToPush } from '../services/push';

// Se llama una vez al entrar al portal del cliente (ver Portal.jsx)
export function usePushSubscription(active) {
  const [deniedAfterAsking, setDeniedAfterAsking] = useState(false);
  const enabled = active && pushSupported() && isStandalonePwa();
  const blocked = enabled && (deniedAfterAsking || Notification.permission === 'denied');

  useEffect(() => {
    if (!enabled || Notification.permission === 'denied') return;

    if (Notification.permission === 'granted') {
      subscribeToPush();
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') subscribeToPush();
      else if (permission === 'denied') setDeniedAfterAsking(true);
    });
  }, [enabled]);

  return { blocked };
}

import { useState } from 'react';
import { pushSupported, subscribeToStaffPush } from '../services/push';

function initialStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'idle';
}

// Se llama desde Configuración ("Avisos de notas del portal"): a diferencia del recordatorio de
// clientes (que se pide solo al entrar), acá el editor/admin lo activa con un botón a propósito.
export function useStaffPushSubscription() {
  const [status, setStatus] = useState(initialStatus);

  async function enable() {
    if (!pushSupported()) { setStatus('unsupported'); return; }
    setStatus('asking');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') { setStatus(permission); return; }
    const ok = await subscribeToStaffPush();
    setStatus(ok ? 'granted' : 'error');
  }

  return { status, enable };
}

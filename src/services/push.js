import config from './config';
import { dbSavePushSubscription, dbSaveStaffPushSubscription } from './supabaseClient';

// "VAPID pública en base64url" -> Uint8Array, formato que pide PushManager.subscribe()
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Se suscribe (o reusa la suscripción que ya hubiera) y la guarda en Supabase
export async function subscribeToPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      });
    }
    return dbSavePushSubscription(subscription.toJSON());
  } catch (err) {
    console.error('[push] No se pudo suscribir:', err);
    return false;
  }
}

// Igual que subscribeToPush(), pero para editores/admins/superadmin (ver SettingsPage →
// "Avisos de notas del portal"). Usa el mismo par de claves VAPID.
export async function subscribeToStaffPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      });
    }
    return dbSaveStaffPushSubscription(subscription.toJSON());
  } catch (err) {
    console.error('[push] No se pudo suscribir (staff):', err);
    return false;
  }
}

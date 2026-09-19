import config from './config';
import { dbSavePushSubscription, dbRemovePushSubscription } from './supabaseClient';

// "VAPID pública en base64url" -> Uint8Array, formato que pide
// PushManager.subscribe(). Es el conversor estándar que recomienda la
// documentación de la Push API, no tiene nada específico de este proyecto.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Se suscribe (o reusa la suscripción que ya hubiera) y la guarda en
// Supabase. Asume que el permiso YA fue concedido -- pedirlo es
// responsabilidad de quien llama (ver usePushSubscription.js), porque
// el navegador exige que ese pedido pase por un gesto o contexto
// razonable, no algo para hacer a ciegas en cualquier función utilitaria.
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

export async function unsubscribeFromPush() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await dbRemovePushSubscription(endpoint);
  } catch (err) {
    console.error('[push] No se pudo cancelar la suscripción:', err);
  }
}

// public/push-sw.js
//
// Se agrega al service worker generado por vite-plugin-pwa vía
// `workbox.importScripts` (ver vite.config.js) -- así no hace falta pasar
// todo el proyecto al modo "injectManifest" solo para esto. Este archivo
// corre en el contexto del service worker (self), NO en la página.

self.addEventListener('push', (event) => {
  let data = { title: 'Catering', body: 'Tenés una notificación nueva.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    /* si el payload no es JSON válido, se muestra el texto por defecto */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'catering-recordatorio', // una notificación nueva reemplaza a la anterior en vez de amontonarse
    }),
  );
});

// Al tocar la notificación: enfoca una pestaña de la app ya abierta, o
// abre una nueva en el portal del cliente si no había ninguna.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('/cliente');
    })(),
  );
});

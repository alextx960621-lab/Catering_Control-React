// public/push-sw.js Se agrega al service worker generado por vite-plugin-pwa vía…

self.addEventListener('push', (event) => {
  let data = { title: 'Catering', body: 'Tenés una notificación nueva.', tag: 'catering-recordatorio', url: '/cliente' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {/* si el payload no es JSON válido, se muestra el texto por defecto */}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag, // una notificación nueva del mismo tipo reemplaza a la anterior en vez de…
      vibrate: [200, 100, 200], // para que además de sonar, vibre en el celular
      data: { url: data.url },
    }),
  );
});

// Al tocar la notificación: enfoca una pestaña de la app ya abierta, o abre una nueva en la…
// sección que corresponda (el portal del cliente o el panel de staff, según data.url).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/cliente';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});

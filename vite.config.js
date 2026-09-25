import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Identificador de ESTA compilación. Se mete en el código (__BUILD_ID__) y se
// publica en /version.json: la app compara los dos para enterarse de que hay
// una versión nueva aunque el service worker no lo haya detectado (ver
// hooks/useSWUpdate.js).
const BUILD_ID = Date.now().toString(36);
const emitVersionFile = {
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
};

// La idea de cacheo es la misma que tenía sw.js a mano: El HTML de las páginas…
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    // exceljs (~930 kB) se carga con import() solo al exportar a Excel, no pesa en la carga…
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
    emitVersionFile,
    VitePWA({
      registerType: 'prompt', // espera a que la persona toque "Actualizar ahora" en…
      injectRegister: false, // el registro del service worker se hace a mano en main.jsx…
      includeAssets: ['icons/*.png', 'manifest.json'],
      manifest: false, // usamos public/manifest.json tal cual, no uno generado
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/config\.js$/],
        // push-sw.js: maneja los eventos `push` y `notificationclick` (ver ese archivo)
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            // Siempre de la red: si se cacheara, la app nunca se enteraría de una versión nueva
            urlPattern: ({ url }) => url.pathname === '/version.json',
            handler: 'NetworkOnly',
          },
          {
            // Páginas (navegación entre rutas de React Router)
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'paginas' },
          },
          {
            // Nunca cachear nada de Supabase: siempre datos frescos
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkOnly',
          },
          {
            // manifest.json aparte, y con NetworkFirst en vez de CacheFirst: es un archivo chico que…
            urlPattern: ({ url }) => url.pathname.endsWith('/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'manifest', expiration: { maxEntries: 1, maxAgeSeconds: 24 * 60 * 60 } },
          },
          {
            // Íconos: StaleWhileRevalidate en vez de CacheFirst puro
            urlPattern: ({ url, request }) => request.destination === 'image' && url.pathname.includes('/icons/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'iconos',
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Resto de archivos estáticos PROPIOS (CSS/JS/fuentes/imágenes): caché primero.
            // Solo same-origin: un CSS de terceros cacheado acá ya dejó una vez la app sin
            // estilos en Chrome (copía vieja en caché vs. hash integrity del index.html).
            urlPattern: ({ request, url }) =>
              ['style', 'script', 'image', 'font'].includes(request.destination) && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'estaticos',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // De terceros (Google Fonts): siempre revalida contra la red para no quedar
            // pegado a una copia vieja de la caché del service worker.
            urlPattern: ({ request, url }) =>
              ['style', 'script', 'image', 'font'].includes(request.destination) && url.origin !== self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'terceros',
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});

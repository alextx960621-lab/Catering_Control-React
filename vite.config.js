import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// La idea de cacheo es la misma que tenía sw.js a mano:
//   - El HTML de las páginas (login/panel/cliente) va primero por RED, y
//     solo si no hay internet se usa la copia guardada. Así, al actualizar
//     la app, la próxima vez que se abra siempre trae la versión nueva.
//   - Todo lo demás (CSS, JS, íconos) va primero por CACHÉ, para no gastar
//     datos/tiempo descargando de nuevo lo que no cambió.
//   - Nunca se cachea nada que vaya hacia supabase.co (esos datos siempre
//     tienen que ser los más recientes).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // se actualiza sola en segundo plano, sin pedirle nada al usuario
      injectRegister: false, // el registro del service worker se hace a mano en main.jsx (para poder revisar cada cierto tiempo si hay versión nueva mientras la app sigue abierta)
      includeAssets: ['icons/*.png', 'manifest.json'],
      manifest: false, // usamos public/manifest.json tal cual, no uno generado
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/config\.js$/],
        runtimeCaching: [
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
            // manifest.json aparte, y con NetworkFirst en vez de CacheFirst:
            // es un archivo chico que casi no pesa, así que no vale la pena
            // arriesgarse a servir uno viejo (con el ícono/nombre/tema
            // anteriores) si el usuario cambió el branding. Antes caía en
            // la regla de "estáticos" de abajo (CacheFirst 30 días).
            urlPattern: ({ url }) => url.pathname.endsWith('/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'manifest', expiration: { maxEntries: 1, maxAgeSeconds: 24 * 60 * 60 } },
          },
          {
            // Íconos: StaleWhileRevalidate en vez de CacheFirst puro. Sirve
            // la copia cacheada al instante (rápido, como antes) pero
            // dispara en paralelo un pedido de red que refresca la caché
            // para la próxima vez — así, si se sube un ícono nuevo con el
            // mismo nombre de archivo, se ve actualizado en la segunda
            // carga en vez de tener que esperar 30 días o forzar un
            // refresh completo del navegador.
            urlPattern: ({ url, request }) => request.destination === 'image' && url.pathname.includes('/icons/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'iconos',
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Resto de archivos estáticos (CSS/JS/fuentes/otras imágenes):
            // caché primero. Estos SÍ llevan hash de contenido en el
            // nombre de archivo (Vite los renombra en cada build), así que
            // CacheFirst es seguro: un cambio real siempre pide una URL
            // nueva, nunca sirve contenido viejo con el mismo nombre.
            urlPattern: ({ request }) =>
              ['style', 'script', 'image', 'font'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'estaticos',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});

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
      registerType: 'prompt', // el usuario decide cuándo actualizar (igual que "Actualización disponible" del sw.js viejo)
      includeAssets: ['icons/*.png'],
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
            // Resto de archivos estáticos (CSS/JS/íconos): caché primero
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

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registra el service worker de la PWA y la mantiene actualizada sola: no
// hace falta ir a cambiar ningún número de versión a mano (eso lo hacía el
// sw.js viejo) — cada build genera archivos con hash nuevo, y esto se
// encarga de detectar la versión nueva y activarla en segundo plano,
// incluso si la app se queda abierta muchas horas seguidas.
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({ immediate: true });
    // El navegador solo revisa automáticamente si hay versión nueva al
    // recargar la página; como este panel se puede quedar abierto todo el
    // día, acá se fuerza una revisión cada hora.
    setInterval(() => updateSW(), 60 * 60 * 1000);
  });
}

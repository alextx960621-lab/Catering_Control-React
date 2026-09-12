import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// El registro del service worker (y el aviso de "nueva versión
// disponible") lo maneja el hook useSWUpdate, montado dentro de
// <UpdateBanner /> en App.jsx -- así se ve un botón real en vez de
// actualizarse en silencio y quedar la duda de si el deploy nuevo ya
// llegó o no.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

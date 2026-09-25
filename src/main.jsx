import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './i18n'; // inicializa i18next (debe ir antes de renderizar)
// Bootstrap va local (no CDN): con el CDN + integrity, una copia vieja en la caché del
// service worker hacía que Chrome descartara el CSS y la app quedara sin estilos.
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/buttons.css';

// El registro del service worker (y el aviso de "nueva versión disponible") lo maneja el…
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

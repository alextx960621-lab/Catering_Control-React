import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import PanelPage from './pages/PanelPage';
import ClientePage from './pages/ClientePage';
import TerminosPage from './pages/TerminosPage';
import PrivacidadPage from './pages/PrivacidadPage';

// Estas 3 rutas son el equivalente directo a los 3 archivos .html que tenía
// la versión anterior:
//   login.html  → /            (login de equipo y de cliente)
//   panel.html  → /panel       (panel interno: operaciones, despacho, etc.)
//   cliente.html→ /cliente     (portal de autoservicio del cliente)
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/panel" element={<PanelPage />} />
        <Route path="/cliente" element={<ClientePage />} />
        <Route path="/terminos" element={<TerminosPage />} />
        <Route path="/privacidad" element={<PrivacidadPage />} />
        {/* Cualquier ruta desconocida vuelve al login, igual que el
            service worker viejo mandaba todo lo desconocido a index.html */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

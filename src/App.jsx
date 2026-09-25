import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CompanyPrefsProvider } from './context/CompanyPrefsContext';
import LoginPage from './pages/LoginPage';
import UpdateBanner from './components/UpdateBanner';
import InstallBanner from './components/InstallBanner';

const PanelPage = lazy(() => import('./pages/PanelPage'));
const ClientePage = lazy(() => import('./pages/ClientePage'));
const TerminosPage = lazy(() => import('./pages/TerminosPage'));
const PrivacidadPage = lazy(() => import('./pages/PrivacidadPage'));
const MenuSemanalPage = lazy(() => import('./pages/MenuSemanalPage'));

// Estas 3 rutas son el equivalente directo a los 3 archivos .html que tenía la versión…
export default function App() {
  return (
    <CompanyPrefsProvider>
      <BrowserRouter>
        {/* En flujo normal (no position:fixed): empuja el contenido de abajo en vez de taparlo */}
        <div className="app-banners">
          <UpdateBanner />
          <InstallBanner />
        </div>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route path="/panel" element={<PanelPage />} />
            <Route path="/cliente" element={<ClientePage />} />
            <Route path="/menu-semanal" element={<MenuSemanalPage />} />
            <Route path="/terminos" element={<TerminosPage />} />
            <Route path="/privacidad" element={<PrivacidadPage />} />
            {/* Cualquier ruta desconocida vuelve al login, igual que el service worker viejo mandaba… */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </CompanyPrefsProvider>
  );
}

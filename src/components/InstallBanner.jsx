import { useEffect, useState } from 'react';
import './Banners.css';
import { isStandalonePwa } from '../services/pwa';

function isIos() {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) return true;
  // iPadOS 13+ se anuncia como un Mac de escritorio por defecto (no dice
  // "iPad" en el user agent) -- se distingue por tener pantalla táctil,
  // cosa que un Mac de verdad no tiene.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Android/PC avisan solos con "beforeinstallprompt" cuando la app ya
// cumple los requisitos (manifest + service worker); se frena con
// preventDefault() para mostrarlo con nuestro propio botón.
// iOS nunca dispara ese evento -- Apple no da forma de programar la
// instalación, solo mostrar el instructivo de Compartir > Agregar a inicio.
//
// Usa las mismas clases .app-banner/.app-banner__btn-* que UpdateBanner,
// para que las dos se vean como el mismo tipo de aviso.
export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalonePwa()) return;
    if (isIos()) { setShowIosHint(true); return; }
    function onPrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setDeferredPrompt(null));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (dismissed || isStandalonePwa()) return null;
  if (!deferredPrompt && !showIosHint) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <div role="status" className="app-banner">
      {deferredPrompt ? (
        <>
          <span>Instalá la app para un acceso más rápido, desde el ícono de tu pantalla.</span>
          <div className="app-banner__actions">
            <button type="button" onClick={handleInstall} className="app-banner__btn-primary">
              Instalar
            </button>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar aviso" className="app-banner__btn-secondary">
              Ahora no
            </button>
          </div>
        </>
      ) : (
        <>
          <span>Instalá esta app: tocá <b>Compartir</b> ⬆️ y luego <b>"Agregar a inicio"</b>.</span>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar aviso" className="app-banner__btn-secondary">
            Entendido
          </button>
        </>
      )}
    </div>
  );
}

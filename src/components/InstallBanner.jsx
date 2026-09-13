import { useEffect, useState } from 'react';

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Android/PC avisan solos con "beforeinstallprompt" cuando la app ya
// cumple los requisitos (manifest + service worker); se frena con
// preventDefault() para mostrarlo con nuestro propio botón.
// iOS nunca dispara ese evento -- Apple no da forma de programar la
// instalación, solo mostrar el instructivo de Compartir > Agregar a inicio.
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
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99998,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexWrap: 'wrap', padding: '10px 16px', background: '#3867f4', color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, boxShadow: '0 2px 10px rgba(0,0,0,.2)',
      }}
    >
      {deferredPrompt ? (
        <>
          <span>Instalá la app para un acceso más rápido, desde el ícono de tu pantalla.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleInstall}
              style={{ border: 0, borderRadius: 999, padding: '6px 16px', fontWeight: 700, cursor: 'pointer', background: '#fff', color: '#3867f4' }}
            >
              Instalar
            </button>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar aviso" style={{ border: '1px solid rgba(255,255,255,.4)', borderRadius: 999, padding: '6px 12px', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
              Ahora no
            </button>
          </div>
        </>
      ) : (
        <>
          <span>Instalá esta app: tocá <b>Compartir</b> (el ícono ⬆️ de abajo) y luego <b>"Agregar a inicio"</b>.</span>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar aviso" style={{ border: '1px solid rgba(255,255,255,.4)', borderRadius: 999, padding: '6px 12px', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
            Entendido
          </button>
        </>
      )}
    </div>
  );
}

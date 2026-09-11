import { useState } from 'react';

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

const ShareIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
    <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
  </svg>
);

const CheckIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// Solo tiene sentido este botón cuando la app está instalada como PWA:
// ahí no hay barra de direcciones de la que copiar el link, así que no hay
// otra forma de pasarle el acceso a otra persona (un cliente nuevo, un
// driver nuevo, etc). En una pestaña normal del navegador ya está la barra
// de arriba, así que no lo mostramos para no ensuciar la pantalla.
export default function ShareAppButton({ brandName }) {
  // 'idle' | 'copied' | 'error' — antes solo había un booleano "copied" y el
  // único feedback era el cambio de ícono (muy sutil, en desktop parecía que
  // el botón "no hacía nada"). Ahora se muestra además un texto explícito.
  const [status, setStatus] = useState('idle');

  if (!isStandalonePwa()) return null;

  const shareUrl = `${location.origin}${location.pathname}`;

  function flashStatus(next) {
    setStatus(next);
    setTimeout(() => setStatus('idle'), 2200);
  }

  async function handleShare() {
    const shareData = { title: brandName, text: `Ingresá a ${brandName}`, url: shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (_) {
        // el usuario canceló el panel de compartir: no hacemos nada más
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      flashStatus('copied');
    } catch (_) {
      // clipboard bloqueado por permisos en el contexto de la PWA instalada:
      // avisar explícitamente en vez de quedar en silencio.
      flashStatus('error');
    }
  }

  const label =
    status === 'copied' ? 'Link copiado' : status === 'error' ? 'No se pudo copiar' : 'Compartir esta app';

  return (
    <span className="share-app-btn-wrap position-relative d-inline-flex flex-shrink-0">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0"
        style={{ width: 36, height: 36 }}
        onClick={handleShare}
        title={label}
        aria-label={label}
      >
        {status === 'copied' ? CheckIcon : ShareIcon}
      </button>
      {status !== 'idle' && (
        <span
          className={`share-app-btn-toast${status === 'error' ? ' share-app-btn-toast-error' : ''}`}
          role="status"
        >
          {status === 'copied' ? 'Link copiado ✅' : 'No se pudo copiar el link'}
        </span>
      )}
    </span>
  );
}

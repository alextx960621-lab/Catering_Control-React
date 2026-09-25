import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStandalonePwa } from '../../services/pwa';

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

// Solo tiene sentido este botón cuando la app está instalada como PWA: ahí no hay barra de…
export default function ShareAppButton({ brandName }) {
  const { t } = useTranslation();
  // 'idle' | 'copied' | 'error' -- controla tanto el ícono como el texto explícito al lado…
  const [status, setStatus] = useState('idle');

  if (!isStandalonePwa()) return null;

  const shareUrl = `${location.origin}${location.pathname}`;

  function flashStatus(next) {
    setStatus(next);
    setTimeout(() => setStatus('idle'), 2200);
  }

  async function handleShare() {
    const shareData = { title: brandName, text: t('login.shareText', { brand: brandName }), url: shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // el usuario canceló el panel de compartir: no hacemos nada más
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      flashStatus('copied');
    } catch {
      // clipboard bloqueado por permisos en el contexto de la PWA instalada: avisar…
      flashStatus('error');
    }
  }

  const label =
    status === 'copied' ? t('login.linkCopied') : status === 'error' ? t('login.couldNotCopy') : t('login.shareApp');

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
          {status === 'copied' ? t('login.linkCopiedToast') : t('login.couldNotCopyToast')}
        </span>
      )}
    </span>
  );
}

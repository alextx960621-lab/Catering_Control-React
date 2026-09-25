import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import './Banners.css';
import { isStandalonePwa } from '../services/pwa';

function isIos() {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) return true;
  // iPadOS 13+ se anuncia como un Mac de escritorio por defecto (no dice "iPad" en el user…
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Android/PC avisan solos con "beforeinstallprompt" cuando la app ya cumple los requisitos…
export default function InstallBanner() {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint] = useState(() => !isStandalonePwa() && isIos());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalonePwa() || showIosHint) return;
    function onPrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setDeferredPrompt(null));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [showIosHint]);

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
          <span>{t('install.text')}</span>
          <div className="app-banner__actions">
            <button type="button" onClick={handleInstall} className="app-banner__btn-primary">
              {t('install.installBtn')}
            </button>
            <button type="button" onClick={() => setDismissed(true)} aria-label={t('install.closeAria')} className="app-banner__btn-secondary">
              {t('install.later')}
            </button>
          </div>
        </>
      ) : (
        <>
          <span>
            <Trans
              i18nKey="install.iosText"
              components={{
                0: <b />,
                1: <b />,
              }}
            />
          </span>
          <button type="button" onClick={() => setDismissed(true)} aria-label={t('install.closeAria')} className="app-banner__btn-ok">
            {t('install.understood')}
          </button>
        </>
      )}
    </div>
  );
}

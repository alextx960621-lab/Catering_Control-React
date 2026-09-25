import { useTranslation } from 'react-i18next';
import { useSWUpdate } from '../hooks/useSWUpdate';
import './Banners.css';

export default function UpdateBanner() {
  const { t } = useTranslation();
  const { needRefresh, dismiss, update } = useSWUpdate();
  if (!needRefresh) return null;

  return (
    <div role="alert" className="app-banner">
      <span>{t('install.updateText')}</span>
      <div className="app-banner__actions">
        <button type="button" onClick={update} className="app-banner__btn-primary">
          {t('install.updateBtn')}
        </button>
        <button type="button" onClick={dismiss} aria-label={t('install.closeAria')} className="app-banner__btn-secondary">
          {t('install.later')}
        </button>
      </div>
    </div>
  );
}

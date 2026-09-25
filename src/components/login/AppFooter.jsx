import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Footer legal: a propósito siempre muestra el nombre del SOFTWARE (Catering Control)…
export default function AppFooter() {
  const { t } = useTranslation();
  return (
    <footer className="app-footer text-secondary">
      <div className="app-footer-brand">
        <span>Catering Control™</span>
        <span className="app-footer-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.4 2.4 3.4-.4.4 3.4L21 10l-2.8 2.6.4 3.4-3.4-.4L12 18l-2.4-2.4-3.4.4-.4-3.4L3 10l2.8-2.6-.4-3.4 3.4.4z" />
            <path d="M9.8 12.2l1.6 1.6 3-3.4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('login.verifiedSoftware')}
        </span>
      </div>
      <div className="app-footer-links">
        <Link to="/terminos">{t('login.terms')}</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/privacidad">{t('login.privacy')}</Link>
      </div>
      <div className="app-footer-copy">{t('login.allRightsReserved', { year: new Date().getFullYear() })}</div>
    </footer>
  );
}

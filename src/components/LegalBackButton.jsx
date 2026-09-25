import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const ArrowLeftIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5" />
    <path d="M11 18l-6-6 6-6" />
  </svg>
);

// Mismo botón fijo arriba a la derecha que "Salir" del portal de clientes (ver LogoutButton.jsx)
export default function LegalBackButton() {
  const { t } = useTranslation();
  return (
    <Link className="legal-back" to="/" aria-label={t('legal.back')} title={t('legal.back')}>
      {ArrowLeftIcon}
      <span>{t('legal.back')}</span>
    </Link>
  );
}

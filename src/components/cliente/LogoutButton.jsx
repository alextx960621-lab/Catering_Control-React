import { useTranslation } from 'react-i18next';

const LogoutIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export default function LogoutButton({ onLogout }) {
  const { t } = useTranslation();
  return (
    <button className="client-logout-btn" onClick={onLogout} title={t('portal.logoutTitle')}>
      {LogoutIcon}
      <span>{t('portal.logout')}</span>
    </button>
  );
}

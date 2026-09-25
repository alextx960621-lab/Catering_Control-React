import { useTranslation } from 'react-i18next';
import { waLink } from '../../services/planHelpers';
import Header from './Header';
import LogoutButton from './LogoutButton';
import { IconLock } from './icons';

export default function PremiumLock({ branding, appConfig, onLogout }) {
  const { t } = useTranslation();
  const wa = waLink(branding, appConfig, t('portal.premium.waMessage'));

  return (
    <>
      <LogoutButton onLogout={onLogout} />
      <Header branding={branding} appConfig={appConfig} showThemeSelect={false} />
      <div className="premium-lock">
        <div className="premium-lock-icon">{IconLock}</div>
        <h2>{t('portal.premium.title')}</h2>
        <p>{t('portal.premium.text')}</p>
        {wa !== '#' && (
          <a className="btn-premium" href={wa} target="_blank" rel="noopener">
            {t('portal.contactWhatsapp')}
          </a>
        )}
      </div>
    </>
  );
}

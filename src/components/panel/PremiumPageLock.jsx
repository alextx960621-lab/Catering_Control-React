import { useTranslation } from 'react-i18next';

export default function PremiumPageLock({ featureLabel, premiumWhatsapp }) {
  const { t } = useTranslation();
  const wa = premiumWhatsapp ? `https://wa.me/${premiumWhatsapp}?text=${encodeURIComponent(t('panel.common.premiumWaMessage', { feature: featureLabel }))}` : '';
  return (
    <div className="premium-lock">
      <div className="premium-lock-icon">🔒</div>
      <h2>{t('panel.common.premiumFeatureTitle', { feature: featureLabel })}</h2>
      <p>{t('panel.common.premiumFeatureBody')}</p>
      {wa && <a className="btn-premium" href={wa} target="_blank" rel="noopener">{t('panel.common.contactWhatsapp')}</a>}
    </div>
  );
}

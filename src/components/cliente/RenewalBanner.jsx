import { useTranslation } from 'react-i18next';
import { n, renewalWarningDays } from '../../services/planHelpers';

// Se muestra solo cuando al cliente le quedan pocos días de plan y está activo (no tiene…
export default function RenewalBanner({ client, branding, state, remaining, onOpenPlanChange }) {
  const { t } = useTranslation();
  const show = n(client.paidDays) > 0 && remaining <= renewalWarningDays(branding) && !['Pausado', 'Programado', 'No laborable'].includes(state);
  if (!show) return null;

  const ribbon = remaining <= 0 ? t('portal.renewal.expired') : remaining === 1 ? t('portal.renewal.lastDay') : t('portal.renewal.onlyDays', { count: remaining });

  return (
    <section className="renewal-banner rounded-4 shadow-sm p-4 mb-3 d-flex align-items-center justify-content-between flex-wrap gap-3">
      <div className="d-flex align-items-center gap-3">
        <span className="bounce fs-1">🥤</span>
        <div>
          <span className="ribbon mb-2 d-inline-flex">
            {ribbon}
          </span>
          <h2 className="h5 mb-1 mt-2">{remaining <= 0 ? t('portal.renewal.endedTitle') : t('portal.renewal.endingTitle')}</h2>
          <p className="mb-0 opacity-90">
            {remaining <= 0 ? t('portal.renewal.endedText') : t('portal.renewal.endingText')} {t('portal.renewal.fast')}
          </p>
        </div>
      </div>
      <button className="cc-btn cc-yellow" onClick={onOpenPlanChange}>
        {t('portal.renewal.button')}
      </button>
    </section>
  );
}

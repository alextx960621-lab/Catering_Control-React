import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ClientForm from './ClientForm';
import { useCompanyPrefs } from '../../context/CompanyPrefsContext';
import { n } from '../../services/planHelpers';

// Diálogo que se abre al tocar "Comprar" en un plan del Login
export default function BuyPlanDialog({ plan, onClose }) {
  const { t } = useTranslation();
  const { formatMoney } = useCompanyPrefs();
  const [step, setStep] = useState('ask'); // ask | login | signup
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function goTo(next) {
    setErrorMsg('');
    setStep(next);
  }

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div
        className="modal fade show"
        style={{ display: 'block', overflowY: 'auto' }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="buy-plan-title"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content rounded-4">
            <div className="modal-header">
              <h5 className="modal-title" id="buy-plan-title">{t('login.buyPlan')}</h5>
              <button type="button" className="btn-close" aria-label={t('common.close')} onClick={onClose} />
            </div>
            <div className="modal-body">
              <div className="buy-plan-summary mb-3">
                <div className="buy-plan-name">{plan.name}</div>
                <div className="buy-plan-meta">
                  {n(plan.cost) > 0 && <strong>{formatMoney(n(plan.cost))}</strong>}
                  {n(plan.serviceDays) > 0 && <span className="text-secondary"> · {t('login.serviceDays', { count: n(plan.serviceDays) })}</span>}
                </div>
              </div>

              {step === 'ask' && (
                <>
                  <p className="fw-semibold mb-2">{t('login.alreadyClient')}</p>
                  <div className="d-grid gap-2">
                    <button type="button" className="cc-btn cc-blue" onClick={() => goTo('login')}>
                      {t('login.yesAlreadyClient')}
                    </button>
                    <button type="button" className="cc-btn cc-yellow" onClick={() => goTo('signup')}>
                      {t('login.noNew')}
                    </button>
                    <button type="button" className="cc-btn cc-red mt-1" onClick={onClose}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              )}

              {step !== 'ask' && (
                <>
                  <ClientForm
                    active
                    mode={step}
                    onModeChange={goTo}
                    onError={setErrorMsg}
                    onClearError={() => setErrorMsg('')}
                    purchasePlan={plan}
                    idPrefix="buy-"
                  />
                  {errorMsg && (
                    <div className="alert alert-danger mt-3 mb-0" role="alert">
                      {errorMsg}
                    </div>
                  )}
                  <button type="button" className="cc-btn cc-red w-100 mt-2" onClick={() => goTo('ask')}>
                    {t('common.back')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../services/supabaseClient';
import { n } from '../../services/planHelpers';
import { useCompanyPrefs } from '../../context/CompanyPrefsContext';
import BuyPlanDialog from './BuyPlanDialog';

// "Nuestros planes" del Login: un solo botón violeta que despliega los planes marcados…
export default function PlansTeaser({ whatsappNumber }) {
  const { t } = useTranslation();
  const { formatMoney } = useCompanyPrefs();
  const [plans, setPlans] = useState(null);
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState(null); // plan elegido en "Comprar"
  const [portalLocked, setPortalLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [catalog, status] = await Promise.all([rpc('get_portal_catalog', {}), rpc('get_plan_status', {})]);
      if (cancelled) return;
      setPlans(catalog?.plans || []);
      // Sin plan Premium el portal del cliente está bloqueado: comprar desde acá no llevaría a…
      if (status) setPortalLocked(status.plan !== 'premium' && !!status.clientPortalLocked);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const available = (plans || []).filter((p) => p.availableForPurchase);
  const cleanWa = String(whatsappNumber || '').replace(/\D/g, '');

  return (
    <section className="card shadow-sm border-0 rounded-4 landing-teaser">
      <div className="card-body p-4 d-grid gap-3">
        {available.length > 0 && (
          <div>
            <button
              type="button"
              className="cc-btn cc-violet w-100 plans-toggle"
              aria-expanded={open}
              aria-controls="landing-plans"
              onClick={() => setOpen((v) => !v)}
            >
              {t('login.ourPlans')}
              <span className={`plans-toggle-arrow${open ? ' open' : ''}`} aria-hidden="true" />
            </button>

            {open && (
              <div className="row g-3 mt-1" id="landing-plans">
                {available.map((p) => (
                  <div className="col-12 col-sm-6 col-lg-4" key={p.id}>
                    <div className="plan-teaser-card">
                      {p.photoUrl ? (
                        <img src={p.photoUrl} alt="" className="plan-teaser-img" loading="lazy" decoding="async" />
                      ) : (
                        <div className="plan-teaser-img plan-teaser-img-placeholder">🍽️</div>
                      )}
                      <div className="plan-teaser-body">
                        <div className="plan-teaser-name">{p.name}</div>
                        {n(p.serviceDays) > 0 && <div className="plan-teaser-days text-secondary">{t('login.serviceDays', { count: n(p.serviceDays) })}</div>}
                        {n(p.cost) > 0 && (
                          <div className="plan-teaser-price">
                            {formatMoney(n(p.cost))}
                            <span className="plan-teaser-price-unit text-secondary">{t('login.perPlan')}</span>
                          </div>
                        )}
                        {portalLocked ? (
                          cleanWa && (
                            <a
                              className="cc-btn cc-whatsapp cc-sm w-100"
                              href={`https://wa.me/${cleanWa}?text=${encodeURIComponent(t('login.wantToBuyPlan', { plan: p.name }))}`}
                              target="_blank"
                              rel="noopener"
                            >
                              {t('login.consultWhatsapp')}
                            </a>
                          )
                        ) : (
                          <button type="button" className="cc-btn cc-red cc-sm w-100" onClick={() => setBuying(p)}>
                            {t('login.buy')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Link className="cc-btn cc-orange w-100" to="/menu-semanal">
          {t('login.viewWeeklyMenu')}
        </Link>
      </div>

      {buying && <BuyPlanDialog plan={buying} onClose={() => setBuying(null)} />}
    </section>
  );
}

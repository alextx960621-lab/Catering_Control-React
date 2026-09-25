import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './MenuSemanalPage.css';
import { useTheme } from '../hooks/useTheme';
import { usePageBodyClass } from '../hooks/usePageBodyClass';
import { useBranding } from '../hooks/useBranding';
import { rpc } from '../services/supabaseClient';
import { MENU_DAYS, formatMenuText, todayMenuKey } from '../services/menuSemanal';
import BrandMark from '../components/login/BrandMark';
import ThemeSelect from '../components/login/ThemeSelect';

// Web pública del Menú Semanal
export default function MenuSemanalPage() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useTheme();
  usePageBodyClass('page-menu-semanal');
  const { name: brandName, logo: brandLogo } = useBranding();
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const today = todayMenuKey();

  useEffect(() => {
    document.title = `${brandName} · ${t('portal.weeklyMenu')}`;
  }, [brandName, t, i18n.language]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await rpc('get_menu_semanal', {});
      if (!cancelled) {
        setMenu(result || {});
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container py-4 menu-semanal-wrap">
      <div className="menu-semanal-head mb-4">
        <div className="brand-row">
          <div className="brand-mark d-inline-flex align-items-center justify-content-center fs-2">
            <BrandMark logo={brandLogo} name={brandName} />
          </div>
          <div className="brand-info">
            <h1 className="h5 mb-1">{brandName}</h1>
            <small className="text-secondary">{t('portal.weeklyMenu')}</small>
          </div>
        </div>
        <ThemeSelect theme={theme} onChange={setTheme} />
      </div>

      {loading ? (
        <p className="text-secondary text-center py-5">{t('menuPage.loading')}</p>
      ) : (
        <div className="row g-3">
          {MENU_DAYS.filter(([key]) => !menu?.[key]?.hidden).map(([key]) => {
            const day = menu?.[key];
            const hasContent = !!day?.text?.trim();
            const isToday = key === today;
            return (
              <div className="col-12 col-sm-6 col-lg-4" key={key}>
                <article className={`card shadow-sm border-0 h-100 menu-day-card${isToday ? ' menu-day-today' : ''}`}>
                  {day?.imageUrl && (
                    <img src={day.imageUrl} alt="" className="card-img-top" style={{ height: 160, objectFit: 'cover' }} />
                  )}
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <h2 className="h5 mb-0">{t(`common.days.${key}`)}</h2>
                      {isToday && <span className="badge menu-today-badge rounded-pill">{t('menuPage.today')}</span>}
                    </div>
                    {hasContent ? (
                      <div className="menu-day-content" dangerouslySetInnerHTML={{ __html: formatMenuText(day.text) }} />
                    ) : (
                      <p className="text-secondary small mb-0">{t('menuPage.emptyDay')}</p>
                    )}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-center mt-4">
        <Link className="cc-btn cc-red" to="/cliente">
          {t('menuPage.backToPortal')}
        </Link>
      </div>
    </main>
  );
}

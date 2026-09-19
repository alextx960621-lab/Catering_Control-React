import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './MenuSemanalPage.css';
import { useTheme } from '../hooks/useTheme';
import { usePageBodyClass } from '../hooks/usePageBodyClass';
import { useBranding } from '../hooks/useBranding';
import { rpc } from '../services/supabaseClient';
import { MENU_DAYS, formatMenuText, todayMenuKey } from '../services/menuSemanal';
import BrandMark from '../components/login/BrandMark';
import ThemeSelect from '../components/login/ThemeSelect';

// Web pública del Menú Semanal. Se llega acá desde el botón "Menú de la
// semana" del portal de cliente (ver ClientePage/Portal.jsx), pero no
// requiere sesión -- get_menu_semanal es de lectura pública, igual que
// get_branding, así que también se puede compartir el link directo.
export default function MenuSemanalPage() {
  const [theme, setTheme] = useTheme();
  usePageBodyClass('page-menu-semanal');
  const { name: brandName, logo: brandLogo } = useBranding();
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const today = todayMenuKey();

  useEffect(() => {
    document.title = `${brandName} · Menú de la semana`;
  }, [brandName]);

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
            <small className="text-secondary">Menú de la semana</small>
          </div>
        </div>
        <ThemeSelect theme={theme} onChange={setTheme} />
      </div>

      {loading ? (
        <p className="text-secondary text-center py-5">Cargando el menú…</p>
      ) : (
        <div className="row g-3">
          {MENU_DAYS.map(([key, label]) => {
            const day = menu?.[key];
            const hasContent = !!day?.text?.trim();
            const isToday = key === today;
            return (
              <div className="col-12 col-sm-6 col-lg-4" key={key}>
                <article className={`card shadow-sm border-0 h-100 menu-day-card${isToday ? ' menu-day-today' : ''}`}>
                  <div className="card-body">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <h2 className="h5 mb-0">{label}</h2>
                      {isToday && <span className="badge menu-today-badge rounded-pill">Hoy</span>}
                    </div>
                    {hasContent ? (
                      <div className="menu-day-content" dangerouslySetInnerHTML={{ __html: formatMenuText(day.text) }} />
                    ) : (
                      <p className="text-secondary small mb-0">Todavía no se cargó el menú de este día.</p>
                    )}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-center mt-4">
        <Link className="btn btn-outline-secondary" to="/cliente">
          &larr; Volver a mi portal
        </Link>
      </div>
    </main>
  );
}

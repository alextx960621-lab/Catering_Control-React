import { useTranslation } from 'react-i18next';
import ShareAppButton from '../login/ShareAppButton';

export default function Header({ branding, appConfig, theme, onThemeChange, showThemeSelect }) {
  const { t } = useTranslation();
  const brandName = branding.companyName || appConfig.companyName;
  return (
    <header className="navbar bg-body rounded-4 shadow-sm px-3 mb-3">
      <a className="navbar-brand d-flex align-items-center gap-2 m-0" href="#">
        <img
          loading="lazy"
          decoding="async"
          className="brand-image rounded-3"
          src={branding.logoUrl || appConfig.logoUrl}
          alt={brandName}
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        <span>
          <b className="d-block fs-6">{brandName}</b>
          <small className="text-secondary">{t('portal.header.subtitle')}</small>
        </span>
      </a>
      <div className="d-flex align-items-center gap-2">
        {showThemeSelect && (
          <>
            <label className="form-label small text-secondary mb-0" htmlFor="theme">
              {t('common.theme')}
            </label>
            <select
              className="form-select form-select-sm"
              id="theme"
              aria-label={t('common.theme')}
              value={theme}
              onChange={(e) => onThemeChange(e.target.value)}
            >
              <option value="light">{t('common.themeLight')}</option>
              <option value="night">{t('common.themeNight')}</option>
              <option value="forest">{t('common.themeForest')}</option>
            </select>
          </>
        )}
        {/* Solo aparece dentro de la app instalada (ver ShareAppButton) ahí es la única forma de… */}
        <ShareAppButton brandName={brandName} />
      </div>
    </header>
  );
}

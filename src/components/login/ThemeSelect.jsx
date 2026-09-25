import { useTranslation } from 'react-i18next';

export default function ThemeSelect({ theme, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="d-inline-flex align-items-center gap-2">
      <label className="form-label small text-secondary mb-0" htmlFor="theme-select">
        {t('common.theme')}
      </label>
      <select
        className="form-select form-select-sm"
        id="theme-select"
        style={{ width: 'auto' }}
        value={theme}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="light">{t('common.themeLight')}</option>
        <option value="night">{t('common.themeNight')}</option>
        <option value="forest">{t('common.themeForest')}</option>
      </select>
    </div>
  );
}

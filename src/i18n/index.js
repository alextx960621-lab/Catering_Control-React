import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import config from '../services/config';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
];

export const PREFS_STORAGE_KEY = `${config.storagePrefix || 'catering-app'}-company-prefs-v1`;

// Idioma inicial: el que guardó la última vez (caché local) o el default de config.js.
// Después CompanyPrefsProvider lo sincroniza con el que definió la empresa en Supabase.
export function initialLanguage() {
  try {
    const cached = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || 'null');
    if (cached?.language && SUPPORTED_LANGUAGES.some((l) => l.code === cached.language)) return cached.language;
  } catch { /* sin caché: se usa el default */ }
  const cfg = config.defaultLanguage;
  return SUPPORTED_LANGUAGES.some((l) => l.code === cfg) ? cfg : 'es';
}

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
    pt: { translation: pt },
  },
  lng: initialLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false }, // React ya escapa el HTML
});

export default i18n;

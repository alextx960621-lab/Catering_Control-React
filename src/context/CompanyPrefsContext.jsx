import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import i18n, { PREFS_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n';
import { rpc } from '../services/supabaseClient';
import { formatMoney as fmtMoney, currencySymbol, DEFAULT_CURRENCY } from '../services/money';
import config from '../services/config';

// Preferencias de EMPRESA que necesitan estar disponibles en toda la app, incluso antes
// del login: idioma y moneda de trabajo. Vienen de get_branding() (RPC pública) y se
// cachean en localStorage para pintar al instante en la siguiente apertura.
const CompanyPrefsContext = createContext(null);

const LANG_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function CompanyPrefsProvider({ children }) {
  const cached = readCache();
  const [language, setLanguage] = useState(cached?.language || config.defaultLanguage || 'es');
  const [currency, setCurrency] = useState(cached?.currency || config.currency || DEFAULT_CURRENCY);

  const apply = useCallback((lang, cur) => {
    const nextLang = LANG_CODES.includes(lang) ? lang : null;
    const nextCur = cur || null;
    setLanguage((prevLang) => {
      const l = nextLang || prevLang;
      if (i18n.language !== l) i18n.changeLanguage(l);
      return l;
    });
    setCurrency((prevCur) => nextCur || prevCur);
    try {
      const merged = { language: nextLang || cached?.language || config.defaultLanguage || 'es', currency: nextCur || cached?.currency || config.currency || DEFAULT_CURRENCY };
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
    } catch { /* localStorage bloqueado: no es crítico */ }
  }, [cached]);

  useEffect(() => {
    const initial = LANG_CODES.includes(language) ? language : 'es';
    if (i18n.language !== initial) i18n.changeLanguage(initial);
    let cancelled = false;
    (async () => {
      const b = await rpc('get_branding', {});
      if (cancelled || !b) return;
      apply(b.language, b.currency);
    })();
    function onVisible() {
      if (document.visibilityState === 'visible') rpc('get_branding', {}).then((b) => { if (b) apply(b.language, b.currency); });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({
    language,
    currency,
    currencySymbol: currencySymbol(currency),
    setCompanyPrefs: apply,
    formatMoney: (val, opts) => fmtMoney(val, currency, opts),
  }), [language, currency, apply]);

  return <CompanyPrefsContext.Provider value={value}>{children}</CompanyPrefsContext.Provider>;
}

export function useCompanyPrefs() {
  const ctx = useContext(CompanyPrefsContext);
  if (!ctx) throw new Error('useCompanyPrefs debe usarse dentro de <CompanyPrefsProvider>.');
  return ctx;
}

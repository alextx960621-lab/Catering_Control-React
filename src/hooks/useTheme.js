import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../services/storageKeys';

// El tema se aplica como atributo data-theme en <html>, y el CSS (ver…
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.uiTheme) || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Bootstrap tiene su PROPIO modo oscuro, aparte de nuestras variables panel-*: sin esto…
    document.documentElement.dataset.bsTheme = theme === 'night' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEYS.uiTheme, theme);
  }, [theme]);

  return [theme, setTheme];
}

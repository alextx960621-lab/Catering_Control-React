import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../services/storageKeys';

// El tema se aplica como atributo data-theme en <html>, y el CSS (ver
// src/pages/LoginPage.css) hace el resto con selectores [data-theme="..."].
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.uiTheme) || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.uiTheme, theme);
  }, [theme]);

  return [theme, setTheme];
}

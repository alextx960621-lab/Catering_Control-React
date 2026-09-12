import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../services/storageKeys';

// El tema se aplica como atributo data-theme en <html>, y el CSS (ver
// src/pages/LoginPage.css) hace el resto con selectores [data-theme="..."].
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.uiTheme) || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Bootstrap tiene su PROPIO modo oscuro, aparte de nuestras variables
    // --panel-*: sin esto, todo lo que sea puramente Bootstrap (pills de
    // "Soy cliente/Soy del equipo", alertas, etc en Login) se queda con
    // los colores claros de Bootstrap aunque el resto ya esté en nocturno.
    document.documentElement.dataset.bsTheme = theme === 'night' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEYS.uiTheme, theme);
  }, [theme]);

  return [theme, setTheme];
}

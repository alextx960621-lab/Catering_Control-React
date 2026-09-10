import config from './config';
import { STORAGE_KEYS } from './storageKeys';

// Claves de localStorage/sessionStorage del portal cliente. Mismas que
// usaba la versión anterior, para no perder datos guardados de clientes
// que ya venían usando la PWA.
const prefix = config.storagePrefix;

export const CLIENTE_KEYS = {
  operations: `${prefix}-operaciones-v3`, // catálogo: planes + calendario laborable
  clientRow: `${prefix}-client-row-v1`, // datos del cliente logueado
  branding: `${prefix}-client-branding-v1`,
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* localStorage lleno/bloqueado: no es crítico, se reintenta después */
  }
}

export const readOperations = () => readJSON(CLIENTE_KEYS.operations, {});
export const writeOperations = (data) => writeJSON(CLIENTE_KEYS.operations, data);

export const readClientRow = () => readJSON(CLIENTE_KEYS.clientRow, null);
export const writeClientRow = (client) => writeJSON(CLIENTE_KEYS.clientRow, client);

export const readCachedBranding = () => readJSON(CLIENTE_KEYS.branding, {});
export const writeCachedBranding = (branding) => writeJSON(CLIENTE_KEYS.branding, branding);

// Misma llave que usan login.html y panel.html (STORAGE_KEYS.uiTheme): el
// tema es único por dispositivo/navegador, no por cliente — si se cambia
// en cualquiera de las 3 pantallas, debe verse igual en las otras. Se
// ignora a propósito el clientId que reciben estas funciones (se deja el
// parámetro para no romper a quien las llama).
export function getClientTheme() {
  return localStorage.getItem(STORAGE_KEYS.uiTheme) || 'light';
}

export function saveClientTheme(_clientId, theme) {
  try {
    localStorage.setItem(STORAGE_KEYS.uiTheme, theme);
  } catch (_) {
    /* localStorage lleno/bloqueado: no es crítico */
  }
}

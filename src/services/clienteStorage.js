import config from './config';

// Claves de localStorage/sessionStorage del portal cliente. Mismas que
// usaba la versión anterior, para no perder datos guardados de clientes
// que ya venían usando la PWA.
const prefix = config.storagePrefix;

export const CLIENTE_KEYS = {
  operations: `${prefix}-operaciones-v3`, // catálogo: planes + calendario laborable
  clientRow: `${prefix}-client-row-v1`, // datos del cliente logueado
  themeStore: `${prefix}-client-theme-store-v1`, // tema elegido, por cliente
  themeLegacy: `${prefix}-client-theme-v1`,
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

// El tema se guarda POR CLIENTE (si dos personas comparten el mismo
// celular/PWA, cada una puede tener su propio tema elegido).
export function getClientTheme(clientId) {
  const store = readJSON(CLIENTE_KEYS.themeStore, {});
  const key = clientId || 'default';
  if (!store[key]) {
    store[key] = localStorage.getItem(CLIENTE_KEYS.themeLegacy) || 'light';
    writeJSON(CLIENTE_KEYS.themeStore, store);
  }
  return store[key];
}

export function saveClientTheme(clientId, theme) {
  const store = readJSON(CLIENTE_KEYS.themeStore, {});
  store[clientId || 'default'] = theme;
  writeJSON(CLIENTE_KEYS.themeStore, store);
}

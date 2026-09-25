import config from './config';
import { STORAGE_KEYS } from './storageKeys';

// Claves de localStorage/sessionStorage del portal cliente
const prefix = config.storagePrefix;

export const CLIENTE_KEYS = {
  operations: `${prefix}-operaciones-v3`, // catálogo: planes + calendario laborable
  clientRow: `${prefix}-client-row-v1`, // datos del cliente logueado
  branding: `${prefix}-client-branding-v1`,
  isPremium: `${prefix}-client-is-premium-v1`,
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {/* localStorage lleno/bloqueado: no es crítico, se reintenta después */}
}

export const readOperations = () => readJSON(CLIENTE_KEYS.operations, {});
export const writeOperations = (data) => writeJSON(CLIENTE_KEYS.operations, data);

export const readClientRow = () => readJSON(CLIENTE_KEYS.clientRow, null);
export const writeClientRow = (client) => writeJSON(CLIENTE_KEYS.clientRow, client);

export const readCachedBranding = () => readJSON(CLIENTE_KEYS.branding, {});
export const writeCachedBranding = (branding) => writeJSON(CLIENTE_KEYS.branding, branding);

// Cache de "¿la empresa tiene Premium?" -- se usa SOLO para decidir si se puede saltar el…
export const readCachedIsPremium = () => readJSON(CLIENTE_KEYS.isPremium, null);
export const writeCachedIsPremium = (value) => writeJSON(CLIENTE_KEYS.isPremium, value);

// Misma llave que usan login.html y panel.html (STORAGE_KEYS.uiTheme): es el cache LOCAL de…
export function getClientTheme() {
  return localStorage.getItem(STORAGE_KEYS.uiTheme) || 'light';
}

export function saveClientTheme(_clientId, theme) {
  try {
    localStorage.setItem(STORAGE_KEYS.uiTheme, theme);
  } catch {/* localStorage lleno/bloqueado: no es crítico */}
}

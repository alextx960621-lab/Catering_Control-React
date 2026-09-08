import config from './config';

// Mismas claves que usaba la versión anterior (login.html/app.js), para que
// una PWA ya instalada no pierda la sesión al actualizar a esta versión.
const prefix = config.storagePrefix;

export const STORAGE_KEYS = {
  staffSession: `${prefix}-staff-session-v1`,
  clientSession: `${prefix}-client-session-v1`,
  brandingCache: `${prefix}-branding-cache-v1`,
  uiTheme: `${prefix}-ui-theme-v1`,
};

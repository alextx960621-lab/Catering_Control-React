import { STORAGE_KEYS } from './storageKeys';
import { isStandalonePwa } from './pwa';

// Staff: siempre sessionStorage (sobrevive a un F5 pero no a cerrar la pestaña) -- el panel…
function clientStorage() {
  return isStandalonePwa() ? localStorage : sessionStorage;
}

function readJSON(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {/* si el storage no está disponible (modo privado estricto), la sesión sigue funcionando en… */}
}

export function readStaffSession() {
  return readJSON(sessionStorage, STORAGE_KEYS.staffSession);
}

export function writeStaffSession(session) {
  writeJSON(sessionStorage, STORAGE_KEYS.staffSession, session);
}

export function readClientSession() {
  // Si por algún motivo quedó una sesión vieja en sessionStorage (ej. se instaló la PWA…
  const storage = clientStorage();
  const own = readJSON(storage, STORAGE_KEYS.clientSession);
  if (own) return own;
  if (storage === localStorage) {
    const legacy = readJSON(sessionStorage, STORAGE_KEYS.clientSession);
    if (legacy) {
      writeJSON(localStorage, STORAGE_KEYS.clientSession, legacy);
      sessionStorage.removeItem(STORAGE_KEYS.clientSession);
      return legacy;
    }
  }
  return null;
}

export function writeClientSession(session) {
  writeJSON(clientStorage(), STORAGE_KEYS.clientSession, session);
}

export function clearSessions() {
  sessionStorage.removeItem(STORAGE_KEYS.staffSession);
  sessionStorage.removeItem(STORAGE_KEYS.clientSession);
  localStorage.removeItem(STORAGE_KEYS.clientSession);
  sessionStorage.removeItem(STORAGE_KEYS.pendingPlanPurchase);
}

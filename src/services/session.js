import { STORAGE_KEYS } from './storageKeys';

// sessionStorage sobrevive a un F5 pero no a cerrar la pestaña — es a
// propósito: si alguien presta su celular, cerrar la app cierra la sesión.

function readJSON(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* si sessionStorage no está disponible (modo privado estricto), la
       sesión sigue funcionando en memoria durante la pestaña actual */
  }
}

export function readStaffSession() {
  return readJSON(STORAGE_KEYS.staffSession);
}

export function writeStaffSession(session) {
  writeJSON(STORAGE_KEYS.staffSession, session);
}

export function readClientSession() {
  return readJSON(STORAGE_KEYS.clientSession);
}

export function writeClientSession(session) {
  writeJSON(STORAGE_KEYS.clientSession, session);
}

export function clearSessions() {
  sessionStorage.removeItem(STORAGE_KEYS.staffSession);
  sessionStorage.removeItem(STORAGE_KEYS.clientSession);
}

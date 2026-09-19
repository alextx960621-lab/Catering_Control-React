import { STORAGE_KEYS } from './storageKeys';
import { isStandalonePwa } from './pwa';

// Staff: siempre sessionStorage (sobrevive a un F5 pero no a cerrar la
// pestaña) -- el panel se usa muchas veces desde una compu compartida del
// local, así que cerrar la pestaña tiene que cerrar la sesión.
//
// Cliente: en una pestaña normal del navegador se mantiene igual
// (sessionStorage, por si el celular/compu es compartido). Pero dentro de
// la PWA instalada (isStandalonePwa) se guarda en localStorage, para que
// quede logueado entre aperturas como cualquier app (Facebook, Instagram,
// etc.) en vez de pedirle carnet y teléfono cada vez que la abre. Si el
// token queda vencido o revocado, el servidor lo rechaza igual y
// ClientePage manda de vuelta al login -- localStorage no salta esa
// validación, solo evita el trámite de volver a escribir los datos.
function clientStorage() {
  return isStandalonePwa() ? localStorage : sessionStorage;
}

function readJSON(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* si el storage no está disponible (modo privado estricto), la
       sesión sigue funcionando en memoria durante la sesión actual */
  }
}

export function readStaffSession() {
  return readJSON(sessionStorage, STORAGE_KEYS.staffSession);
}

export function writeStaffSession(session) {
  writeJSON(sessionStorage, STORAGE_KEYS.staffSession, session);
}

export function readClientSession() {
  // Si por algún motivo quedó una sesión vieja en sessionStorage (ej. se
  // instaló la PWA después de haber entrado desde el navegador) y ahora
  // corre como PWA, la migramos a localStorage en vez de perderla.
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
}

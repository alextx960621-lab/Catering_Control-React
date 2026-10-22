import { STORAGE_KEYS } from './storageKeys';
import { isStandalonePwa } from './pwa';

// El portal cliente solo persiste instalado como PWA.
// En una pestaña normal la sesión vive lo que la pestaña.
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

// Staff: localStorage siempre, con o sin PWA. El equipo abre el panel
// muchas veces al día y sessionStorage moría al cerrar la pestaña, así
// que volvían a escribir la contraseña todo el tiempo.
// La base acota el riesgo: cada uso renueva 3 días, tope de 30 (1.27).
export function readStaffSession() {
  const own = readJSON(localStorage, STORAGE_KEYS.staffSession);
  if (own) return own;
  // Sesión abierta antes de este cambio: la subimos de sessionStorage para no expulsar a nadie
  const legacy = readJSON(sessionStorage, STORAGE_KEYS.staffSession);
  if (legacy) {
    writeJSON(localStorage, STORAGE_KEYS.staffSession, legacy);
    sessionStorage.removeItem(STORAGE_KEYS.staffSession);
    return legacy;
  }
  return null;
}

export function writeStaffSession(session) {
  writeJSON(localStorage, STORAGE_KEYS.staffSession, session);
  markLastLogin('staff');
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
  markLastLogin('client');
}

// sessionStorage manda: responde a "qué se abrió últimamente EN ESTA pestaña",
// así que un F5 a medias entre panel y portal vuelve al portal.
// localStorage es el respaldo del celular: la PWA arranca en una pestaña
// nueva y sin marca mostraría el formulario aunque usen solo el panel.
export function markLastLogin(origin) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.lastLoginOrigin, origin);
    localStorage.setItem(STORAGE_KEYS.lastLoginOrigin, origin);
  } catch {/* storage bloqueado */}
}

export function readLastLoginOrigin() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.lastLoginOrigin)
      ?? localStorage.getItem(STORAGE_KEYS.lastLoginOrigin);
  } catch { return null; }
}

// Los dos cierres van separados: clearSessions() borraba también la sesión del cliente, que en PWA…
// es la única que persiste, así que el logout de un staff en el mismo teléfono expulsaba al cliente.
export function clearStaffSession() {
  localStorage.removeItem(STORAGE_KEYS.staffSession);
  sessionStorage.removeItem(STORAGE_KEYS.staffSession);
  localStorage.removeItem(STORAGE_KEYS.lastLoginOrigin);
  sessionStorage.removeItem(STORAGE_KEYS.lastLoginOrigin);
}

export function clearClientSession() {
  sessionStorage.removeItem(STORAGE_KEYS.clientSession);
  localStorage.removeItem(STORAGE_KEYS.clientSession);
  sessionStorage.removeItem(STORAGE_KEYS.pendingPlanPurchase);
  sessionStorage.removeItem(STORAGE_KEYS.lastLoginOrigin);
  localStorage.removeItem(STORAGE_KEYS.lastLoginOrigin);
}

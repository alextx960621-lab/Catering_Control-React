import { createClient } from '@supabase/supabase-js';
import config from './config';

// Un solo cliente de Supabase para toda la app.
export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// ----------------------------------------------------------------------
// Token de sesión
// ----------------------------------------------------------------------
// Desde el "cierre de seguridad" (supabase-security-lockdown.sql), TODAS
// las tablas db_* tienen RLS `using (false)`: ya no se puede leer ni
// escribir nada por REST directo solo con la clave publishable. Todo pasa
// por funciones RPC `security definer` que reciben este token y lo validan
// contra db_sessions antes de tocar cualquier tabla.
//
// login_staff / login_cliente devuelven ese token al autenticar bien.
// Cada página protegida (Panel, Cliente) tiene que llamar a
// setSessionToken() al arrancar, leyendo el token guardado en
// sessionStorage — ver src/services/session.js.
let currentToken = null;
let currentTokenType = null; // 'staff' | 'cliente'

export function setSessionToken(token, type) {
  currentToken = token || null;
  currentTokenType = token ? type || null : null;
}

export function getSessionToken() {
  return currentToken;
}

export function getSessionType() {
  return currentTokenType;
}

export async function revokeSession() {
  if (!currentToken) return true;
  try {
    await supabase.rpc('revoke_session', { p_token: currentToken });
  } catch (_) {
    // best-effort: si falla, la sesión igual expira sola a los 30 días
  }
  setSessionToken(null, null);
  return true;
}

// Helper genérico para llamar cualquier función RPC de Supabase, con log
// de errores en consola en vez de que cada pantalla repita el mismo
// try/catch. Las funciones que necesitan el token de sesión lo agregan
// ellas mismas a `params` (p_token: getSessionToken()).
export async function rpc(fnName, params) {
  try {
    const { data, error } = await supabase.rpc(fnName, params);
    if (error) {
      console.error(`[supabase] Error llamando a ${fnName}:`, error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[supabase] Fallo de red llamando a ${fnName}:`, err);
    return null;
  }
}

// ----------------------------------------------------------------------
// Funciones del portal de cliente
// ----------------------------------------------------------------------

// Catálogo público (planes, calendario laborable, fecha del servidor).
// No requiere sesión, mismo criterio que get_branding.
export async function getPortalCatalog() {
  return rpc('get_portal_catalog', {});
}

// dbGetClientRow: la usa TANTO el portal cliente (su propia fila) COMO el
// panel de staff (cualquier cliente) — se resuelve solo según qué tipo de
// sesión hay activa.
export async function dbGetClientRow(id) {
  const fnName = currentTokenType === 'cliente' ? 'cliente_get_own_profile' : 'staff_get_client_row';
  const params =
    currentTokenType === 'cliente' ? { p_token: currentToken, p_client_id: id } : { p_token: currentToken, p_id: id };
  const data = await rpc(fnName, params);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { ...row.payload, id: row.id } : null;
}

// Guardado del PROPIO perfil desde el portal cliente (pausa/reactivación/
// dirección habitual). Server-side solo se permiten estos campos —
// aunque el objeto que se mande traiga carnet/phone/price/plan, se ignoran.
export async function dbSaveOwnClientProfile(clientId, updates) {
  try {
    const { error } = await supabase.rpc('cliente_save_profile', {
      p_token: currentToken,
      p_client_id: clientId,
      p_updates: updates,
    });
    if (error) {
      console.error('[supabase] Error guardando el perfil del cliente:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] Fallo de red guardando el perfil del cliente:', err);
    return false;
  }
}

// Nombre + foto del driver de la dirección activa del cliente (para "Tu
// repartidor" en el portal). Devuelve null si no hay ruta asignada, o si
// esa ruta todavía no tiene ningún driver -- ninguno de los dos casos es
// un error, es normal para una ruta recién creada.
export async function dbGetOwnDriver(clientId) {
  try {
    const { data, error } = await supabase.rpc('cliente_get_own_driver', { p_token: currentToken, p_client_id: clientId });
    if (error) {
      console.error('[supabase] Error trayendo el driver del cliente:', error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.error('[supabase] Fallo de red trayendo el driver del cliente:', err);
    return null;
  }
}

// Suscripción a notificaciones push (ver src/services/push.js, que arma
// `subscription` con la Push API del navegador). client_id lo saca el
// propio servidor del token, nunca hace falta mandarlo.
export async function dbSavePushSubscription(subscription) {
  try {
    const { error } = await supabase.rpc('save_push_subscription', {
      p_token: currentToken,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
    });
    if (error) {
      console.error('[supabase] Error guardando la suscripción push:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] Fallo de red guardando la suscripción push:', err);
    return false;
  }
}

export async function dbRemovePushSubscription(endpoint) {
  try {
    await supabase.rpc('remove_push_subscription', { p_token: currentToken, p_endpoint: endpoint });
  } catch (err) {
    console.error('[supabase] Fallo de red borrando la suscripción push:', err);
  }
}

// Botón manual de Publicidad: dispara la Edge Function `send-push` con
// el token de STAFF actual (se valida server-side que sea admin/editor/
// superadmin -- ver supabase/functions/send-push/index.ts).
export async function dbSendManualPush(clientIds, title, body) {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { action: 'manual', p_token: currentToken, clientIds, title, body },
    });
    if (error) {
      console.error('[supabase] Error en Edge Function send-push:', error.message);
      return { ok: false, error: error.message };
    }
    return data;
  } catch (err) {
    console.error('[supabase] Fallo de red llamando a send-push:', err);
    return { ok: false, error: 'Fallo de red.' };
  }
}

// dbInsertAudit: la llaman tanto el panel (staff) como el portal cliente
// (autoservicio de pausa/reactivación/dirección) — se resuelve según el
// tipo de sesión activa. El actor (id/nombre/rol) siempre lo fuerza el
// servidor desde la sesión, nunca lo que venga en `entry`.
export async function dbInsertAudit(entry) {
  try {
    if (currentTokenType === 'cliente') {
      const { error } = await supabase.rpc('cliente_insert_audit', {
        p_token: currentToken,
        p_client_id: entry?.actor_id,
        p_entry: entry,
      });
      if (error) console.error('[supabase] Error guardando en el historial:', error.message);
      return !error;
    }
    const { error } = await supabase.rpc('staff_insert_audit', { p_token: currentToken, p_entry: entry });
    if (error) console.error('[supabase] Error guardando en el historial:', error.message);
    return !error;
  } catch (err) {
    console.error('[supabase] Fallo de red guardando en el historial:', err);
    return false;
  }
}

// --- Presencia en línea (quién está usando la app ahora mismo) --------
let presenceChannel = null;

// Etiqueta corta a partir del user-agent, solo para reconocer "cuál es
// cuál" en la lista de Conectados ahora -- no reemplaza una IP real (eso
// necesitaría captura del lado del servidor, no disponible desde el
// navegador con Supabase Realtime Presence).
function deviceLabel() {
  const ua = navigator.userAgent || '';
  let os = 'Dispositivo';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iPhone/iPad';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  return browser ? `${browser} en ${os}` : os;
}

export function presenceState() {
  return presenceChannel ? presenceChannel.presenceState() : {};
}

// Se llama al cerrar sesión dentro de la app (botón "Salir"). Como es una
// SPA (no recarga la página), si no se cierra el canal a mano, el
// track() de esa persona sigue vivo y "Conectados ahora" la sigue
// mostrando aunque ya haya cerrado sesión.
export function leavePresence() {
  if (!presenceChannel) return;
  try { presenceChannel.untrack(); } catch (_) { /* ignorar */ }
  try { supabase.removeChannel(presenceChannel); } catch (_) { /* ignorar */ }
  presenceChannel = null;
}

export function joinPresence(info, onChange) {
  try {
    if (presenceChannel) return presenceChannel;
    const sessionId = `${info.role}-${info.id || 'anon'}-${Math.random().toString(36).slice(2, 9)}`;
    // Canal público (sin "private: true"): esta app no usa Supabase Auth
    // real (login propio validado contra db_sessions), siempre se conecta
    // con la clave anónima -- un canal privado necesitaría un JWT que acá
    // no existe. Igual que panel.html, que nunca tuvo "private: true" y
    // nunca tuvo este problema.
    presenceChannel = supabase.channel('catering-online-users', {
      config: { presence: { key: sessionId } },
    });
    // Se registra SIEMPRE, encadenado antes de .subscribe() (patrón que
    // usa Supabase en su documentación) -- es lo que activa la extensión
    // de presencia en el canal, no un simple "listener opcional". Acá
    // `onChange` de hecho nunca viene (Panel/Cliente llaman joinPresence
    // sin ese argumento; usePresence() ahora lee bajo demanda con el botón
    // "Actualizar", ver hooks/usePresence.js), pero el binding igual tiene
    // que existir para que .track() sirva de algo.
    presenceChannel.on('presence', { event: 'sync' }, () => {
      if (typeof onChange === 'function') {
        try {
          onChange(presenceChannel.presenceState());
        } catch (_) {
          /* ignorar: solo afecta el indicador visual de "en línea" */
        }
      }
    });
    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await presenceChannel.track({ role: info.role, name: info.name || '', id: info.id || '', device: deviceLabel(), at: new Date().toISOString() });
        } catch (_) {
          /* ignorar: solo afecta el indicador visual de "en línea" -- ya
             se confirmó que "Conectados ahora" cuenta bien en producción,
             así que estos avisos de depuración ya no hacen falta. */
        }
      }
    });
    // Best-effort: si se cierra la pestaña/app sin pasar por "Salir", esto
    // intenta avisar igual -- un mensaje de WebSocket en pagehide no tiene
    // garantía de entrega (a diferencia de sendBeacon con HTTP), así que
    // esto ayuda en algunos casos pero no reemplaza la limpieza automática
    // por timeout que hace Supabase del lado del servidor cuando el socket
    // se cae sin avisar.
    window.addEventListener('pagehide', () => {
      try { presenceChannel?.untrack(); } catch (_) { /* ignorar */ }
    });
    return presenceChannel;
  } catch (err) {
    console.error('[supabase] Error uniéndose al canal de presencia:', err);
    return null;
  }
}

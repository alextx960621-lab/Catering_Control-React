import { createClient } from '@supabase/supabase-js';
import config from './config';

// Un solo cliente de Supabase para toda la app
export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// Token de sesión Desde el "cierre de seguridad" (supabase-security-lockdown.sql), TODAS…
let currentToken = null;
let currentTokenType = null; // 'staff' | 'cliente'

export function setSessionToken(token, type) {
  currentToken = token || null;
  currentTokenType = token ? type || null : null;
}

export function getSessionToken() {
  return currentToken;
}

export async function revokeSession() {
  if (!currentToken) return true;
  try {
    await supabase.rpc('revoke_session', { p_token: currentToken });
  } catch {
    // best-effort: si falla, la sesión igual expira sola a los 30 días
  }
  setSessionToken(null, null);
  return true;
}

// Helper genérico para llamar cualquier función RPC de Supabase, con log de errores en…
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

// Funciones del portal de cliente

// Catálogo público (planes, calendario laborable, fecha del servidor)
export async function getPortalCatalog() {
  return rpc('get_portal_catalog', {});
}

// dbGetClientRow: la usa TANTO el portal cliente (su propia fila) COMO el panel de staff…
export async function dbGetClientRow(id) {
  const fnName = currentTokenType === 'cliente' ? 'cliente_get_own_profile' : 'staff_get_client_row';
  const params =
    currentTokenType === 'cliente' ? { p_token: currentToken, p_client_id: id } : { p_token: currentToken, p_id: id };
  const data = await rpc(fnName, params);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { ...row.payload, id: row.id } : null;
}

// Guardado del PROPIO perfil desde el portal cliente (pausa/reactivación/ dirección…
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

// Nombre + foto del driver de la dirección activa del cliente (para "Tu repartidor" en el…
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

// Calificación del portal cliente (1-5 estrellas + recomendación). Una por cliente, actualizable.
export async function dbGetOwnRating(clientId) {
  const data = await rpc('cliente_get_own_rating', { p_token: currentToken, p_client_id: clientId });
  return Array.isArray(data) ? data[0] || null : null;
}

export async function dbSaveOwnRating(clientId, stars, comment) {
  try {
    const { error } = await supabase.rpc('cliente_save_rating', {
      p_token: currentToken,
      p_client_id: clientId,
      p_stars: stars,
      p_comment: comment || '',
    });
    if (error) {
      console.error('[supabase] Error guardando la calificación:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] Fallo de red guardando la calificación:', err);
    return false;
  }
}

// Métricas (staff): todas las calificaciones, anónimas (sin identidad del cliente)
export async function dbGetRatings() {
  const data = await rpc('staff_get_ratings', { p_token: currentToken });
  return Array.isArray(data) ? data : [];
}

// Suscripción a notificaciones push (ver src/services/push.js, que arma `subscription` con…
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

// Igual que la de arriba, pero para editores/admins/superadmin (ver push.js →
// subscribeToStaffPush). Guarda en una tabla aparte (db_staff_push_subscriptions).
export async function dbSaveStaffPushSubscription(subscription) {
  try {
    const { error } = await supabase.rpc('staff_save_push_subscription', {
      p_token: currentToken,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
    });
    if (error) {
      console.error('[supabase] Error guardando la suscripción push (staff):', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] Fallo de red guardando la suscripción push (staff):', err);
    return false;
  }
}

// Botón manual de Publicidad: dispara la Edge Function `send-push` con el token de STAFF…
export async function dbSendManualPush(clientIds, title, body, { allSubscribed = false } = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { action: 'manual', p_token: currentToken, clientIds, title, body, allSubscribed },
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

// dbInsertAudit: la llaman tanto el panel (staff) como el portal cliente (autoservicio de…
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

// Presencia en línea (quién está usando la app ahora mismo)
let presenceChannel = null;

// Etiqueta corta a partir del user-agent, solo para reconocer "cuál es cuál" en la lista de…
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

// Se llama al cerrar sesión dentro de la app (botón "Salir")
export function leavePresence() {
  if (!presenceChannel) return;
  try { presenceChannel.untrack(); } catch {/* ignorar */}
  try { supabase.removeChannel(presenceChannel); } catch {/* ignorar */}
  presenceChannel = null;
}

export function joinPresence(info, onChange) {
  try {
    if (presenceChannel) return presenceChannel;
    const sessionId = `${info.role}-${Math.random().toString(36).slice(2, 12)}`;
    // Canal público (sin "private: true"): esta app no usa Supabase Auth real (login propio…
    presenceChannel = supabase.channel('catering-online-users', {
      config: { presence: { key: sessionId } },
    });
    // Se registra SIEMPRE, encadenado antes de .subscribe() (patrón que usa Supabase en su…
    presenceChannel.on('presence', { event: 'sync' }, () => {
      if (typeof onChange === 'function') {
        try {
          onChange(presenceChannel.presenceState());
        } catch {/* ignorar: solo afecta el indicador visual de "en línea" */}
      }
    });
    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          // SIN nombre: el canal es público (cualquiera con la clave pública podría escucharlo)
          await presenceChannel.track({ role: info.role, id: info.id || '', device: deviceLabel(), at: new Date().toISOString() });
        } catch {/* ignorar: solo afecta el indicador visual de "en línea" -- ya se confirmó que "Conectados… */}
      }
    });
    // Best-effort: si se cierra la pestaña/app sin pasar por "Salir", esto intenta avisar igual…
    window.addEventListener('pagehide', () => {
      try { presenceChannel?.untrack(); } catch {/* ignorar */}
    });
    return presenceChannel;
  } catch (err) {
    console.error('[supabase] Error uniéndose al canal de presencia:', err);
    return null;
  }
}

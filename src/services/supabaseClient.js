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

export function joinPresence(info, onChange) {
  try {
    if (presenceChannel) return presenceChannel;
    const sessionId = `${info.role}-${info.id || 'anon'}-${Math.random().toString(36).slice(2, 9)}`;
    // private: true -- modo recomendado por Supabase para canales de
    // Presence/Broadcast: hace que las policies de la sección 14 de
    // supabase-setup-final-v2.sql (RLS sobre realtime.messages) se
    // apliquen de verdad. Con el canal público, esas policies pueden
    // terminar siendo irrelevantes según cómo esté configurado "Allow
    // public access" en el dashboard de Realtime -- una config de
    // interfaz que no se puede confirmar ni forzar desde el código.
    presenceChannel = supabase.channel('catering-online-users', {
      config: { presence: { key: sessionId }, private: true },
    });
    if (typeof onChange === 'function') {
      presenceChannel.on('presence', { event: 'sync' }, () => {
        try {
          onChange(presenceChannel.presenceState());
        } catch (_) {
          /* ignorar: solo afecta el indicador visual de "en línea" */
        }
      });
    }
    presenceChannel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        try {
          await presenceChannel.track({ role: info.role, name: info.name || '', id: info.id || '', device: deviceLabel(), at: new Date().toISOString() });
        } catch (trackErr) {
          // TEMPORAL: antes se tragaba en silencio. "Conectados ahora" siempre
          // en 0 puede deberse a que .track() falla (ej. RLS de
          // realtime.messages si el proyecto tiene "Realtime Authorization"
          // activado, que exige políticas para canales — ver RLS lockdown
          // arriba en este archivo) o a que Realtime no está habilitado para
          // este proyecto de Supabase. Quitar este console.warn una vez
          // diagnosticado.
          console.warn('[presencia] track() falló, "Conectados ahora" no va a contar a este dispositivo:', trackErr);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // TEMPORAL: mismo diagnóstico que arriba, para el caso en que el
        // canal ni siquiera llegue a SUBSCRIBED.
        console.warn(`[presencia] canal 'catering-online-users' en estado "${status}", no se pudo suscribir:`, err);
      }
    });
    return presenceChannel;
  } catch (err) {
    console.error('[supabase] Error uniéndose al canal de presencia:', err);
    return null;
  }
}

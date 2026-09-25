import { supabase, getSessionToken } from './supabaseClient';
import { extractLatLngFromMapsField } from './dispatchHelpers';

// Los links cortos de Google Maps (maps.app.goo.gl/..
const SHORT_LINK_PATTERN = /maps\.app\.goo\.gl|goo\.gl\/maps/i;

export function isShortMapsLink(value) {
  return SHORT_LINK_PATTERN.test(String(value || ''));
}

// Si la dirección tiene un link corto y todavía no tiene coordenadas, intenta resolverlo
export async function resolveShortMapsLinkIfNeeded(addr) {
  if (!addr?.maps) {
    if (addr?.mapsResolvedFrom) return { ...addr, lat: null, lng: null, mapsResolvedFrom: null };
    return addr;
  }
  if (addr.lat != null && addr.mapsResolvedFrom === addr.maps) return addr;
  const direct = extractLatLngFromMapsField(addr.maps);
  if (direct) return { ...addr, lat: direct.lat, lng: direct.lng, mapsResolvedFrom: addr.maps };
  if (!isShortMapsLink(addr.maps)) return addr; // sin coordenadas en el texto y no es link corto: nada más…
  try {
    const { data, error } = await supabase.functions.invoke('resolve-maps-link', { body: { url: addr.maps, p_token: getSessionToken() } });
    if (error || !data || typeof data.lat !== 'number') return addr;
    return { ...addr, lat: data.lat, lng: data.lng, mapsResolvedFrom: addr.maps };
  } catch {
    return addr; // sin la función desplegada, sigue funcionando igual
  }
}

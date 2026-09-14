import { supabase } from './supabaseClient';
import { extractLatLngFromMapsField } from './dispatchHelpers';

// Los links cortos de Google Maps (maps.app.goo.gl/... o goo.gl/maps/...)
// no traen coordenadas en el texto -- hay que seguir la redirección para
// descubrirlas, y el navegador no puede hacer eso por CORS. Por eso existe
// la Edge Function "resolve-maps-link": corre del lado de Supabase, sigue
// el link, y devuelve lat/lng ya extraídos.
const SHORT_LINK_PATTERN = /maps\.app\.goo\.gl|goo\.gl\/maps/i;

export function isShortMapsLink(value) {
  return SHORT_LINK_PATTERN.test(String(value || ''));
}

// Si la dirección tiene un link corto y todavía no tiene coordenadas,
// intenta resolverlo. Si la función no está desplegada o falla, no pasa
// nada -- la dirección se guarda igual, solo que sin coordenadas exactas
// (el mapa cae de vuelta a buscar por texto).
//
// `mapsResolvedFrom` guarda cuál fue el link que efectivamente se
// resolvió, para poder distinguir "ya tiene coordenadas de ESTE link" de
// "tiene coordenadas de un link viejo que se acaba de reemplazar" -- solo
// en el primer caso conviene saltarse la resolución.
export async function resolveShortMapsLinkIfNeeded(addr) {
  if (!addr?.maps) return addr;
  if (addr.lat != null && addr.mapsResolvedFrom === addr.maps) return addr;
  const direct = extractLatLngFromMapsField(addr.maps);
  if (direct) return { ...addr, lat: direct.lat, lng: direct.lng, mapsResolvedFrom: addr.maps };
  if (!isShortMapsLink(addr.maps)) return addr; // sin coordenadas en el texto y no es link corto: nada más para intentar acá
  try {
    const { data, error } = await supabase.functions.invoke('resolve-maps-link', { body: { url: addr.maps } });
    if (error || !data || typeof data.lat !== 'number') return addr;
    return { ...addr, lat: data.lat, lng: data.lng, mapsResolvedFrom: addr.maps };
  } catch (_) {
    return addr; // sin la función desplegada, sigue funcionando igual
  }
}

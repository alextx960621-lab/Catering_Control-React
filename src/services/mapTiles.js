// Fondo del mapa de Reparto.
//
// Preferido: un archivo de mapa PROPIO de la ciudad (formato PMTiles, hecho con OpenStreetMap
// vía Protomaps) guardado en el bucket público "maps" de Supabase. No depende de ningún
// servidor de teselas de terceros, así que nadie puede bloquearlo por volumen de uso.
// Respaldo: si la empresa no eligió ciudad, o todavía no se subió el archivo de esa ciudad,
// se usa CARTO (raster) como hasta ahora — el mapa nunca queda sin fondo por este cambio.
import config from './config';

const CARTO_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Dónde viven los archivos. Por defecto, el bucket público "maps" del Supabase de esta empresa;
// se puede cambiar con `mapTilesBaseUrl` en public/config.js (p. ej. para usar un CDN).
export function mapTilesBaseUrl() {
  const custom = String(config.mapTilesBaseUrl || '').trim();
  if (custom) return custom.replace(/\/?$/, '/');
  return `${String(config.supabaseUrl || '').replace(/\/$/, '')}/storage/v1/object/public/maps/`;
}

export function mapFileUrl(cityId) {
  return `${mapTilesBaseUrl()}${encodeURIComponent(cityId)}.pmtiles`;
}

function carto(L) {
  return L.tileLayer(CARTO_URL, {
    maxZoom: 19,
    subdomains: 'abcd',
    // detectRetina: en pantallas con escala (Windows al 125/150%) sin esto Leaflet pide
    // teselas normales y las estira -> mapa "pixeleado". CARTO sirve @2x sin API key.
    detectRetina: true,
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
  });
}

// Devuelve { layer, source }: source es 'pmtiles' o 'carto'. Nunca lanza: ante cualquier
// problema con el archivo propio cae al respaldo.
export async function createBaseLayer(L, city, language = 'es') {
  if (city?.id) {
    try {
      const [{ PMTiles }, { leafletLayer }] = await Promise.all([import('pmtiles'), import('protomaps-leaflet')]);
      const archive = new PMTiles(mapFileUrl(city.id));
      await archive.getHeader(); // falla (404, sin red…) si el archivo de esa ciudad no está subido
      const layer = leafletLayer({
        url: archive,
        flavor: 'light',
        lang: ['es', 'en', 'pt'].includes(language) ? language : 'en',
        attribution: OSM_ATTRIBUTION,
        maxZoom: 19, // por encima del zoom máximo del archivo se amplía la última capa
      });
      return { layer, source: 'pmtiles' };
    } catch (err) {
      console.info(`[mapa] Sin archivo de mapa propio para "${city.id}" (${err?.message || err}); se usa CARTO.`);
    }
  }
  return { layer: carto(L), source: 'carto' };
}

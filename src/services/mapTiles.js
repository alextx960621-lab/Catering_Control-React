// Fondo del mapa de Reparto.
//
// Objetivo: que el mapa NUNCA quede gris, pase lo que pase. Para eso se combinan dos ideas:
//
// 1) Mapa PROPIO (PMTiles) como base: un archivo de la ciudad, hecho con OpenStreetMap vía
//    Protomaps y guardado en el bucket público "maps" de Supabase. Al servirlo tu propio
//    Supabase, ningún tercero puede bloquearlo por volumen de uso (que es justo lo que rompió
//    el mapa antes).
//
// 2) Cadena de teselas raster con reintento automático entre varios proveedores (CARTO → Esri
//    → OpenStreetMap). Se usa en dos sitios: como respaldo TOTAL si no hay archivo propio, y
//    como overlay en el zoom profundo (por encima del maxZoom real del .pmtiles, que hoy es z14,
//    porque protomaps-leaflet deja el lienzo vacío al pedir más). Si un proveedor empieza a
//    fallar (403, caída, saturación), la capa salta sola al siguiente sin recargar la página.
//
// Ningún proveedor exige tocar la CSP: `img-src ... https:` ya autoriza a todos.
import config from './config';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Orden de preferencia. El primero manda; si falla en cascada, se pasa al siguiente.
const RASTER_PROVIDERS = [
  {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    retina: true, // sirve @2x sin API key: nitidez en pantallas con escala (Windows 125/150%)
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
  },
  {
    // Esri World Street Map: CDN muy estable, gratuito para uso razonable, sin límites agresivos.
    // Ojo al orden {z}/{y}/{x} (ArcGIS lo usa al revés que XYZ).
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    subdomains: '',
    retina: false,
    attribution: `${OSM_ATTRIBUTION} &copy; Esri, Maxar, Earthstar Geographics`,
  },
  {
    // Último recurso. tile.openstreetmap.org crudo bloquea (403) con uso continuo, así que solo
    // se usa si CARTO y Esri también cayeron.
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    retina: false,
    attribution: OSM_ATTRIBUTION,
  },
];

const ERRORS_TO_SWITCH = 4; // tras esta cantidad de teselas falladas seguidas, se cambia de proveedor

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

// Crea una capa raster que arranca en el proveedor 0 y, si acumula fallos, avanza por la cadena
// sola (setUrl) hasta el último. Cualquier tesela que carga reinicia el contador. Nunca lanza.
function rasterLayer(L, extra = {}) {
  let idx = 0;
  let consecutiveErrors = 0;
  const first = RASTER_PROVIDERS[0];
  const layer = L.tileLayer(first.url, {
    maxZoom: 19,
    subdomains: first.subdomains || 'abcd',
    detectRetina: !!first.retina,
    attribution: first.attribution,
    ...extra,
  });

  const switchTo = (nextIdx) => {
    const p = RASTER_PROVIDERS[nextIdx];
    idx = nextIdx;
    consecutiveErrors = 0;
    // setUrl re-pide todas las teselas visibles con el nuevo proveedor.
    layer.setUrl(p.url, { subdomains: p.subdomains || 'abcd', detectRetina: !!p.retina, attribution: p.attribution });
    console.info(`[mapa] Proveedor de teselas caído; se pasa al #${nextIdx + 1} (${p.url.split('/')[2]}).`);
  };

  layer.on('tileerror', () => {
    consecutiveErrors += 1;
    if (consecutiveErrors >= ERRORS_TO_SWITCH && idx < RASTER_PROVIDERS.length - 1) switchTo(idx + 1);
  });
  layer.on('tileload', () => { consecutiveErrors = 0; });

  return layer;
}

// Devuelve { layer, source, maxNativeZoom }: source es 'pmtiles' o 'raster'. Nunca lanza: ante
// cualquier problema con el archivo propio cae a la cadena raster. Si se le pasa `map` y el fondo
// es propio, además enlaza el overlay raster para el zoom que el archivo no cubre.
export async function createBaseLayer(L, city, language = 'es', map) {
  if (city?.id) {
    try {
      const [{ PMTiles }, { leafletLayer }] = await Promise.all([import('pmtiles'), import('protomaps-leaflet')]);
      const archive = new PMTiles(mapFileUrl(city.id));
      const header = await archive.getHeader(); // falla (404, sin red…) si el archivo de esa ciudad no está subido
      const dataMaxZoom = Number(header.maxZoom) || 14;
      const layer = leafletLayer({
        url: archive,
        flavor: 'light',
        lang: ['es', 'en', 'pt'].includes(language) ? language : 'en',
        attribution: OSM_ATTRIBUTION,
        // El fondo se ofrece hasta el zoom alto del mapa: el archivo solo pinta hasta su maxZoom real
        // (z14) y por encima queda vacío. NO poner maxZoom=dataMaxZoom aquí, o Leaflet caparía el mapa
        // entero a ese zoom y no se podría acercar. Por encima de dataMaxZoom entra el overlay raster.
        maxZoom: 19,
      });
      if (map) attachDeepZoomOverlay(L, map, dataMaxZoom);
      return { layer, source: 'pmtiles', maxNativeZoom: dataMaxZoom };
    } catch (err) {
      console.info(`[mapa] Sin archivo de mapa propio para "${city.id}" (${err?.message || err}); se usa la cadena raster.`);
    }
  }
  return { layer: rasterLayer(L), source: 'raster', maxNativeZoom: 19 };
}

// Superpone la cadena raster solo cuando el zoom supera lo que el archivo propio alcanza, y la
// quita al volver a salir de ese rango. El overlay vive en el tilePane, por encima del fondo propio
// (se añade después); los marcadores/línea de ruta siguen viéndose porque usan otro pane.
function attachDeepZoomOverlay(L, map, dataMaxZoom) {
  let overlay = null;
  const sync = () => {
    const needDeep = map.getZoom() > dataMaxZoom;
    if (needDeep && !overlay) {
      overlay = rasterLayer(L, { minZoom: dataMaxZoom + 1 });
      map.addLayer(overlay);
    } else if (!needDeep && overlay) {
      map.removeLayer(overlay);
      overlay = null;
    }
  };
  map.on('zoomend', sync);
  sync();
}

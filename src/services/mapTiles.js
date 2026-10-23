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
//    → OpenStreetMap). Se usa SOLO como respaldo total: cuando la empresa no tiene archivo propio,
//    o el archivo no sirve (no se subió, el Range/CORS falla, no cubre el centro de la ciudad). Si un
//    proveedor falla (403, caída, colgado), la capa salta sola al siguiente sin recargar la página.
//    El zoom profundo ya no necesita proveedor ajeno: el archivo propio se amplía (maxDataZoom).
//
// Ningún proveedor exige tocar la CSP: `img-src ... https:` ya autoriza a todos.
import config from './config';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Orden de preferencia. El primero manda; si falla en cascada, se pasa al siguiente.
const RASTER_PROVIDERS = [
  {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
  },
  {
    // Esri World Street Map: CDN muy estable, gratuito para uso razonable, sin límites agresivos.
    // Ojo al orden {z}/{y}/{x} (ArcGIS lo usa al revés que XYZ).
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    subdomains: '',
    attribution: `${OSM_ATTRIBUTION} &copy; Esri, Maxar, Earthstar Geographics`,
  },
  {
    // Último recurso. tile.openstreetmap.org crudo bloquea (403) con uso continuo, así que solo
    // se usa si CARTO y Esri también cayeron.
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc', // OSM solo tiene a/b/c: con 'abcd' una de cada cuatro teselas iba a un host que no existe
    attribution: OSM_ATTRIBUTION,
  },
];

const ERRORS_TO_SWITCH = 4; // tras esta cantidad de teselas falladas seguidas, se cambia de proveedor
const STALL_MS = 7000; // si en este tiempo no cargó NI UNA tesela del proveedor actual, se pasa al siguiente

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

// Cadena raster con reintento automático entre proveedores. Devuelve un LayerGroup que contiene UNA
// capa a la vez: al fallar, se reemplaza por una capa NUEVA del siguiente proveedor (antes se
// cambiaba la URL con setUrl, que no redibujaba ni actualizaba los subdominios, y el mapa seguía
// gris hasta mover el mapa). `{r}` ya lo rellena Leaflet con "@2x" en pantallas de alta densidad,
// por eso NO se usa detectRetina (pedía teselas @2x de un zoom más: 4 veces los datos para nada).
function rasterLayer(L) {
  const group = L.layerGroup();
  let state = null;
  let timer = null;

  const next = () => {
    if (state.idx >= RASTER_PROVIDERS.length - 1) return;
    console.info(`[mapa] Proveedor de teselas sin respuesta; se pasa al #${state.idx + 2} (${RASTER_PROVIDERS[state.idx + 1].url.split('/')[2]}).`);
    start(state.idx + 1);
  };

  const start = (idx) => {
    clearTimeout(timer);
    const st = { idx, loaded: 0, errors: 0 };
    state = st;
    const p = RASTER_PROVIDERS[idx];
    const layer = L.tileLayer(p.url, { maxZoom: 19, subdomains: p.subdomains || 'abc', attribution: p.attribution });
    layer.on('tileload', () => { if (st !== state) return; st.loaded += 1; st.errors = 0; clearTimeout(timer); });
    layer.on('tileerror', () => { if (st !== state) return; st.errors += 1; if (st.errors >= ERRORS_TO_SWITCH) next(); });
    group.clearLayers();
    group.addLayer(layer);
    // Un proveedor que no responde (colgado, bloqueado por red) no genera errores: se detecta por silencio.
    if (idx < RASTER_PROVIDERS.length - 1) timer = setTimeout(() => { if (st === state && !st.loaded) next(); }, STALL_MS);
  };

  start(0);
  group.on('remove', () => clearTimeout(timer));
  return group;
}

// Tesela (x, y) que contiene un punto en el zoom z (esquema XYZ estándar).
function tileFor(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

// Comprueba que el archivo propio de verdad sirve datos del centro de la ciudad (que el Range/CORS
// funciona y que el recorte no quedó en otro lado). protomaps-leaflet NO avisa cuando una tesela
// falla: solo pinta el fondo, y eso es justo el "mapa gris". Si esto lanza, se usa la cadena raster.
async function probeArchive(archive, city, header) {
  const z = Math.max(Number(header.minZoom) || 0, Math.min(Number(header.maxZoom) || 14, 12));
  const { x, y } = tileFor(city.lat, city.lng, z);
  const tile = await archive.getZxy(z, x, y);
  if (!tile?.data) throw new Error(`el archivo no trae datos del centro de la ciudad (z${z})`);
}

// Devuelve { layer, source }: source es 'pmtiles' o 'raster'. Nunca lanza: ante cualquier problema
// con el archivo propio cae a la cadena raster.
export async function createBaseLayer(L, city, language = 'es') {
  if (city?.id) {
    try {
      const [{ PMTiles }, { leafletLayer }] = await Promise.all([import('pmtiles'), import('protomaps-leaflet')]);
      const archive = new PMTiles(mapFileUrl(city.id));
      const header = await archive.getHeader(); // falla (404, sin red…) si el archivo de esa ciudad no está subido
      await probeArchive(archive, city, header);
      const layer = leafletLayer({
        url: archive,
        flavor: 'light',
        lang: ['es', 'en', 'pt'].includes(language) ? language : 'en',
        attribution: OSM_ATTRIBUTION,
        // El archivo llega a su maxZoom real (z14 para una ciudad); protomaps-leaflet asume z15 si no
        // se le dice, y desde ahí pintaba solo el fondo gris (justo el zoom con que abre una ruta).
        // Con maxDataZoom amplía el último nivel con datos, así que no hace falta ningún mapa ajeno.
        maxDataZoom: Number(header.maxZoom) || 14,
        maxZoom: 19,
      });
      return { layer, source: 'pmtiles' };
    } catch (err) {
      console.info(`[mapa] Sin archivo de mapa propio utilizable para "${city.id}" (${err?.message || err}); se usa la cadena raster.`);
    }
  }
  return { layer: rasterLayer(L), source: 'raster' };
}

// Fondo del mapa de Reparto.
//
// Objetivo: que el mapa NUNCA quede gris, pase lo que pase. Para eso se combinan dos ideas:
//
// 1) Mapa PROPIO (PMTiles) como base: un archivo de la ciudad, hecho con OpenStreetMap vía
//    Protomaps y guardado en el bucket público "maps" de Supabase. Al servirlo tu propio
//    Supabase, ningún tercero puede bloquearlo por volumen de uso (que es justo lo que rompió
//    el mapa antes).
//
// 2) Cadena de teselas raster con reintento automático entre varios proveedores (Esri Street →
//    OpenTopoMap → Esri Topo). Se usa en dos sitios: como respaldo TOTAL si no hay archivo propio, y
//    como overlay en el zoom profundo (por encima del maxZoom real del .pmtiles, que hoy es z14,
//    porque protomaps-leaflet deja el lienzo vacío al pedir más). Si un proveedor empieza a
//    fallar (403, caída, saturación) o responde con una imagen de relleno, la capa salta sola al
//    siguiente sin recargar la página.
//
// Ningún proveedor exige tocar la CSP: `img-src ... https:` ya autoriza a todos.
import config from './config';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Orden de preferencia. El primero manda; si falla en cascada, se pasa al siguiente.
//
// CARTO estaba acá y se sacó (medición 2026-10-22): `basemaps.cartocdn.com` responde HTTP 200 con
// LA MISMA imagen de 2049 bytes que dice "API KEY REQUIRED" en todos los zooms z13-z18. Como el
// código de estado es 200, `tileerror` nunca salta y la cascada no se activaba: el mapa quedaba
// tapado de marquesinas para siempre. Ahora CARTO exige API key para sus teselas base.
//
// OpenStreetMap crudo (tile.openstreetmap.org) también estaba acá como último recurso y se sacó: su
// política de uso prohíbe servir teselas a apps en producción, y bloquea por user-agent / volumen.
// Medido el 2026-10-22 desde node con el UA de la app: HTTP 200 con un PNG IDÉNTICO de 6987 bytes y
// cabecera `x-blocked: Access denied…`, o sea la foto del bloqueo pintada en cada tesela (otro mapa
// gris imposible de detectar con `tileerror`, porque el estado sigue siendo 200). Los tres candidatos
// que sí devuelven teselas distintas entre sí son los de abajo.
const RASTER_PROVIDERS = [
  {
    // Esri World Street Map: CDN muy estable, gratuito para uso razonable, sin límites agresivos.
    // Ojo al orden {z}/{y}/{x} (ArcGIS lo usa al revés que XYZ).
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    subdomains: '',
    retina: false,
    attribution: `${OSM_ATTRIBUTION} &copy; Esri, Maxar, Earthstar Geographics`,
  },
  {
    // OpenTopoMap: otro servidor distinto al de Esri (si ArcGISOnline cae, este sigue), con relieve
    // y nombres de calles. Uso moderado, que es justo el de un panel de reparto.
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    retina: false,
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`,
  },
  {
    // Esri World Topo Map: último recurso. Mismo servidor que el primero pero otro servicio, así
    // cubre que se caiga solo World_Street_Map.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    subdomains: '',
    retina: false,
    attribution: `${OSM_ATTRIBUTION} &copy; Esri, HERE, Garmin, USGS, EPA, NPS`,
  },
];

const ERRORS_TO_SWITCH = 4; // tras esta cantidad de teselas falladas seguidas, se cambia de proveedor

// Sonda anti-marquesina: dos teselas VECINAS que dan idénticas no son un mapa, son la imagen de
// relleno del CDN (los casos CARTO y OSM crudo de arriba). Se prueba z14 sobre La Paz.
//
// Se hace con <img> + canvas y NO con fetch: la CSP de public/_headers autoriza `connect-src` solo a
// Supabase/OSRM/Nominatim, así que un fetch a estos CDN caería bloqueado en producción y la sonda
// nunca decidiría nada. `img-src ... https:` sí deja cargar imágenes de teselas, y los proveedores de
// la cadena mandan `Access-Control-Allow-Origin: *`, que es lo que permite leer el canvas.
const SONDA = { z: 14, x: 5090, y: 8953 };

function urlDeSonda(p, dx) {
  return p.url
    .replace('{z}', SONDA.z).replace('{y}', SONDA.y).replace('{x}', SONDA.x + dx)
    .replace('{r}', '').replace('{s}', (p.subdomains || 'abcd')[0]);
}

function cargarTesela(p, dx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => { img.onload = img.onerror = null; reject(new Error('sin respuesta a tiempo')); }, 8000);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); reject(new Error('la tesela no cargó')); };
    img.src = urlDeSonda(p, dx);
  });
}

// Huella barata de la imagen (muestra 1 de cada 16 bytes de píxel). Lanza SecurityError si el CDN no
// mandó CORS: en ese caso la sonda no puede decidir y se deja el proveedor, que vigila tileerror.
function firma(img) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i]) | 0;
  return h;
}

async function proveedorVivo(p) {
  try {
    const [a, b] = await Promise.all([0, 1].map((dx) => cargarTesela(p, dx)));
    if (firma(a) !== firma(b)) return true; // teselas distintas => mapa real
    console.warn('[mapa] Proveedor descartado: la misma imagen para dos teselas distintas (relleno tipo "API KEY REQUIRED").');
    return false;
  } catch {
    return true;
  }
}

// Elige el primer proveedor que pasa la sonda. Si ninguno pasa (sin red, todos capados), deja el 0
// para que al menos intente pintar y la cascada por tileerror haga lo suyo.
async function elegirProveedor(desde = 0) {
  for (let i = desde; i < RASTER_PROVIDERS.length; i++) {
    if (await proveedorVivo(RASTER_PROVIDERS[i])) return i;
  }
  return -1;
}

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

// Crea una capa raster que arranca en el proveedor 0 y, si acumula fallos o si la sonda lo detecta
// capado, avanza por la cadena solo (setUrl) hasta el último. Cualquier tesela que carga reinicia el
// contador. Nunca lanza.
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

  const aplicar = (nextIdx) => {
    const p = RASTER_PROVIDERS[nextIdx];
    idx = nextIdx;
    consecutiveErrors = 0;
    // setUrl re-pide todas las teselas visibles con el nuevo proveedor.
    layer.setUrl(p.url, { subdomains: p.subdomains || 'abcd', detectRetina: !!p.retina, attribution: p.attribution });
    console.info(`[mapa] Proveedor de teselas cambiado al #${nextIdx + 1} (${p.url.split('/')[2]}).`);
  };

  // La sonda corre en segundo plano: el mapa pinta con el proveedor 0 mientras se prueba, y solo
  // salta de proveedor si la prueba dice que ese no devuelve mapa real.
  elegirProveedor(idx).then((vivo) => {
    if (vivo >= 0 && vivo !== idx) aplicar(vivo);
  });

  layer.on('tileerror', () => {
    consecutiveErrors += 1;
    if (consecutiveErrors >= ERRORS_TO_SWITCH && idx < RASTER_PROVIDERS.length - 1) aplicar(idx + 1);
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
      if (map) {
        attachDeepZoomOverlay(L, map, dataMaxZoom);
        attachPmtilesFailsafe(L, map, layer);
      }
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

// Red de seguridad del archivo propio: si el encabezado cargó pero las teselas no se pintan (archivo
// dañado, Range/CORS bloqueado, versión incompatible), el lienzo quedaba gris sin respaldo porque
// `createBaseLayer` ya había elegido 'pmtiles'. Tras varios fallos SIN ninguna tesela buena, se
// quita la capa propia y entra la cadena raster.
function attachPmtilesFailsafe(L, map, layer) {
  let errors = 0;
  let loaded = 0;
  layer.on('tileload', () => { loaded += 1; });
  layer.on('tileerror', () => {
    errors += 1;
    if (loaded === 0 && errors >= ERRORS_TO_SWITCH) {
      layer.off('tileerror');
      map.removeLayer(layer);
      map.addLayer(rasterLayer(L));
      console.info('[mapa] El archivo propio no pintó teselas; se usa la cadena raster.');
    }
  });
}

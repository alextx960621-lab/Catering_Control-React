// Calcula una ruta real por calles entre varias paradas usando OSRM (un
// servicio público y gratuito de OpenStreetMap). Se guarda en caché por
// combinación exacta de puntos, para no volver a pedir lo mismo dos
// veces en la misma sesión del navegador.
const CACHE_KEY = 'catering-road-route-cache-v1';

function loadCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || {}; } catch (_) { return {}; }
}
function saveCache(cache) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* sessionStorage lleno/bloqueado */ }
}
function routeKey(points) {
  return points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
}

// `points`: array de [lat, lng], en el orden en que se visitan.
export async function fetchRoadRoute(points, force) {
  if (points.length < 2) return null;
  const key = routeKey(points);
  const cache = loadCache();
  if (!force && cache[key]) return cache[key];
  try {
    const coordsParam = points.map((p) => `${p[1]},${p[0]}`).join(';'); // OSRM espera lng,lat
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;
    const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const result = { latlngs, km: route.distance / 1000, minutes: route.duration / 60 };
    cache[key] = result;
    saveCache(cache);
    return result;
  } catch (err) {
    console.error('[roadRoute] No se pudo calcular la ruta por calles:', err);
    return null;
  }
}

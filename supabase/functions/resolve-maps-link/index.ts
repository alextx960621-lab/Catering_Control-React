// supabase/functions/resolve-maps-link/index.ts
// ============================================================================
// Sigue un link corto de Google Maps (maps.app.goo.gl/... o
// goo.gl/maps/...) y devuelve las coordenadas (lat/lng) que trae la URL
// final después de la redirección -- el navegador no puede seguir esa
// redirección él solo por CORS, así que esto corre del lado de Supabase.
// La consume src/services/resolveMapsLink.js (resolveShortMapsLinkIfNeeded).
//
// Deploy (sin verificación de JWT de Supabase Auth -- esta app nunca usa
// Supabase Auth, el login propio no tiene JWT que verificar acá):
//   supabase functions deploy resolve-maps-link --no-verify-jwt
//
// Body esperado (JSON): { url: string }
// Respuesta: SIEMPRE 200. { lat, lng } si se pudo resolver, o
// { error: string } si no -- "no encontré coordenadas" no es un error de
// red/servidor, es un resultado válido, así que nunca conviene devolver
// un código 4xx/5xx acá: supabase-js trata cualquier status != 2xx como
// `error` y el body con el detalle real deja de leerse en el frontend.
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Mismos patrones que services/dispatchHelpers.js (extractLatLngFromMapsField)
// -- se duplican acá a propósito: esta función corre en Deno, aparte del
// bundle de React, y no vale la pena complicar el build de Vite por
// compartir un archivo de 4 líneas de regex entre los dos runtimes.
//
// Orden importa: primero los patrones más precisos. "!3d..!4d.." es la
// coordenada EXACTA del pin dentro de un link de "lugar" de Google Maps.
// "@lat,lng" es solo el centro de la cámara del mapa al compartir y puede
// venir corrido de la ubicación real, así que se prueba último entre los
// que sí tienen coordenadas explícitas en la URL.
function extractLatLng(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Body inválido, se esperaba JSON.' });
  }

  const url = String(body?.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: 'Falta "url" o no es un link válido.' });
  }

  // Si el link "corto" en realidad ya trae coordenadas en el propio
  // texto (pasa a veces), ni hace falta seguir la redirección.
  let coords = extractLatLng(url);
  if (coords) return json(coords);

  try {
    // Sigue la redirección del link corto -- Google resuelve
    // maps.app.goo.gl/xxxx a una URL larga que casi siempre trae
    // coordenadas (@lat,lng o !3dlat!4dlng) sin necesidad de leer el
    // cuerpo de la respuesta.
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
    coords = extractLatLng(res.url);

    // Respaldo: si la URL final no trae coordenadas visibles (a veces
    // Google arma la URL larga solo con el nombre del lugar), Google
    // igual suele dejarlas incrustadas en el HTML de esa página --
    // se busca ahí antes de rendirse del todo.
    if (!coords) {
      const html = await res.text();
      coords = extractLatLng(html);
    }

    if (!coords) return json({ error: 'No se encontraron coordenadas en el link resuelto.' });
    return json(coords);
  } catch (err) {
    return json({ error: `No se pudo seguir el link: ${err instanceof Error ? err.message : String(err)}` });
  }
});

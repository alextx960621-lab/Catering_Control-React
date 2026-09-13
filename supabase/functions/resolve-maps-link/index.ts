// supabase/functions/resolve-maps-link/index.ts
//
// Sigue un link corto de Google Maps (maps.app.goo.gl/... o
// goo.gl/maps/...) y devuelve las coordenadas (lat/lng) que trae la URL
// final después de la redirección -- el navegador no puede seguir esa
// redirección él solo por CORS, así que esto corre del lado de Supabase.
// La consume src/services/resolveMapsLink.js (resolveShortMapsLinkIfNeeded).
//
// NOTA (12 sep): esta función estaba REFERENCIADA en el código y en los
// comentarios de `image-storage/index.ts` ("igual que resolve-maps-link")
// pero el archivo nunca había sido creado -- por eso nunca pudo
// desplegarse ni funcionar. Si ya la habías desplegado a mano desde el
// dashboard de Supabase con otro contenido, este archivo la reemplaza (es
// el mismo nombre de función); volver a desplegar con el comando de abajo.
//
// A diferencia de `image-storage`, esta función NO valida token de sesión:
// solo sigue una URL pública de Google Maps y lee coordenadas de la URL
// resultante, no toca datos de la empresa ni necesita saber quién pregunta.
//
// Deploy (sin verificación de JWT de Supabase Auth -- esta app nunca usa
// Supabase Auth, el login propio no tiene JWT que verificar acá):
//   supabase functions deploy resolve-maps-link --no-verify-jwt
//
// Body esperado (JSON): { url: string }
// Respuesta OK:    { lat: number, lng: number }
// Respuesta error: { error: string }  (el cliente sigue funcionando igual,
//                    solo se queda sin coordenadas exactas para ese link)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Mismos patrones que services/dispatchHelpers.js (extractLatLngFromMapsField)
// -- se duplican acá a propósito: esta función corre en Deno, aparte del
// bundle de React, y no vale la pena complicar el build de Vite por
// compartir un archivo de 4 líneas de regex entre los dos runtimes.
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
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Body inválido, se esperaba JSON.' }, 400);
  }

  const url = String(body?.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: 'Falta "url" o no es un link válido.' }, 400);
  }

  try {
    // Sigue la redirección del link corto -- Google resuelve
    // maps.app.goo.gl/xxxx a una URL larga que sí trae coordenadas
    // (@lat,lng o !3dlat!4dlng), sin necesidad de leer el cuerpo.
    const res = await fetch(url, { redirect: 'follow' });
    // Algunos links redirigen varias veces y la URL final (res.url) ya
    // trae las coordenadas; si no, como último recurso se busca también
    // en el cuerpo de la respuesta (Google a veces las deja en el HTML
    // aunque la URL final no las muestre explícitamente).
    let coords = extractLatLng(res.url);
    if (!coords) {
      const html = await res.text();
      coords = extractLatLng(html);
    }
    if (!coords) return json({ error: 'No se encontraron coordenadas en el link resuelto.' }, 422);
    return json({ lat: coords.lat, lng: coords.lng });
  } catch (err) {
    return json({ error: `No se pudo seguir el link: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
});

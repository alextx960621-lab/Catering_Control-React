// supabase/functions/resolve-maps-link/index.ts Sigue un link corto de Google Maps…

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_HOPS = 6;
const MAX_HTML_BYTES = 400_000;

// Solo Google Maps / goo.gl, siempre por https, sin puertos ni credenciales
function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    return (
      h === 'goo.gl' || h.endsWith('.goo.gl') ||
      h === 'google.com' || h.endsWith('.google.com') ||
      /^(www\.)?google\.com\.[a-z]{2}$/.test(h)
    );
  } catch {
    return false;
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch {/* ignorar */}
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return new TextDecoder().decode(all);
}

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

// Mismos patrones que services/dispatchHelpers.js (extractLatLngFromMapsField) se duplican…
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
  } catch {
    return json({ error: 'Body inválido, se esperaba JSON.' });
  }

  // Solo personal con sesión válida
  const token = String(body?.p_token || '');
  if (!token) return json({ error: 'No autorizado.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: session } = await admin
    .from('db_sessions')
    .select('subject_type, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!session || session.subject_type !== 'staff' || new Date(session.expires_at).getTime() < Date.now()) {
    return json({ error: 'No autorizado.' });
  }

  const url = String(body?.url || '').trim();
  if (!url || url.length > 2000 || !isAllowedUrl(url)) {
    return json({ error: 'Solo se aceptan links de Google Maps.' });
  }

  // Si el link "corto" en realidad ya trae coordenadas en el propio texto (pasa a veces), ni…
  let coords = extractLatLng(url);
  if (coords) return json(coords);

  try {
    // Se siguen las redirecciones a mano para validar CADA salto: un link de Google no puede…
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, current).toString();
        if (!isAllowedUrl(next)) return json({ error: 'El link redirige fuera de Google Maps.' });
        current = next;
        coords = extractLatLng(current);
        if (coords) return json(coords);
        continue;
      }
      break;
    }
    if (!res) return json({ error: 'No se pudo seguir el link.' });

    coords = extractLatLng(res.url || current);
    if (!coords && res.status === 200) {
      const html = await readLimited(res, MAX_HTML_BYTES);
      coords = extractLatLng(html);
    }
    if (!coords) return json({ error: 'No se encontraron coordenadas en el link resuelto.' });
    return json(coords);
  } catch (err) {
    return json({ error: `No se pudo seguir el link: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// supabase-functions/verificar-comprobante/index.ts
//
// Se llama desde PlanChangeModal.jsx justo después de que
// cliente_crear_comprobante() crea la fila en db_comprobantes_rows -- esta
// función es la que de verdad "lee" el comprobante y decide si activa sola
// la renovación o si queda pendiente para que el staff lo revise a mano.
//
// Body esperado: { p_token, p_comprobante_id }
// Devuelve: { estado: 'aprobado_auto' } | { estado: 'pendiente_revision', motivo }
//
// Variables de entorno necesarias (configurar como secrets del proyecto,
// NO están disponibles por defecto como SUPABASE_URL/SERVICE_ROLE_KEY):
//   ANTHROPIC_API_KEY   -> supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Deploy:
//   supabase functions deploy verificar-comprobante --no-verify-jwt
//
// COMPRESIÓN DESPUÉS DE LEER: para imagen usa imagescript (WASM, liviana).
// Para PDF usa mupdf (también WASM, la librería oficial de Artifex) para
// rasterizar la primera página a un JPEG chico y REEMPLAZAR el PDF por esa
// imagen (se actualiza storagePath/mimeType del comprobante). Ninguna de
// las dos rutas la pude probar de verdad contra un proyecto de Supabase
// real -- están escritas siguiendo la documentación oficial de cada
// librería y son best-effort (si fallan, quedan logueadas en consola y el
// archivo original se deja tal cual, no rompen el resto del flujo), pero
// probalas con un comprobante de prueba antes de confiar en que el espacio
// se está liberando solo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
// @deno-types="npm:mupdf@1.3.5"
import * as mupdf from 'npm:mupdf@1.3.5';

const BUCKET = 'app-images';
const MONTO_TOLERANCIA = 1; // bolivianos de margen por redondeo/lectura

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Le pide a Claude que lea el comprobante y devuelva SOLO JSON con lo que
// pudo extraer. No hace falta más que un par de campos -- monto es lo único
// que de verdad se usa para decidir, fecha/referencia quedan de respaldo.
async function leerComprobante(base64: string, mediaType: string): Promise<{ monto: number | null; confianza: 'alta' | 'media' | 'baja'; referencia: string | null }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Falta configurar el secret ANTHROPIC_API_KEY en el proyecto de Supabase.');

  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text:
              'Esto es un comprobante de pago boliviano (transferencia o depósito QR). ' +
              'Devolvé SOLO un objeto JSON, sin texto alrededor ni backticks, con esta forma exacta: ' +
              '{"monto": <número en bolivianos, o null si no se lee con claridad>, ' +
              '"confianza": "alta" | "media" | "baja", ' +
              '"referencia": "<número de operación/referencia si aparece, si no null>"}. ' +
              'Si la imagen no es un comprobante de pago o está ilegible, monto debe ser null y confianza "baja".',
          },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API respondió ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data?.content || []).map((b: any) => b.text || '').join('').trim();
  const cleaned = text.replace(/^```json\s*|```$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      monto: typeof parsed.monto === 'number' ? parsed.monto : null,
      confianza: ['alta', 'media', 'baja'].includes(parsed.confianza) ? parsed.confianza : 'baja',
      referencia: parsed.referencia || null,
    };
  } catch (_) {
    return { monto: null, confianza: 'baja', referencia: null };
  }
}

// Best-effort: reduce el peso de la imagen ya leída. Si algo falla acá, NO
// se rompe el resto del flujo -- el comprobante queda guardado en la
// calidad original, que es peor para el espacio pero no es un error grave.
async function comprimirImagen(admin: any, path: string, bytes: Uint8Array) {
  try {
    const img = await Image.decode(bytes);
    const maxDim = 700;
    if (img.width > maxDim || img.height > maxDim) img.resize(maxDim, Image.RESIZE_AUTO);
    const out = await img.encodeJPEG(55);
    await admin.storage.from(BUCKET).update(path, out, { contentType: 'image/jpeg', upsert: true });
  } catch (err) {
    console.error('[verificar-comprobante] No se pudo re-comprimir la imagen (se deja la original):', err);
  }
}

// Best-effort, igual que comprimirImagen: rasteriza la página 1 a JPEG chico
// (API de mupdf.js: Document.openDocument -> loadPage -> toPixmap -> asJPEG,
// ver https://mupdfjs.readthedocs.io/). Sube el JPEG con un path nuevo,
// borra el PDF viejo, y devuelve el nuevo {path, mimeType} para que quien
// llama actualice el comprobante -- si algo falla, devuelve null y el PDF
// original queda como estaba.
async function comprimirPdf(admin: any, oldPath: string, bytes: Uint8Array): Promise<{ path: string; mimeType: string } | null> {
  try {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const page = doc.loadPage(0);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(0.7, 0.7), mupdf.ColorSpace.DeviceRGB, false, true);
    const jpeg = pixmap.asJPEG(55, false);
    const newPath = oldPath.replace(/\.pdf$/i, '_comprimido.jpg');

    const { error: upErr } = await admin.storage.from(BUCKET).upload(newPath, jpeg, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;
    await admin.storage.from(BUCKET).remove([oldPath]);
    return { path: newPath, mimeType: 'image/jpeg' };
  } catch (err) {
    console.error('[verificar-comprobante] No se pudo comprimir el PDF (se deja el original):', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: 'Body inválido, se esperaba JSON.' }, 400); }

  const { p_token, p_comprobante_id } = body || {};
  if (!p_token || !p_comprobante_id) return json({ error: 'Parámetros inválidos.' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Misma validación que image-storage: consulta db_sessions directo con
  // service_role (salta el RLS "using (false)").
  const { data: session } = await admin
    .from('db_sessions')
    .select('subject_type, subject_id, expires_at')
    .eq('token', p_token)
    .maybeSingle();
  if (!session || session.subject_type !== 'cliente' || new Date(session.expires_at).getTime() < Date.now()) {
    return json({ error: 'Sesión inválida o expirada.' }, 401);
  }

  const { data: comp } = await admin.from('db_comprobantes_rows').select('id, payload').eq('id', p_comprobante_id).maybeSingle();
  if (!comp) return json({ error: 'Comprobante no encontrado.' }, 404);
  if (comp.payload.clientId !== session.subject_id) return json({ error: 'No autorizado.' }, 403);
  if (comp.payload.estado !== 'pendiente_lectura') return json({ estado: comp.payload.estado }); // ya procesado, no repetir

  const path = comp.payload.storagePath as string;
  const mimeType = (comp.payload.mimeType as string) || 'image/jpeg';

  const { data: fileBlob, error: downloadErr } = await admin.storage.from(BUCKET).download(path);
  if (downloadErr || !fileBlob) {
    console.error('[verificar-comprobante] No se pudo descargar el archivo:', downloadErr);
    await admin.from('db_comprobantes_rows').update({
      payload: { ...comp.payload, estado: 'pendiente_revision', motivoError: 'No se pudo leer el archivo subido.' },
    }).eq('id', p_comprobante_id);
    return json({ estado: 'pendiente_revision', motivo: 'no_se_pudo_descargar' });
  }
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const base64 = bytesToBase64(bytes);

  let lectura;
  try {
    lectura = await leerComprobante(base64, mimeType);
  } catch (err) {
    console.error('[verificar-comprobante] Error leyendo con IA:', err);
    await admin.from('db_comprobantes_rows').update({
      payload: { ...comp.payload, estado: 'pendiente_revision', motivoError: String(err?.message || err) },
    }).eq('id', p_comprobante_id);
    return json({ estado: 'pendiente_revision', motivo: 'error_lectura' });
  }

  const montoEsperado = Number(comp.payload.montoEsperado);
  const coincide = lectura.monto !== null && Math.abs(lectura.monto - montoEsperado) <= MONTO_TOLERANCIA && lectura.confianza !== 'baja';

  if (coincide) {
    await admin.rpc('_aplicar_renovacion', {
      p_client_id: comp.payload.clientId,
      p_plan_id: comp.payload.planId,
      p_dias: comp.payload.dias,
      p_modo: 'carry', // regla por defecto para el flujo automático (ver conversación / README)
    });

    const nuevoPayload = {
      ...comp.payload,
      estado: 'aprobado_auto',
      montoLeido: lectura.monto,
      confianza: lectura.confianza,
      referenciaLeida: lectura.referencia,
      fechaLectura: new Date().toISOString(),
    };
    await admin.from('db_comprobantes_rows').update({ payload: nuevoPayload }).eq('id', p_comprobante_id);

    if (comp.payload.noteId) {
      const { data: note } = await admin.from('db_notas_rows').select('id, payload').eq('id', comp.payload.noteId).maybeSingle();
      if (note) {
        await admin.from('db_notas_rows').update({
          payload: {
            ...note.payload,
            status: 'cumplida',
            autoApproved: true,
            waPending: true,
            waPlanName: comp.payload.planNombre,
            waDays: comp.payload.dias,
            waKind: comp.payload.tipo === 'plan_nuevo' ? 'compra' : 'renovacion',
          },
        }).eq('id', comp.payload.noteId);
      }
    }

    // Best-effort, no bloquea la respuesta si falla ninguna de las dos.
    if (mimeType === 'application/pdf') {
      const nuevo = await comprimirPdf(admin, path, bytes);
      if (nuevo) {
        await admin.from('db_comprobantes_rows')
          .update({ payload: { ...nuevoPayload, storagePath: nuevo.path, mimeType: nuevo.mimeType } })
          .eq('id', p_comprobante_id);
      }
    } else {
      await comprimirImagen(admin, path, bytes);
    }

    return json({ estado: 'aprobado_auto' });
  }

  const nuevoPayload = {
    ...comp.payload,
    estado: 'pendiente_revision',
    montoLeido: lectura.monto,
    confianza: lectura.confianza,
    referenciaLeida: lectura.referencia,
    fechaLectura: new Date().toISOString(),
  };
  await admin.from('db_comprobantes_rows').update({ payload: nuevoPayload }).eq('id', p_comprobante_id);
  return json({ estado: 'pendiente_revision', motivo: 'monto_no_coincide' });
});

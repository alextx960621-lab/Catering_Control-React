// supabase-functions/image-storage/index.ts
//
// Cierra el hueco de seguridad documentado en supabase-setup-final-v2.sql
// (sección 5) y en src/services/db.js: el bucket "app-images" ya NO tiene
// políticas de insert/update/delete abiertas a `anon` (ver sección 16 del
// SQL). Esta función es el único camino que le queda al navegador para
// subir o borrar una imagen -- y antes de hacer nada, valida el mismo
// token de sesión que ya usan todas las RPCs de la app (`db_sessions`).
//
// La app nunca usa Supabase Auth: todo el mundo se conecta con la anon
// key, así que Postgres no puede distinguir "personal legítimo" de
// "cualquiera con la anon key" solo con RLS. Por eso la validación de
// sesión tiene que pasar por acá, del lado del servidor, con la
// service_role key (que nunca viaja al navegador).
//
// Deploy (igual que resolve-maps-link, sin verificación de JWT de
// Supabase Auth -- el token que valida es el propio de la app):
//   supabase functions deploy image-storage --no-verify-jwt
//
// Variables de entorno que necesita (ya están disponibles por defecto en
// todo proyecto de Supabase, no hace falta configurarlas a mano):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Body esperado (JSON), dos acciones:
//   { action: 'upload-url', p_token, p_path }
//     -> { signedUrl, token, path }  (el navegador sube el archivo él
//        mismo con supabase.storage.from(bucket).uploadToSignedUrl(...),
//        los bytes de la imagen nunca pasan por esta función)
//   { action: 'remove', p_token, p_path }
//     -> { ok: true }

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'app-images';
// folder/nombre-de-archivo.ext -- mismo formato que arma imageUpload.js
// (`${folder}/${uid('img')}.jpg`). Se valida acá también para que nadie
// pueda mandar un path con "../" o apuntar fuera del bucket.
const PATH_PATTERN = /^[a-z0-9_-]+\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Body inválido, se esperaba JSON.' }, 400);
  }

  const { action, p_token, p_path } = body || {};
  if (!p_token || !p_path || !PATH_PATTERN.test(String(p_path))) {
    return json({ error: 'Parámetros inválidos.' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Misma validación que _staff_session/_cliente_session en SQL, pero
  // consultando db_sessions directo con service_role (que salta el RLS
  // "using (false)" de esa tabla -- por eso esto solo puede correr acá,
  // nunca desde el navegador con la anon key).
  const { data: session, error: sessionErr } = await admin
    .from('db_sessions')
    .select('subject_type, expires_at')
    .eq('token', p_token)
    .maybeSingle();

  if (sessionErr || !session || new Date(session.expires_at).getTime() < Date.now()) {
    return json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' }, 401);
  }

  if (action === 'upload-url') {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(p_path, { upsert: true });
    if (error || !data) return json({ error: error?.message || 'No se pudo generar la URL de subida.' }, 500);
    return json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
  }

  if (action === 'remove') {
    const { error } = await admin.storage.from(BUCKET).remove([String(p_path)]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Acción no reconocida (usar "upload-url" o "remove").' }, 400);
});

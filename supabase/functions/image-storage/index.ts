// supabase-functions/image-storage/index.ts Cierra el hueco de seguridad documentado en…

import { createClient } from 'npm:@supabase/supabase-js@2';

const PUBLIC_BUCKET = 'app-images';
// Comprobantes de pago y fotos de entrega llevan datos de personas (nombre, monto, la puerta de una
// casa): viven en un bucket privado y el navegador solo los ve con URLs firmadas que duran minutos.
const PRIVATE_BUCKET = 'app-docs';
const PRIVATE_FOLDERS = ['comprobantes', 'delivery-proof'];

// folder/nombre-de-archivo.ext -- mismo formato que arma imageUpload.js…
const PATH_PATTERN = /^[a-z0-9_-]+\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$/;

// Los archivos subidos antes del cambio siguen en app-images, así que el bucket se decide primero por
// la carpeta y después por dónde existe realmente el objeto.
function bucketByFolder(folder: string) {
  return PRIVATE_FOLDERS.includes(folder) ? PRIVATE_BUCKET : PUBLIC_BUCKET;
}

async function findBucket(admin: any, path: string) {
  const order = [bucketByFolder(path.split('/')[0])];
  const other = order[0] === PRIVATE_BUCKET ? PUBLIC_BUCKET : PRIVATE_BUCKET;
  if (!order.includes(other)) order.push(other);
  for (const bucket of order) {
    const { error } = await admin.storage.from(bucket).info(path);
    if (!error) return bucket;
  }
  return null;
}

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
  } catch {
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

  // Misma validación que _staff_session/_cliente_session en SQL, pero consultando db_sessions…
  const { data: session, error: sessionErr } = await admin
    .from('db_sessions')
    .select('subject_type, subject_id, role, expires_at')
    .eq('token', p_token)
    .maybeSingle();

  if (sessionErr || !session || new Date(session.expires_at).getTime() < Date.now()) {
    return json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' }, 401);
  }

  const folder = String(p_path).split('/')[0];
  const KNOWN_FOLDERS = ['branding', 'users', 'drivers', 'plans', 'item-icons', 'delivery-proof', 'comprobantes', 'menu'];
  if (!KNOWN_FOLDERS.includes(folder)) {
    return json({ error: 'Carpeta no permitida.' }, 403);
  }

  if (session.subject_type === 'cliente') {
    // Un cliente solo puede tocar SU PROPIO comprobante de pago -- nunca el logo, fotos de…
    const ownPrefix = `comprobantes/${session.subject_id}_`;
    if (folder !== 'comprobantes' || !String(p_path).startsWith(ownPrefix)) {
      return json({ error: 'No tienes permiso para tocar ese archivo.' }, 403);
    }
  } else {
    // subject_type === 'staff' "branding" (logo/QR/banner): solo admin / superadmin
    const role = String(session.role || '');
    const isAdminRole = ['admin', 'superadmin'].includes(role);
    if ((folder === 'branding' || folder === 'users') && !isAdminRole) {
      return json({ error: 'Solo un administrador puede modificar esto.' }, 403);
    }
    if (role === 'driver' && folder !== 'delivery-proof') {
      return json({ error: 'Tu rol no puede tocar ese archivo.' }, 403);
    }
    if (role === 'kitchen' && folder !== 'item-icons') {
      return json({ error: 'Tu rol no puede tocar ese archivo.' }, 403);
    }
  }

  if (action === 'upload-url') {
    const { data, error } = await admin.storage.from(bucketByFolder(folder)).createSignedUploadUrl(p_path, { upsert: true });
    if (error || !data) return json({ error: error?.message || 'No se pudo generar la URL de subida.' }, 500);
    return json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
  }

  // Devuelve una URL temporal para ver un archivo del bucket privado. Se firma acá con service_role
  // porque la única alternativa sería exponer el bucket, que es justo lo que se quiere evitar.
  if (action === 'sign-url') {
    const bucket = await findBucket(admin, String(p_path));
    if (!bucket) return json({ error: 'El archivo no existe.' }, 404);
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(String(p_path), 900);
    if (error || !data?.signedUrl) return json({ error: error?.message || 'No se pudo generar la URL.' }, 500);
    return json({ url: data.signedUrl, expiresIn: 900 });
  }

  if (action === 'remove') {
    const bucket = (await findBucket(admin, String(p_path))) ?? bucketByFolder(folder);
    const { error } = await admin.storage.from(bucket).remove([String(p_path)]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Acción no reconocida (usar "upload-url", "sign-url" o "remove").' }, 400);
});

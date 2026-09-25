// Cierre automático del día operativo (lo llama pg_cron cada hora; solo actúa a las 22:00 de la empresa).
// Body opcional: { "dryRun": true } calcula qué haría sin guardar nada.
// Deploy: supabase functions deploy cerrar-dia-automatico --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cerrarDiaAutomatico } from './logic.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // El secreto vive en la base (db_secretos_internos), no en variables de la función
  const { data: secreto } = await admin.from('db_secretos_internos').select('valor').eq('clave', 'cron_secret').maybeSingle();
  const enviado = req.headers.get('x-cron-secret');
  if (!secreto?.valor || enviado !== secreto.valor) return json({ error: 'No autorizado.' }, 401);

  let body: { dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* sin body */ }

  try {
    return json(await cerrarDiaAutomatico(admin, { dryRun: body.dryRun === true }));
  } catch (err) {
    console.error('[cerrar-dia-automatico]', err);
    return json({ estado: 'error', motivo: String((err as Error)?.message || err) }, 500);
  }
});

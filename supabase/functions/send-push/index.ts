// supabase/functions/send-push/index.ts
//
// Envía notificaciones push a clientes. Dos formas de llegar acá:
//
//   1) Botón manual del Panel (página Publicidad, solo admin/editor/
//      superadmin): { action: 'manual', p_token, clientIds: string[],
//      title, body } -- p_token es el mismo token de sesión de staff que
//      ya usan todas las RPCs de la app; se valida acá con la
//      service_role key exactamente igual que hace image-storage/index.ts
//      (ver ese archivo para el porqué: esta app nunca usa Supabase Auth,
//      así que la validación de "quién sos" tiene que pasar del lado del
//      servidor, no de RLS).
//
//   2) El cron diario de las 9 AM (ver install/supabase-push-notifications-
//      migration.sql, al final): { action: 'cron' }, con el header
//      x-cron-secret en vez de un token de persona -- pg_cron no tiene
//      una sesión de nadie, así que se autentica con un secreto propio.
//      Ese modo busca solos los clientes a 1-3 días de que se les venza
//      el plan (get_clients_for_push_reminder) y usa el texto que se
//      cargó en Publicidad (settings.pushReminderText), o un texto por
//      defecto si todavía no se cargó ninguno.
//
// Variables de entorno que hay que configurar a mano (Dashboard → Edge
// Functions → send-push → Secrets, o `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  -- ver el mensaje de entrega de
//     esta funcionalidad, ahí te paso un par ya generado para arrancar.
//   VAPID_SUBJECT   -- ej. 'mailto:tuemail@tuempresa.com' (lo pide el
//     estándar Web Push, algunos servicios lo usan para contactarte si
//     tu app manda spam -- poné un mail real que revises).
//   CRON_SECRET     -- el mismo valor que pusiste en el bloque
//     `net.http_post` del cron en el SQL de la migración.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles solas en
// todo proyecto de Supabase, no hace falta configurarlas.
//
// Deploy (sin verificación de JWT de Supabase Auth, igual que las demás
// funciones de este proyecto -- la validación es la propia de arriba):
//   supabase functions deploy send-push --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const DEFAULT_REMINDER_TEXT = 'Tu plan está por vencer en pocos días. ¡Renueva para no quedarte sin tu catering!';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@example.com';
  if (!vapidPublic || !vapidPrivate) {
    return json({ error: 'Faltan configurar VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY como secretos de esta función.' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Body inválido, se esperaba JSON.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let targets: { client_id: string; name?: string }[] = [];
  let title = '';
  let messageBody = '';

  if (body.action === 'cron') {
    const secret = req.headers.get('x-cron-secret');
    if (!secret || secret !== Deno.env.get('CRON_SECRET')) {
      return json({ error: 'No autorizado.' }, 401);
    }

    const { data: reminderClients, error: reminderErr } = await admin.rpc('get_clients_for_push_reminder', { p_max_days: 3 });
    if (reminderErr) return json({ error: reminderErr.message }, 500);
    targets = reminderClients || [];

    const { data: settingsRow } = await admin.from('db_personal').select('payload').eq('id', 'settings').maybeSingle();
    title = settingsRow?.payload?.companyName ? `${settingsRow.payload.companyName} · Recordatorio` : 'Recordatorio de tu plan';
    messageBody = settingsRow?.payload?.pushReminderText || DEFAULT_REMINDER_TEXT;
  } else if (body.action === 'manual') {
    const { p_token, clientIds, title: manualTitle, body: manualBody } = body;
    if (!p_token || !Array.isArray(clientIds) || !clientIds.length || !manualTitle || !manualBody) {
      return json({ error: 'Parámetros inválidos (faltan p_token, clientIds, title o body).' }, 400);
    }

    // Misma validación que _staff_session en SQL, pero con service_role
    // (que salta el RLS "using (false)" de db_sessions) -- ver el mismo
    // patrón comentado en supabase/functions/image-storage/index.ts.
    const { data: session, error: sessionErr } = await admin
      .from('db_sessions')
      .select('subject_type, role, expires_at')
      .eq('token', p_token)
      .maybeSingle();
    if (sessionErr || !session || session.subject_type !== 'staff' || new Date(session.expires_at).getTime() < Date.now()) {
      return json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' }, 401);
    }
    if (!['admin', 'editor', 'superadmin'].includes(session.role)) {
      return json({ error: 'No tenés permiso para enviar notificaciones.' }, 403);
    }

    targets = clientIds.map((id: string) => ({ client_id: id }));
    title = manualTitle;
    messageBody = manualBody;
  } else {
    return json({ error: 'Acción no reconocida (usar "manual" o "cron").' }, 400);
  }

  if (!targets.length) {
    return json({ ok: true, sent: 0, failed: 0, note: 'No había clientes que cumplan el filtro.' });
  }

  const clientIdList = targets.map((t) => t.client_id);
  const { data: subs, error: subsErr } = await admin
    .from('db_push_subscriptions')
    .select('id, client_id, endpoint, p256dh, auth')
    .in('client_id', clientIdList);
  if (subsErr) return json({ error: subsErr.message }, 500);

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];
  const payload = JSON.stringify({ title, body: messageBody });

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err: any) {
        failed++;
        // 404/410 = el navegador/OS invalidó esa suscripción (app
        // desinstalada, permiso revocado, etc.) -- se borra para no
        // seguir intentando en vano cada vez que se manda algo.
        if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
      }
    }),
  );

  if (staleIds.length) {
    await admin.from('db_push_subscriptions').delete().in('id', staleIds);
  }

  return json({ ok: true, targeted: targets.length, subscriptionsFound: (subs || []).length, sent, failed, removedStale: staleIds.length });
});

// supabase/functions/send-push/index.ts Envía notificaciones push a clientes

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Textos que genera el servidor (los del envío manual los escribe el admin, no se traducen).
// El idioma sale de la configuración de la empresa (db_personal.settings.language), igual que en la app.
const PUSH_TEXT = {
  es: {
    reminderTitle: 'Recordatorio de tu plan',
    reminderTitleWithBrand: '{brand} · Recordatorio',
    reminderBody: 'Tu plan está por vencer en pocos días. ¡Renueva para no quedarte sin tu catering!',
    noteTitleWithName: 'Nota de {name}',
    noteTitle: 'Nota nueva desde el portal',
    noteBody: 'Un cliente escribió desde su portal.',
  },
  en: {
    reminderTitle: 'Reminder about your plan',
    reminderTitleWithBrand: '{brand} · Reminder',
    reminderBody: 'Your plan expires in a few days. Renew it so you don\'t run out of your catering!',
    noteTitleWithName: 'Note from {name}',
    noteTitle: 'New note from the portal',
    noteBody: 'A client wrote from their portal.',
  },
  pt: {
    reminderTitle: 'Lembrete do seu plano',
    reminderTitleWithBrand: '{brand} · Lembrete',
    reminderBody: 'Seu plano vence em poucos dias. Renove para não ficar sem o seu catering!',
    noteTitleWithName: 'Nota de {name}',
    noteTitle: 'Nova nota do portal',
    noteBody: 'Um cliente escreveu pelo portal.',
  },
} as const;

type PushLang = keyof typeof PUSH_TEXT;

function pushText(language: unknown): typeof PUSH_TEXT[PushLang] {
  const code = String(language || '').slice(0, 2).toLowerCase();
  return PUSH_TEXT[code as PushLang] || PUSH_TEXT.es;
}

// `web-push` exige las claves VAPID en Base64 URL-safe (sin '+', '/' ni '=' de relleno)
function toUrlSafeBase64(key: string): string {
  return key.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// En el texto del recordatorio automático se puede usar {nombre} (primer nombre del cliente)
// y {dias} (días de plan que le quedan).
function personalize(text: string, info?: { name?: string; remaining?: number }): string {
  if (!info) return text;
  const firstName = String(info.name || '').trim().split(/\s+/)[0] || '';
  return text.replace(/\{nombre\}/gi, firstName).replace(/\{dias\}/gi, info.remaining == null ? '' : String(info.remaining)).replace(/\s{2,}/g, ' ').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const vapidPublicRaw = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateRaw = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@example.com';
  if (!vapidPublicRaw || !vapidPrivateRaw) {
    return json({ error: 'Faltan configurar VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY como secretos de esta función.' }, 500);
  }
  try {
    webpush.setVapidDetails(vapidSubject, toUrlSafeBase64(vapidPublicRaw), toUrlSafeBase64(vapidPrivateRaw));
  } catch (err: any) {
    return json({ error: `Claves VAPID inválidas: ${err?.message || err}. Revisa VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en los secretos de la Edge Function.` }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body inválido, se esperaba JSON.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let targets: { client_id: string; name?: string; remaining?: number }[] = [];
  let title = '';
  let messageBody = '';
  let sendToAllSubscribed = false;

  if (body.action === 'cron') {
    const secret = req.headers.get('x-cron-secret');
    // Vale el CRON_SECRET de la función (empresas que ya lo tenían) o el secreto que se genera solo en la base
    let autorizado = !!secret && secret === Deno.env.get('CRON_SECRET');
    if (!autorizado && secret) {
      const { data: interno } = await admin.from('db_secretos_internos').select('valor').eq('clave', 'cron_secret').maybeSingle();
      autorizado = !!interno?.valor && secret === interno.valor;
    }
    if (!autorizado) {
      return json({ error: 'No autorizado.' }, 401);
    }

    // A quién le toca lo define la configuración del Panel (Publicidad → Recordatorio automático).
    let reminderClients: any[] | null;
    const configured = await admin.rpc('get_push_reminder_targets');
    if (configured.error) {
      // Base todavía sin el SQL nuevo: criterio de antes (activos con 1 a 3 días de plan)
      const legacy = await admin.rpc('get_clients_for_push_reminder', { p_max_days: 3 });
      if (legacy.error) return json({ error: legacy.error.message }, 500);
      reminderClients = legacy.data;
    } else {
      reminderClients = configured.data;
    }
    targets = reminderClients || [];
    if (body.dryRun === true) return json({ ok: true, dryRun: true, destinatarios: targets.length }); // prueba: cuenta a quiénes les tocaría, sin enviar nada

    const { data: settingsRow } = await admin.from('db_personal').select('payload').eq('id', 'settings').maybeSingle();
    const txt = pushText(settingsRow?.payload?.language);
    const brand = settingsRow?.payload?.companyName;
    title = brand ? txt.reminderTitleWithBrand.replace('{brand}', brand) : txt.reminderTitle;
    messageBody = settingsRow?.payload?.pushReminderText || txt.reminderBody;
  } else if (body.action === 'manual') {
    const { p_token, clientIds, allSubscribed, title: manualTitle, body: manualBody } = body;
    const hasClientList = Array.isArray(clientIds) && clientIds.length > 0;
    if (!p_token || !manualTitle || !manualBody || (!allSubscribed && !hasClientList)) {
      return json({ error: 'Parámetros inválidos (faltan p_token, clientIds, title o body).' }, 400);
    }
    if (typeof manualTitle !== 'string' || typeof manualBody !== 'string' || manualTitle.length > 80 || manualBody.length > 300) {
      return json({ error: 'El título (máx. 80) o el mensaje (máx. 300 caracteres) es demasiado largo.' }, 400);
    }
    if (hasClientList && (clientIds.length > 5000 || clientIds.some((id: unknown) => typeof id !== 'string'))) {
      return json({ error: 'Lista de clientes inválida.' }, 400);
    }

    // Misma validación que _staff_session en SQL, pero con service_role (que salta el RLS…
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

    // Avisos manuales = función Premium. El candado vive en SQL (plan_blocks_page) para que
    // no dependa de que el panel muestre o no el botón.
    if (session.role !== 'superadmin') {
      const { data: blockedByPlan, error: blockedErr } = await admin.rpc('plan_blocks_page', { p_page: 'manualPush' });
      if (blockedErr) return json({ error: blockedErr.message }, 500);
      if (blockedByPlan) return json({ error: 'Las notificaciones manuales son una función del plan Premium.' }, 403);
    }

    sendToAllSubscribed = !!allSubscribed;
    if (!sendToAllSubscribed) {
      targets = clientIds.map((id: string) => ({ client_id: id }));
    }
    title = manualTitle;
    messageBody = manualBody;
  } else if (body.action === 'staff-note') {
    // Lo llama crear_nota_cliente (SQL) vía net.http_post cuando un cliente escribe desde su
    // portal. Mismo secreto que la acción 'cron': nadie externo puede disparar avisos falsos.
    const secret = req.headers.get('x-cron-secret');
    let autorizado = !!secret && secret === Deno.env.get('CRON_SECRET');
    if (!autorizado && secret) {
      const { data: interno } = await admin.from('db_secretos_internos').select('valor').eq('clave', 'cron_secret').maybeSingle();
      autorizado = !!interno?.valor && secret === interno.valor;
    }
    if (!autorizado) return json({ error: 'No autorizado.' }, 401);

    const clientName = String(body.clientName || '').trim();
    const texto = String(body.texto || '').trim();
    const preview = texto.length > 140 ? `${texto.slice(0, 140)}…` : texto;

    // El aviso al staff también sigue el idioma de la empresa
    const { data: settingsNota } = await admin.from('db_personal').select('payload').eq('id', 'settings').maybeSingle();
    const txtNota = pushText(settingsNota?.payload?.language);

    const { data: staffSubs, error: staffErr } = await admin
      .from('db_staff_push_subscriptions')
      .select('id, endpoint, p256dh, auth');
    if (staffErr) return json({ error: staffErr.message }, 500);
    if (!staffSubs?.length) return json({ ok: true, sent: 0, failed: 0, note: 'Ningún editor/administrador suscrito todavía.' });

    let sent = 0;
    let failed = 0;
    const staleIds: string[] = [];
    await Promise.all(
      staffSubs.map(async (sub) => {
        try {
          const payload = JSON.stringify({
            title: clientName ? txtNota.noteTitleWithName.replace('{name}', clientName) : txtNota.noteTitle,
            body: preview || txtNota.noteBody,
            tag: 'catering-nota-cliente',
            url: '/panel',
          });
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err: any) {
          failed++;
          if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
        }
      }),
    );
    if (staleIds.length) await admin.from('db_staff_push_subscriptions').delete().in('id', staleIds);
    return json({ ok: true, sent, failed, removedStale: staleIds.length });
  } else {
    return json({ error: 'Acción no reconocida (usar "manual" o "cron").' }, 400);
  }

  if (!sendToAllSubscribed && !targets.length) {
    return json({ ok: true, sent: 0, failed: 0, note: 'No había clientes que cumplan el filtro.' });
  }

  let subs: { id: string; client_id: string; endpoint: string; p256dh: string; auth: string }[] | null;
  let subsErr: any;
  if (sendToAllSubscribed) {
    // Sin filtro por cliente a propósito: llega a cualquier dispositivo con suscripción…
    ({ data: subs, error: subsErr } = await admin
      .from('db_push_subscriptions')
      .select('id, client_id, endpoint, p256dh, auth'));
  } else {
    const clientIdList = targets.map((t) => t.client_id);
    ({ data: subs, error: subsErr } = await admin
      .from('db_push_subscriptions')
      .select('id, client_id, endpoint, p256dh, auth')
      .in('client_id', clientIdList));
  }
  if (subsErr) return json({ error: subsErr.message }, 500);

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];
  const targetInfo = new Map(targets.map((t) => [t.client_id, t]));

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        const info = targetInfo.get(sub.client_id);
        const payload = JSON.stringify({ title: personalize(title, info), body: personalize(messageBody, info) });
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err: any) {
        failed++;
        // 404/410 = el navegador/OS invalidó esa suscripción (app desinstalada, permiso revocado…
        if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
      }
    }),
  );

  if (staleIds.length) {
    await admin.from('db_push_subscriptions').delete().in('id', staleIds);
  }

  return json({
    ok: true,
    targeted: sendToAllSubscribed ? (subs || []).length : targets.length,
    subscriptionsFound: (subs || []).length,
    sent,
    failed,
    removedStale: staleIds.length,
  });
});

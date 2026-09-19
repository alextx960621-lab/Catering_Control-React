-- =============================================================================
-- MIGRACIÓN: Notificaciones push (recordatorio de plan)
-- =============================================================================
-- Corré esto UNA VEZ en el SQL Editor de tu proyecto de Supabase. Es seguro
-- volver a correrlo.
--
-- Qué hace:
--   · Extensiones pg_cron y pg_net (para el envío automático diario). Si el
--     "create extension" de acá abajo te da error de permisos, andá a
--     Dashboard → Database → Extensions y activá "pg_cron" y "pg_net" a
--     mano, después segui corriendo el resto de este archivo.
--   · Tabla db_push_subscriptions: una fila por dispositivo suscripto
--     (un cliente puede tener varias, ej. celular + tablet).
--   · save_push_subscription / remove_push_subscription: las llama el
--     propio cliente desde el portal (autenticado con su token de
--     sesión, igual que el resto de sus RPCs).
--   · get_clients_for_push_reminder(): usada SOLO por la Edge Function
--     `send-push` (con la service_role key) para el cron diario -- no es
--     alcanzable con la anon key.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.db_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_client on public.db_push_subscriptions(client_id);

alter table public.db_push_subscriptions enable row level security;
drop policy if exists "no direct access push subscriptions" on public.db_push_subscriptions;
create policy "no direct access push subscriptions" on public.db_push_subscriptions for all using (false) with check (false);

create or replace function public.save_push_subscription(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_client_id text;
begin
  select subject_id into v_client_id from public._cliente_session(p_token);

  insert into public.db_push_subscriptions (client_id, endpoint, p256dh, auth)
  values (v_client_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set client_id = excluded.client_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to anon, authenticated;

create or replace function public.remove_push_subscription(p_token text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_client_id text;
begin
  select subject_id into v_client_id from public._cliente_session(p_token);
  delete from public.db_push_subscriptions where endpoint = p_endpoint and client_id = v_client_id;
end;
$$;
revoke all on function public.remove_push_subscription(text, text) from public;
grant execute on function public.remove_push_subscription(text, text) to anon, authenticated;

-- "Últimos 3 días del plan": remaining = paidDays - consumedDays, el
-- mismo cálculo que usa el portal del cliente (ver Portal.jsx,
-- `remaining = max(0, paidDays - consumedDays)`) -- así el cron nunca
-- avisa algo distinto de lo que el cliente ve en su propia pantalla.
-- Solo clientes 'Activo' (no tiene sentido avisarle a uno pausado).
create or replace function public.get_clients_for_push_reminder(p_max_days int default 3)
returns table(client_id text, name text, remaining int)
language sql
security definer
set search_path = public, extensions
as $$
  select
    id,
    payload ->> 'name',
    greatest(0, coalesce((payload ->> 'paidDays')::int, 0) - coalesce((payload ->> 'consumedDays')::int, 0))
  from public.db_clientes_rows
  where coalesce(payload ->> 'status', 'Activo') = 'Activo'
    and greatest(0, coalesce((payload ->> 'paidDays')::int, 0) - coalesce((payload ->> 'consumedDays')::int, 0))
        between 1 and greatest(1, p_max_days);
$$;
revoke all on function public.get_clients_for_push_reminder(int) from public;
grant execute on function public.get_clients_for_push_reminder(int) to service_role;

-- --------------------------------------------------------------------------
-- Cron diario, 9:00 AM hora Bolivia (America/La_Paz = UTC-4 todo el año,
-- sin horario de verano, así que 09:00 La Paz = 13:00 UTC siempre). Si
-- esta empresa opera en otro huso horario, cambiá el "13" de acá abajo.
--
-- OJO: reemplazá <CRON_SECRET> por el mismo valor que vas a guardar como
-- secreto CRON_SECRET de la Edge Function `send-push` (ver
-- supabase/functions/send-push/index.ts) antes de correr este bloque. El
-- valor de ejemplo generado para vos al armar esta entrega fue:
--   0c1c6a7d214b311755bcb39900c49496feb4268c314de754
-- (podés usar ese mismo o generar otro con `openssl rand -hex 24`).
-- --------------------------------------------------------------------------
select cron.schedule(
  'push-recordatorio-plan-diario',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://kkqcaiunetlikfyaldab.functions.supabase.co/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := jsonb_build_object('action', 'cron')
  );
  $$
);

-- Para revisar que el cron esté programado: select * from cron.job;
-- Para borrarlo si hace falta: select cron.unschedule('push-recordatorio-plan-diario');

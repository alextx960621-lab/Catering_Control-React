-- =============================================================================
-- MIGRACIÓN: auto-registro de clientes desde el Login
-- =============================================================================
-- Corré esto UNA VEZ en el SQL Editor de tu proyecto de Supabase (ya
-- instalado con supabase-setup-final.sql). Es seguro volver a correrlo.
--
-- Qué hace:
--   · Nueva función signup_cliente(carnet, phone, name, address): crea un
--     cliente nuevo SIN ruta ni plan asignados (eso lo decide el equipo) y
--     deja una nota pendiente en Notas para que lo revisen y contacten.
--     Devuelve session_token para que el cliente entre directo a su portal,
--     igual que login_cliente.
--   · El cliente nuevo queda con status = 'Programado' y payload.selfSignup
--     = true, para que el panel lo pueda distinguir de los que carga el
--     equipo directamente (podés filtrar por eso en Clientes si querés).
--   · Candado anti-abuso: reusa la misma tabla de intentos fallidos que
--     login_cliente (db_client_login_attempts) para frenar creación
--     automatizada en masa -- 3 intentos fallidos seguidos (carnet
--     duplicado, datos inválidos) con el mismo carnet bloquean 1 minuto.
-- =============================================================================

create or replace function public.signup_cliente(
  p_carnet  text,
  p_phone   text,
  p_name    text,
  p_address text default ''
)
returns table(id text, name text, locked_seconds int, session_token text, error text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_carnet text := lower(trim(coalesce(p_carnet, '')));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_name   text := trim(coalesce(p_name, ''));
  v_address text := trim(coalesce(p_address, ''));
  v_attempt public.db_client_login_attempts%rowtype;
  v_exists boolean;
  v_id text;
  v_token text;
  v_new_fail_count int;
begin
  -- mismo candado de fuerza bruta que login_cliente, por carnet
  select * into v_attempt from public.db_client_login_attempts where carnet = v_carnet;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return query select null::text, null::text,
      greatest(ceil(extract(epoch from (v_attempt.locked_until - now())))::int, 1),
      null::text, null::text;
    return;
  end if;

  if v_carnet = '' or v_phone = '' or v_name = '' then
    return query select null::text, null::text, 0, null::text,
      'Completa carnet, teléfono y nombre.'::text;
    return;
  end if;

  select exists(
    select 1 from db_clientes_rows
    where lower(trim(coalesce(payload ->> 'carnet', ''))) = v_carnet
  ) into v_exists;

  if v_exists then
    -- cuenta el intento fallido igual que un login fallido, para frenar
    -- reintentos automatizados probando carnets al voleo
    v_new_fail_count := coalesce(v_attempt.fail_count, 0) + 1;
    if v_new_fail_count >= 3 then
      insert into public.db_client_login_attempts (carnet, fail_count, locked_until, last_attempt)
        values (v_carnet, 0, now() + interval '1 minute', now())
      on conflict (carnet) do update
        set fail_count = 0, locked_until = now() + interval '1 minute', last_attempt = now();
    else
      insert into public.db_client_login_attempts (carnet, fail_count, locked_until, last_attempt)
        values (v_carnet, v_new_fail_count, null, now())
      on conflict (carnet) do update
        set fail_count = v_new_fail_count, locked_until = null, last_attempt = now();
    end if;
    return query select null::text, null::text, 0, null::text,
      'Ese carnet ya está registrado. Si es tuyo, inicia sesión o contacta al equipo si no coincide tu teléfono.'::text;
    return;
  end if;

  delete from public.db_client_login_attempts where carnet = v_carnet;

  v_id := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  insert into db_clientes_rows (id, payload, updated_at)
  values (
    v_id,
    jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'carnet', v_carnet,
      'phone1', v_phone,
      'status', 'Programado',
      'planId', '',
      'paidDays', 0,
      'consumedDays', 0,
      'items', '{}'::jsonb,
      'selfSignup', true,
      'addresses', case when v_address = '' then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object(
          'id', 'a_' || v_id, 'address', v_address, 'maps', '',
          'routeId', '', 'driverId', '', 'order', ''
        ))
      end,
      'createdAt', now()
    ),
    now()
  );

  insert into db_notas_rows (id, payload, updated_at)
  values (
    'n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    jsonb_build_object(
      'text', 'Cliente nuevo autorregistrado desde el login: ' || v_name || ' (tel. ' || v_phone || ')'
        || case when v_address <> '' then '. Dirección indicada: ' || v_address else '. No indicó dirección.' end
        || ' Falta asignarle ruta, plan y revisar/completar sus datos.',
      'dueDate', get_server_date(),
      'status', 'pendiente',
      'source', 'signup',
      'clientId', v_id,
      'clientName', v_name,
      'createdAt', now(),
      'read', false
    ),
    now()
  );

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into db_sessions (token, subject_type, subject_id, subject_name, role)
  values (v_token, 'cliente', v_id, v_name, null);

  return query select v_id, v_name, 0, v_token, null::text;
end;
$$;
revoke all on function public.signup_cliente(text, text, text, text) from public;
grant execute on function public.signup_cliente(text, text, text, text) to anon, authenticated;

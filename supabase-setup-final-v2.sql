-- =============================================================================
-- CATERING CONTROL · SQL SETUP FINAL — empresa nueva, un solo archivo
-- =============================================================================
-- v2 (revisión posterior a la entrega original): se agregaron 3 secciones
-- nuevas al final, sección 14, 15 y 16, todas seguras de correr encima de
-- un proyecto que ya corrió la v1 de este mismo script (usan CREATE OR
-- REPLACE / ON CONFLICT / DROP POLICY IF EXISTS, no tocan ni borran nada
-- existente que no sea justamente lo que reemplazan):
--   · 14. Políticas de Realtime Authorization para el canal de presencia
--     ("Conectados ahora") -- hipótesis de causa del bug reportado donde
--     siempre marca 0 (ver PROMPT_CONTINUAR.md, pendiente #1).
--   · 15. Preferencias personales por cuenta (tema visual + orden de
--     columnas de tablas) para que viajen entre dispositivos, no solo se
--     queden en el navegador (ver PROMPT_CONTINUAR.md, pendiente #7).
--   · 16. Cierre del bucket "app-images": saca a `anon` los permisos
--     directos de subir/reemplazar/borrar (dejando solo la lectura
--     pública). A partir de esta sección, subir o borrar una imagen SOLO
--     funciona a través de la Edge Function `image-storage`
--     (supabase-functions/image-storage/index.ts) -- **hay que
--     desplegarla ANTES de correr esta sección**, o se rompe la subida de
--     imágenes en producción (ver PROMPT_CONTINUAR.md, pendiente #7).
-- Si ya corriste la v1 completa, alcanza con correr SOLO las secciones 14,
-- 15 y 16 (podés copiarlas y pegarlas solas en el SQL Editor); si es un
-- proyecto nuevo, corré el archivo entero de punta a punta como siempre.
-- =============================================================================
-- Correr UNA VEZ, completo, en el SQL Editor de un proyecto de Supabase
-- NUEVO (recién creado, vacío). Reemplaza a correr en cadena:
--   supabase-setup-completo.sql + supabase-storage-setup.sql +
--   supabase-security-lockdown.sql + supabase-login-cliente-lockout-migration.sql
--   + el fix de get_branding/get_plan_status/login_staff
-- ya con todo integrado y sin el paso intermedio de "dejarlo abierto y
-- después cerrarlo" -- para una empresa nueva no tiene sentido pasar por
-- ahí, arranca cerrado directo.
--
-- Es seguro volver a correrlo si algo falla a mitad de camino (todo usa
-- IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- Incluye:
--   · Todas las tablas de datos + tabla de sesiones (db_sessions) + las dos
--     tablas de bloqueo por fuerza bruta (staff y cliente)
--   · RLS cerrado desde el arranque en TODAS las tablas (using(false)) --
--     nada se lee/escribe/borra por REST directo con la anon key, todo pasa
--     por las funciones de abajo, que validan sesión antes de tocar nada
--   · login_staff / login_cliente con candado de fuerza bruta (3 intentos,
--     1 minuto) Y emisión de token de sesión de 256 bits
--   · ~35 funciones RPC (staff_*, cliente_*) que reemplazan el acceso
--     directo a tablas, cada una validando el token contra db_sessions
--   · 3 operaciones admin-exclusivas (gestionar cuentas de staff, restaurar
--     backups de auditoría/snapshots) con chequeo de rol server-side
--   · Bucket de Storage para imágenes (logo, fotos, íconos)
--   · Limpieza automática con pg_cron (delivery_status 7d, snapshots 2 años,
--     audit_log 15 días, intentos de login 1 día, FOTOS reales del bucket
--     de Storage —de pedidos y comprobantes de pago— a los 7 días, y
--     clientes inactivos (sin ninguna edición/proceso hace más de 2 años) a
--     los 2 años)
--
-- NO incluido a propósito (lleva un dato tuyo, va aparte):
--   · Poner la contraseña real del primer admin -- por defecto, hasta que
--     cargues el primer usuario en Personal, el login de arranque es
--     admin@catering.local / admin123. CAMBIALO apenas puedas: entrá con
--     esa cuenta, andá a Personal → Usuarios, creá tu admin real, y esa
--     cuenta de arranque deja de funcionar sola (login_staff solo la usa
--     mientras no exista NINGÚN staffUser cargado).
--   · supabase-promote-superadmin.sql, si necesitás un rol Super Admin
--     aparte del admin normal.
--
-- Pendiente conocido, fuera de alcance de este script (ver
-- vulnerabilidades-2026-09-04.md): el bucket de Storage sigue con
-- subir/reemplazar/borrar abiertos a la anon key -- riesgo menor
-- (imágenes, no datos de clientes ni contraseñas), pendiente para más
-- adelante.
--
-- Después de correrlo: copiá la URL y la "publishable key" del proyecto
-- (Project Settings → API) a config.js (supabaseUrl / supabaseKey).
-- =============================================================================

set search_path = public, extensions;

-- --------------------------------------------------------------------------
-- 1. Extensiones necesarias
-- --------------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists pg_cron;  -- si da error de permisos, activala
                                          -- desde Database → Extensions → pg_cron

-- --------------------------------------------------------------------------
-- 2. Tablas
-- --------------------------------------------------------------------------

create table if not exists db_clientes (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists db_clientes_rows (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists db_personal (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists db_inventario (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists db_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id text,
  actor_name text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_label text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.db_delivery_status (
  id          text primary key,
  date        date not null,
  client_id   text not null,
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.db_dispatch_snapshots (
  date       date primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists db_notas_rows (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.db_login_attempts (
  email text primary key,
  fail_count int not null default 0,
  locked_until timestamptz,
  last_attempt timestamptz not null default now()
);

create table if not exists public.db_client_login_attempts (
  carnet       text primary key,
  fail_count   int not null default 0,
  locked_until timestamptz,
  last_attempt timestamptz not null default now()
);

create table if not exists public.db_sessions (
  token         text primary key,
  subject_type  text not null check (subject_type in ('staff','cliente')),
  subject_id    text not null,
  subject_name  text,
  role          text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);
create index if not exists db_sessions_subject_idx on public.db_sessions (subject_type, subject_id);

-- --------------------------------------------------------------------------
-- 3. Índices
-- --------------------------------------------------------------------------
create index if not exists db_audit_log_at_idx on db_audit_log (at desc);
create index if not exists db_delivery_status_date_idx on public.db_delivery_status (date);
create index if not exists db_delivery_status_client_idx on public.db_delivery_status (client_id);

-- --------------------------------------------------------------------------
-- 4. RLS cerrado desde el arranque en TODAS las tablas
-- --------------------------------------------------------------------------
alter table db_clientes                     enable row level security;
alter table db_clientes_rows                enable row level security;
alter table db_personal                     enable row level security;
alter table db_inventario                   enable row level security;
alter table db_audit_log                    enable row level security;
alter table public.db_delivery_status       enable row level security;
alter table public.db_dispatch_snapshots    enable row level security;
alter table db_notas_rows                   enable row level security;
alter table public.db_login_attempts        enable row level security;
alter table public.db_client_login_attempts enable row level security;
alter table public.db_sessions              enable row level security;

drop policy if exists "no direct access clientes" on db_clientes;
create policy "no direct access clientes" on db_clientes for all using (false) with check (false);
drop policy if exists "no direct access clientes filas" on db_clientes_rows;
create policy "no direct access clientes filas" on db_clientes_rows for all using (false) with check (false);
drop policy if exists "no direct access personal" on db_personal;
create policy "no direct access personal" on db_personal for all using (false) with check (false);
drop policy if exists "no direct access inventario" on db_inventario;
create policy "no direct access inventario" on db_inventario for all using (false) with check (false);
drop policy if exists "no direct access audit log" on db_audit_log;
create policy "no direct access audit log" on db_audit_log for all using (false) with check (false);
drop policy if exists "no direct access delivery status" on public.db_delivery_status;
create policy "no direct access delivery status" on public.db_delivery_status for all using (false) with check (false);
drop policy if exists "no direct access dispatch snapshots" on public.db_dispatch_snapshots;
create policy "no direct access dispatch snapshots" on public.db_dispatch_snapshots for all using (false) with check (false);
drop policy if exists "no direct access notas" on db_notas_rows;
create policy "no direct access notas" on db_notas_rows for all using (false) with check (false);
drop policy if exists "no public access login attempts" on public.db_login_attempts;
create policy "no public access login attempts" on public.db_login_attempts for all using (false) with check (false);
drop policy if exists "no public access client login attempts" on public.db_client_login_attempts;
create policy "no public access client login attempts" on public.db_client_login_attempts for all using (false) with check (false);
drop policy if exists "no public access sessions" on public.db_sessions;
create policy "no public access sessions" on public.db_sessions for all using (false) with check (false);

-- --------------------------------------------------------------------------
-- 5. Storage: bucket de imágenes
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('app-images', 'app-images', true)
on conflict (id) do nothing;

drop policy if exists "app-images: lectura pública" on storage.objects;
create policy "app-images: lectura pública" on storage.objects for select using (bucket_id = 'app-images');
drop policy if exists "app-images: subir" on storage.objects;
create policy "app-images: subir" on storage.objects for insert with check (bucket_id = 'app-images');
drop policy if exists "app-images: reemplazar" on storage.objects;
create policy "app-images: reemplazar" on storage.objects for update using (bucket_id = 'app-images');
drop policy if exists "app-images: borrar" on storage.objects;
create policy "app-images: borrar" on storage.objects for delete using (bucket_id = 'app-images');

-- --------------------------------------------------------------------------
-- 6. Funciones internas de validación de sesión (NO se exponen a anon)
-- --------------------------------------------------------------------------
create or replace function public._staff_session(p_token text)
returns table(subject_id text, subject_name text, role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text; v_name text; v_role text;
begin
  select s.subject_id, s.subject_name, s.role into v_id, v_name, v_role
  from db_sessions s
  where s.token = p_token and s.subject_type = 'staff' and s.expires_at > now();

  if not found then
    raise exception 'Sesión inválida o expirada. Vuelve a iniciar sesión.';
  end if;

  update db_sessions set expires_at = now() + interval '30 days' where token = p_token;
  return query select v_id, v_name, v_role;
end;
$$;
revoke all on function public._staff_session(text) from public;

create or replace function public._require_staff(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_session(p_token);
end;
$$;
revoke all on function public._require_staff(text) from public;

create or replace function public._cliente_session(p_token text)
returns table(subject_id text, subject_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text; v_name text;
begin
  select s.subject_id, s.subject_name into v_id, v_name
  from db_sessions s
  where s.token = p_token and s.subject_type = 'cliente' and s.expires_at > now();

  if not found then
    raise exception 'Sesión inválida o expirada. Vuelve a iniciar sesión.';
  end if;

  update db_sessions set expires_at = now() + interval '30 days' where token = p_token;
  return query select v_id, v_name;
end;
$$;
revoke all on function public._cliente_session(text) from public;

create or replace function public._require_cliente_owns(p_token text, p_client_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id text;
begin
  select subject_id into v_id from public._cliente_session(p_token);
  if v_id is distinct from p_client_id then
    raise exception 'No autorizado.';
  end if;
end;
$$;
revoke all on function public._require_cliente_owns(text, text) from public;

create or replace function public.revoke_session(p_token text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from db_sessions where token = p_token;
$$;
grant execute on function public.revoke_session(text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 7. hash_password / get_server_date
-- --------------------------------------------------------------------------
create or replace function hash_password(p_password text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select crypt(p_password, gen_salt('bf', 10));
$$;
revoke all on function hash_password(text) from public;
grant execute on function hash_password(text) to anon, authenticated;

create or replace function get_server_date()
returns text
language sql
security definer
stable
as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD');
$$;
grant execute on function get_server_date() to anon, authenticated;

-- --------------------------------------------------------------------------
-- 8. get_branding / get_plan_status / get_portal_catalog -- leen de
--    db_personal/db_clientes con id POR CAMPO (nunca 'main', que es legado).
-- --------------------------------------------------------------------------
create or replace function get_branding()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(payload, '{}'::jsonb)
  from db_personal
  where id = 'settings';
$$;
revoke all on function get_branding() from public;
grant execute on function get_branding() to anon, authenticated;

create or replace function public.get_plan_status()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'plan', coalesce(payload->>'plan', 'basico'),
    'clientPortalLocked', coalesce((payload->'premiumLockedPages'->>'clientPortal')::boolean, true)
  )
  from db_personal
  where id = 'settings';
$$;
revoke all on function public.get_plan_status() from public;
grant execute on function public.get_plan_status() to anon, authenticated;

create or replace function public.get_portal_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_result jsonb;
begin
  select coalesce(jsonb_object_agg(id, payload), '{}'::jsonb) into v_result
  from db_clientes where id in ('plans','days','currentDate');

  if v_result = '{}'::jsonb then
    select payload into v_result from db_clientes where id = 'main';
  end if;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;
grant execute on function public.get_portal_catalog() to anon, authenticated;

-- --------------------------------------------------------------------------
-- 9. login_cliente / login_staff -- candado de fuerza bruta + session_token.
--    staffUsers se lee de la fila 'staffUsers' (por campo), NUNCA de 'main'.
-- --------------------------------------------------------------------------
drop function if exists login_cliente(text, text);
create or replace function login_cliente(p_carnet text, p_phone text)
returns table(id text, name text, locked_seconds int, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_carnet text := lower(trim(coalesce(p_carnet, '')));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_attempt public.db_client_login_attempts%rowtype;
  v_id text; v_name text; v_token text;
  v_new_fail_count int; v_remaining int;
begin
  select * into v_attempt from public.db_client_login_attempts where carnet = v_carnet;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    v_remaining := ceil(extract(epoch from (v_attempt.locked_until - now())));
    return query select null::text, null::text, greatest(v_remaining, 1), null::text;
    return;
  end if;

  select db_clientes_rows.id, payload ->> 'name' into v_id, v_name
  from db_clientes_rows
  where lower(trim(coalesce(payload ->> 'carnet', ''))) = v_carnet
    and (
      regexp_replace(coalesce(payload ->> 'phone1', ''), '\D', '', 'g') = v_phone
      or regexp_replace(coalesce(payload ->> 'phone2', ''), '\D', '', 'g') = v_phone
    )
  limit 1;

  if v_id is not null then
    delete from public.db_client_login_attempts where carnet = v_carnet;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into db_sessions (token, subject_type, subject_id, subject_name, role)
    values (v_token, 'cliente', v_id, v_name, null);
    return query select v_id, v_name, 0, v_token;
    return;
  end if;

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

  return;
end;
$$;
revoke all on function login_cliente(text, text) from public;
grant execute on function login_cliente(text, text) to anon, authenticated;

drop function if exists login_staff(text, text);
create or replace function login_staff(p_email text, p_password text)
returns table(id text, name text, role text, "routeId" text, "driverId" text, locked_seconds int, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_users jsonb;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_attempt db_login_attempts%rowtype;
  v_new_fail_count int;
  v_remaining int;
  v_id text; v_name text; v_role text; v_routeId text; v_driverId text;
  v_token text;
begin
  select * into v_attempt from db_login_attempts where email = v_email;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    v_remaining := ceil(extract(epoch from (v_attempt.locked_until - now())));
    return query select null::text, null::text, null::text, null::text, null::text, greatest(v_remaining, 1), null::text;
    return;
  end if;

  -- staffUsers vive en su propia fila (id='staffUsers'), con el array
  -- completo como payload -- NO anidado dentro de la fila 'main'.
  select payload into v_users from db_personal where db_personal.id = 'staffUsers';
  v_users := coalesce(v_users, '[]'::jsonb);

  if jsonb_array_length(v_users) = 0 then
    if v_email = 'admin@catering.local' and p_password = 'admin123' then
      v_id := 'staff_admin'; v_name := 'Administrador'; v_role := 'admin'; v_routeId := ''; v_driverId := '';
    end if;
  else
    select u ->> 'id', u ->> 'name', u ->> 'role', u ->> 'routeId', u ->> 'driverId'
      into v_id, v_name, v_role, v_routeId, v_driverId
    from jsonb_array_elements(v_users) as u
    where lower(u ->> 'email') = v_email
      and u ->> 'passwordHash' is not null
      and crypt(p_password, u ->> 'passwordHash') = (u ->> 'passwordHash')
    limit 1;
  end if;

  if v_id is not null then
    delete from db_login_attempts where email = v_email;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into db_sessions (token, subject_type, subject_id, subject_name, role)
    values (v_token, 'staff', v_id, v_name, v_role);
    return query select v_id, v_name, v_role, v_routeId, v_driverId, 0, v_token;
    return;
  end if;

  v_new_fail_count := coalesce(v_attempt.fail_count, 0) + 1;
  if v_new_fail_count >= 3 then
    insert into db_login_attempts (email, fail_count, locked_until, last_attempt)
      values (v_email, 0, now() + interval '1 minute', now())
    on conflict (email) do update
      set fail_count = 0, locked_until = now() + interval '1 minute', last_attempt = now();
  else
    insert into db_login_attempts (email, fail_count, locked_until, last_attempt)
      values (v_email, v_new_fail_count, null, now())
    on conflict (email) do update
      set fail_count = v_new_fail_count, locked_until = null, last_attempt = now();
  end if;

  return;
end;
$$;
revoke all on function login_staff(text, text) from public;
grant execute on function login_staff(text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 10. RPCs de staff
-- --------------------------------------------------------------------------
create or replace function public.staff_get_block(p_token text, p_table_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_payload jsonb;
begin
  perform public._require_staff(p_token);
  if p_table_key = 'clientes' then
    select payload into v_payload from db_clientes where id = 'main';
  elsif p_table_key = 'personal' then
    select payload into v_payload from db_personal where id = 'main';
  elsif p_table_key = 'inventario' then
    select payload into v_payload from db_inventario where id = 'main';
  else
    raise exception 'Tabla no permitida.';
  end if;
  return v_payload;
end;
$$;
revoke all on function public.staff_get_block(text, text) from public;
grant execute on function public.staff_get_block(text, text) to anon, authenticated;

create or replace function public.staff_set_block(p_token text, p_table_key text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  if p_table_key = 'clientes' then
    insert into db_clientes (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
  elsif p_table_key = 'personal' then
    insert into db_personal (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
  elsif p_table_key = 'inventario' then
    insert into db_inventario (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
  else
    raise exception 'Tabla no permitida.';
  end if;
  return true;
end;
$$;
revoke all on function public.staff_set_block(text, text, jsonb) from public;
grant execute on function public.staff_set_block(text, text, jsonb) to anon, authenticated;

create or replace function public.staff_get_fields(p_token text, p_table_key text, p_ids text[])
returns table(id text, payload jsonb)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  if p_table_key = 'clientes' then
    return query select r.id, r.payload from db_clientes r where r.id = any(p_ids);
  elsif p_table_key = 'personal' then
    return query select r.id, r.payload from db_personal r where r.id = any(p_ids);
  elsif p_table_key = 'inventario' then
    return query select r.id, r.payload from db_inventario r where r.id = any(p_ids);
  else
    raise exception 'Tabla no permitida.';
  end if;
end;
$$;
revoke all on function public.staff_get_fields(text, text, text[]) from public;
grant execute on function public.staff_get_fields(text, text, text[]) to anon, authenticated;

create or replace function public.staff_set_fields(p_token text, p_table_key text, p_fields jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_key text; v_val jsonb; v_role text;
begin
  select role into v_role from public._staff_session(p_token);
  if p_table_key not in ('clientes','personal','inventario') then
    raise exception 'Tabla no permitida.';
  end if;
  if p_table_key='personal' and p_fields ? 'staffUsers' and v_role not in ('admin','superadmin') then
    raise exception 'Solo un administrador puede modificar las cuentas de staff.';
  end if;
  for v_key, v_val in select * from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if p_table_key = 'clientes' then
      insert into db_clientes (id, payload, updated_at) values (v_key, v_val, now())
        on conflict (id) do update set payload = excluded.payload, updated_at = now();
    elsif p_table_key = 'personal' then
      insert into db_personal (id, payload, updated_at) values (v_key, v_val, now())
        on conflict (id) do update set payload = excluded.payload, updated_at = now();
    elsif p_table_key = 'inventario' then
      insert into db_inventario (id, payload, updated_at) values (v_key, v_val, now())
        on conflict (id) do update set payload = excluded.payload, updated_at = now();
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.staff_set_fields(text, text, jsonb) from public;
grant execute on function public.staff_set_fields(text, text, jsonb) to anon, authenticated;

create or replace function public.staff_get_client_rows(p_token text)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id, r.payload from db_clientes_rows r; end; $$;
revoke all on function public.staff_get_client_rows(text) from public;
grant execute on function public.staff_get_client_rows(text) to anon, authenticated;

create or replace function public.staff_get_client_row_ids(p_token text)
returns table(id text)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id from db_clientes_rows r; end; $$;
revoke all on function public.staff_get_client_row_ids(text) from public;
grant execute on function public.staff_get_client_row_ids(text) to anon, authenticated;

create or replace function public.staff_get_client_rows_since(p_token text, p_since timestamptz)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id, r.payload from db_clientes_rows r where r.updated_at >= p_since; end; $$;
revoke all on function public.staff_get_client_rows_since(text, timestamptz) from public;
grant execute on function public.staff_get_client_rows_since(text, timestamptz) to anon, authenticated;

create or replace function public.staff_get_client_row(p_token text, p_id text)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id, r.payload from db_clientes_rows r where r.id = p_id; end; $$;
revoke all on function public.staff_get_client_row(text, text) from public;
grant execute on function public.staff_get_client_row(text, text) to anon, authenticated;

create or replace function public.staff_upsert_client_rows(p_token text, p_rows jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_row jsonb;
begin
  perform public._require_staff(p_token);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into db_clientes_rows (id, payload, updated_at) values (v_row ->> 'id', v_row, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  end loop;
  return true;
end; $$;
revoke all on function public.staff_upsert_client_rows(text, jsonb) from public;
grant execute on function public.staff_upsert_client_rows(text, jsonb) to anon, authenticated;

create or replace function public.staff_delete_client_rows(p_token text, p_ids text[])
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); delete from db_clientes_rows where id = any(p_ids); return true; end; $$;
revoke all on function public.staff_delete_client_rows(text, text[]) from public;
grant execute on function public.staff_delete_client_rows(text, text[]) to anon, authenticated;

create or replace function public.staff_get_note_rows(p_token text)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id, r.payload from db_notas_rows r; end; $$;
revoke all on function public.staff_get_note_rows(text) from public;
grant execute on function public.staff_get_note_rows(text) to anon, authenticated;

create or replace function public.staff_upsert_note_rows(p_token text, p_rows jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_row jsonb;
begin
  perform public._require_staff(p_token);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into db_notas_rows (id, payload, updated_at) values (v_row ->> 'id', v_row, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  end loop;
  return true;
end; $$;
revoke all on function public.staff_upsert_note_rows(text, jsonb) from public;
grant execute on function public.staff_upsert_note_rows(text, jsonb) to anon, authenticated;

create or replace function public.staff_delete_note_rows(p_token text, p_ids text[])
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); delete from db_notas_rows where id = any(p_ids); return true; end; $$;
revoke all on function public.staff_delete_note_rows(text, text[]) from public;
grant execute on function public.staff_delete_note_rows(text, text[]) to anon, authenticated;

create or replace function public.staff_insert_audit(p_token text, p_entry jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id text; v_name text; v_role text;
begin
  select subject_id, subject_name, role into v_id, v_name, v_role from public._staff_session(p_token);
  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (v_id, v_name, v_role,
    coalesce(p_entry->>'action', ''),
    p_entry->>'entity_type', p_entry->>'entity_label', p_entry->>'entity_id',
    coalesce(p_entry->'details', '{}'::jsonb));
  return true;
end; $$;
revoke all on function public.staff_insert_audit(text, jsonb) from public;
grant execute on function public.staff_insert_audit(text, jsonb) to anon, authenticated;

create or replace function public.staff_get_audit_log(p_token text, p_limit int default 200)
returns setof db_audit_log
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select * from db_audit_log order by at desc limit p_limit; end; $$;
revoke all on function public.staff_get_audit_log(text, int) from public;
grant execute on function public.staff_get_audit_log(text, int) to anon, authenticated;

create or replace function public.staff_get_all_audit_log(p_token text, p_since timestamptz default null)
returns setof db_audit_log
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  if p_since is null then
    return query select * from db_audit_log order by at desc;
  else
    return query select * from db_audit_log where at >= p_since order by at desc;
  end if;
end; $$;
revoke all on function public.staff_get_all_audit_log(text, timestamptz) from public;
grant execute on function public.staff_get_all_audit_log(text, timestamptz) to anon, authenticated;

create or replace function public.staff_insert_audit_bulk(p_token text, p_entries jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_e jsonb; v_role text;
begin
  select role into v_role from public._staff_session(p_token);
  if v_role not in ('admin','superadmin') then
    raise exception 'Solo un administrador puede restaurar el historial desde un backup.';
  end if;
  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    insert into db_audit_log (at, actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
    values (
      coalesce((v_e->>'at')::timestamptz, now()),
      v_e->>'actor_id', v_e->>'actor_name', v_e->>'actor_role',
      coalesce(v_e->>'action', ''), v_e->>'entity_type', v_e->>'entity_label', v_e->>'entity_id',
      coalesce(v_e->'details', '{}'::jsonb)
    );
  end loop;
  return true;
end; $$;
revoke all on function public.staff_insert_audit_bulk(text, jsonb) from public;
grant execute on function public.staff_insert_audit_bulk(text, jsonb) to anon, authenticated;

create or replace function public.staff_upsert_snapshot(p_token text, p_date date, p_payload jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  insert into db_dispatch_snapshots (date, payload, created_at) values (p_date, p_payload, now())
  on conflict (date) do update set payload = excluded.payload, created_at = now();
  return true;
end; $$;
revoke all on function public.staff_upsert_snapshot(text, date, jsonb) from public;
grant execute on function public.staff_upsert_snapshot(text, date, jsonb) to anon, authenticated;

create or replace function public.staff_get_snapshot(p_token text, p_date date)
returns table(date date, payload jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select s.date, s.payload, s.created_at from db_dispatch_snapshots s where s.date = p_date; end; $$;
revoke all on function public.staff_get_snapshot(text, date) from public;
grant execute on function public.staff_get_snapshot(text, date) to anon, authenticated;

create or replace function public.staff_list_snapshot_dates(p_token text)
returns table(date date, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select s.date, s.created_at from db_dispatch_snapshots s order by s.date desc; end; $$;
revoke all on function public.staff_list_snapshot_dates(text) from public;
grant execute on function public.staff_list_snapshot_dates(text) to anon, authenticated;

create or replace function public.staff_get_all_snapshots(p_token text, p_since date default null)
returns table(date date, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  if p_since is null then
    return query select s.date, s.payload from db_dispatch_snapshots s;
  else
    return query select s.date, s.payload from db_dispatch_snapshots s where s.date >= p_since;
  end if;
end; $$;
revoke all on function public.staff_get_all_snapshots(text, date) from public;
grant execute on function public.staff_get_all_snapshots(text, date) to anon, authenticated;

create or replace function public.staff_upsert_snapshots_bulk(p_token text, p_snapshots jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_s jsonb; v_role text;
begin
  select role into v_role from public._staff_session(p_token);
  if v_role not in ('admin','superadmin') then
    raise exception 'Solo un administrador puede restaurar snapshots desde un backup.';
  end if;
  for v_s in select * from jsonb_array_elements(coalesce(p_snapshots, '[]'::jsonb)) loop
    insert into db_dispatch_snapshots (date, payload, created_at)
    values ((v_s->>'date')::date, v_s->'payload', now())
    on conflict (date) do update set payload = excluded.payload, created_at = now();
  end loop;
  return true;
end; $$;
revoke all on function public.staff_upsert_snapshots_bulk(text, jsonb) from public;
grant execute on function public.staff_upsert_snapshots_bulk(text, jsonb) to anon, authenticated;

create or replace function public.staff_get_delivery_rows(p_token text, p_date date)
returns table(id text, client_id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._require_staff(p_token); return query select r.id, r.client_id, r.payload from db_delivery_status r where r.date = p_date; end; $$;
revoke all on function public.staff_get_delivery_rows(text, date) from public;
grant execute on function public.staff_get_delivery_rows(text, date) to anon, authenticated;

create or replace function public.staff_upsert_delivery_rows(p_token text, p_rows jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_r jsonb;
begin
  perform public._require_staff(p_token);
  for v_r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into db_delivery_status (id, date, client_id, payload, updated_at)
    values ((v_r->>'date') || '_' || (v_r->>'clientId'), (v_r->>'date')::date, v_r->>'clientId', v_r->'payload', now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  end loop;
  return true;
end; $$;
revoke all on function public.staff_upsert_delivery_rows(text, jsonb) from public;
grant execute on function public.staff_upsert_delivery_rows(text, jsonb) to anon, authenticated;

create or replace function public.staff_get_all_delivery_status(p_token text, p_since date default null)
returns table(date date, client_id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  if p_since is null then
    return query select r.date, r.client_id, r.payload from db_delivery_status r;
  else
    return query select r.date, r.client_id, r.payload from db_delivery_status r where r.date >= p_since;
  end if;
end; $$;
revoke all on function public.staff_get_all_delivery_status(text, date) from public;
grant execute on function public.staff_get_all_delivery_status(text, date) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 11. RPCs del portal cliente
-- --------------------------------------------------------------------------
create or replace function public.cliente_get_own_profile(p_token text, p_client_id text)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_cliente_owns(p_token, p_client_id);
  return query select r.id, r.payload from db_clientes_rows r where r.id = p_client_id;
end; $$;
revoke all on function public.cliente_get_own_profile(text, text) from public;
grant execute on function public.cliente_get_own_profile(text, text) to anon, authenticated;

create or replace function public.cliente_save_profile(p_token text, p_client_id text, p_updates jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row db_clientes_rows%rowtype;
  v_new jsonb;
  v_allowed text[] := array['pauseStart','returnDate','status','pauseDates','activeAddressId'];
  v_key text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  select * into v_row from db_clientes_rows where id = p_client_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  v_new := v_row.payload;
  foreach v_key in array v_allowed loop
    if p_updates ? v_key then
      v_new := jsonb_set(v_new, array[v_key], coalesce(p_updates -> v_key, 'null'::jsonb), true);
    end if;
  end loop;

  if p_updates ? 'status' and not (p_updates->>'status' in ('Programado','Pausado','Activo')) then
    v_new := jsonb_set(v_new, '{status}', coalesce(v_row.payload->'status', 'null'::jsonb), true);
  end if;

  update db_clientes_rows set payload = v_new, updated_at = now() where id = p_client_id;
  return true;
end;
$$;
revoke all on function public.cliente_save_profile(text, text, jsonb) from public;
grant execute on function public.cliente_save_profile(text, text, jsonb) to anon, authenticated;

create or replace function public.cliente_insert_audit(p_token text, p_client_id text, p_entry jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_name text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);
  select subject_name into v_name from public._cliente_session(p_token);
  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (p_client_id, coalesce(v_name, ''), 'cliente',
    coalesce(p_entry->>'action', ''), p_entry->>'entity_type', p_entry->>'entity_label', p_client_id,
    coalesce(p_entry->'details', '{}'::jsonb));
  return true;
end;
$$;
revoke all on function public.cliente_insert_audit(text, text, jsonb) from public;
grant execute on function public.cliente_insert_audit(text, text, jsonb) to anon, authenticated;

create or replace function crear_nota_cliente(p_token text, p_client_id text, p_texto text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := 'n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  v_client_name text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_texto is null or length(trim(p_texto)) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;

  select payload->>'name' into v_client_name from db_clientes_rows where id = p_client_id;

  insert into db_notas_rows (id, payload, updated_at)
  values (
    v_id,
    jsonb_build_object(
      'text', trim(p_texto), 'dueDate', to_char(current_date, 'YYYY-MM-DD'),
      'status', 'pendiente', 'source', 'cliente', 'clientId', p_client_id,
      'clientName', coalesce(v_client_name, ''), 'createdAt', now(), 'read', false
    ),
    now()
  );

  return v_id;
end;
$$;
revoke all on function crear_nota_cliente(text, text, text) from public;
grant execute on function crear_nota_cliente(text, text, text) to anon;

create or replace function public.set_client_address_override(
  p_token text,
  p_client_id text,
  p_address_id text,
  p_date text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row db_clientes_rows%rowtype;
  v_now_bo timestamptz := now() at time zone 'America/La_Paz';
  v_addr_exists boolean;
  v_overrides jsonb;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if extract(hour from v_now_bo) >= 22 then
    raise exception 'Ya pasó el horario para cambiar la dirección (22:00 hora Bolivia).';
  end if;

  select * into v_row from db_clientes_rows where id = p_client_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  select exists(
    select 1 from jsonb_array_elements(coalesce(v_row.payload->'addresses', '[]'::jsonb)) a
    where a->>'id' = p_address_id
  ) into v_addr_exists;
  if not v_addr_exists then
    raise exception 'Esa dirección no pertenece a este cliente.';
  end if;

  select coalesce(
    (select jsonb_agg(o) from jsonb_array_elements(coalesce(v_row.payload->'addressOverrides', '[]'::jsonb)) o
     where o->>'date' <> p_date),
    '[]'::jsonb
  ) into v_overrides;
  v_overrides := v_overrides || jsonb_build_array(jsonb_build_object('date', p_date, 'addressId', p_address_id));

  update db_clientes_rows
    set payload = jsonb_set(payload, '{addressOverrides}', v_overrides, true),
        updated_at = now()
    where id = p_client_id;

  return v_overrides;
end;
$$;
revoke all on function public.set_client_address_override(text, text, text, text) from public;
grant execute on function public.set_client_address_override(text, text, text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 12. Datos iniciales
-- --------------------------------------------------------------------------
insert into db_clientes (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into db_personal (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into db_inventario (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- 13. Limpieza automática con pg_cron
-- --------------------------------------------------------------------------
do $do$
begin
  perform cron.schedule(
    'delivery-status-cleanup',
    '0 1 * * *',
    $cron$ delete from public.db_delivery_status where date < (now() - interval '7 days')::date; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de delivery_status (revisa permisos/pg_cron).';
end $do$;

do $do$
begin
  perform cron.unschedule('delete-old-dispatch-snapshots')
  where exists (select 1 from cron.job where jobname = 'delete-old-dispatch-snapshots');

  perform cron.schedule(
    'delete-old-dispatch-snapshots',
    '0 1 * * *',
    $cron$ delete from public.db_dispatch_snapshots where date < (current_date - interval '2 years'); $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de dispatch_snapshots (revisa permisos/pg_cron).';
end $do$;

-- Borra el ARCHIVO real del bucket (no solo la fila que lo referencia):
-- las fotos de respaldo de un pedido viven en 'delivery-proof/' y los
-- comprobantes de pago en 'comprobantes/' (ver uploadImage() en el
-- frontend). Borrar la fila de db_delivery_status o el texto de la nota
-- no borraba el archivo -- quedaba huérfano en Storage para siempre. Esto
-- sí lo borra: borrar de storage.objects es lo mismo que borrarlo desde el
-- bucket a mano, deja de existir y de contar para el espacio usado.
do $do$
begin
  perform cron.unschedule('borrar-fotos-viejas-storage')
  where exists (select 1 from cron.job where jobname = 'borrar-fotos-viejas-storage');

  perform cron.schedule(
    'borrar-fotos-viejas-storage',
    '0 2 * * *',
    $cron$
      delete from storage.objects
      where bucket_id = 'app-images'
        and (name like 'delivery-proof/%' or name like 'comprobantes/%')
        and created_at < now() - interval '7 days';
    $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de fotos en Storage (revisa permisos/pg_cron).';
end $do$;

-- Clientes "inactivos": ninguna edición ni "Procesar día" tocó su fila en
-- 2 años (updated_at se refresca con cada guardado desde
-- staff_upsert_client_rows, incluido el conteo diario de días consumidos
-- de los clientes activos -- por eso un cliente realmente inactivo es el
-- único que se queda atrás en el tiempo). Si tu definición de "inactivo"
-- es otra (ej. solo los marcados como "Inactivo"/dados de baja, sin
-- importar cuándo se tocó la fila por última vez), avisame y se ajusta
-- el where de abajo.
do $do$
begin
  perform cron.unschedule('borrar-clientes-inactivos')
  where exists (select 1 from cron.job where jobname = 'borrar-clientes-inactivos');

  perform cron.schedule(
    'borrar-clientes-inactivos',
    '0 3 * * *',
    $cron$ delete from db_clientes_rows where updated_at < now() - interval '2 years'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de clientes inactivos (revisa permisos/pg_cron).';
end $do$;

do $do$
begin
  perform cron.unschedule('borrar-auditoria-vieja')
  where exists (select 1 from cron.job where jobname = 'borrar-auditoria-vieja');

  perform cron.schedule(
    'borrar-auditoria-vieja',
    '0 4 * * *',
    $cron$ delete from db_audit_log where at < now() - interval '15 days'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de audit_log (revisa permisos/pg_cron).';
end $do$;

do $do$
begin
  perform cron.schedule(
    'limpiar-intentos-login-viejos',
    '30 4 * * *',
    $cron$ delete from public.db_login_attempts where last_attempt < now() - interval '1 day'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de intentos de login (revisa permisos/pg_cron).';
end $do$;

do $do$
begin
  perform cron.unschedule('limpiar-intentos-login-cliente-viejos')
  where exists (select 1 from cron.job where jobname = 'limpiar-intentos-login-cliente-viejos');

  perform cron.schedule(
    'limpiar-intentos-login-cliente-viejos',
    '30 4 * * *',
    $cron$ delete from public.db_client_login_attempts where last_attempt < now() - interval '1 day'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de intentos de login de cliente (revisa permisos/pg_cron).';
end $do$;

-- --------------------------------------------------------------------------
-- 14. Realtime: autorización para el canal de presencia ("Conectados ahora")
-- --------------------------------------------------------------------------
-- Esta app NUNCA usa Supabase Auth -- login_staff/login_cliente son
-- funciones propias con su propio token en db_sessions, no auth.uid().
-- Eso significa que TODOS los clientes se conectan a Realtime con el rol
-- `anon`, nunca `authenticated`. Supabase exige "Realtime Authorization"
-- por defecto en proyectos nuevos: sin una política en realtime.messages,
-- un canal puede quedar sin poder suscribirse ni trackear presencia.
-- El canal 'catering-online-users' (services/supabaseClient.js,
-- joinPresence()) ahora se abre con private:true (modo recomendado por
-- Supabase para Presence/Broadcast) -- eso hace que esta política sí se
-- aplique de verdad, en vez de depender de si "Allow public access" está
-- prendido en Realtime Settings del dashboard (una config de interfaz que
-- no se puede confirmar ni forzar desde acá). Esta política es de solo
-- lectura/escritura de mensajes de presencia (no toca ninguna tabla de
-- datos), así que no baja el nivel de seguridad del resto de la app.
--
-- Si después de correr esto "Conectados ahora" sigue en 0, revisar
-- Dashboard → Project Settings → Realtime que esté habilitado a nivel de
-- proyecto, o los console.warn de diagnóstico que quedan en
-- joinPresence() desde la consola del navegador en producción.
-- Defensivo: en proyectos donde por algún motivo esta tabla gestionada por
-- Supabase no tuviera RLS activado, las políticas de abajo no harían nada
-- (¡una tabla sin RLS deja pasar todo igual, política o no!). Esto es
-- idempotente -- no rompe nada si ya estaba activado, que es lo normal.
alter table if exists realtime.messages enable row level security;

drop policy if exists "presencia: anon puede escuchar" on realtime.messages;
create policy "presencia: anon puede escuchar"
on realtime.messages for select
to anon, authenticated
using (realtime.messages.extension in ('presence', 'broadcast'));

drop policy if exists "presencia: anon puede trackear" on realtime.messages;
create policy "presencia: anon puede trackear"
on realtime.messages for insert
to anon, authenticated
with check (realtime.messages.extension in ('presence', 'broadcast'));

-- --------------------------------------------------------------------------
-- 15. Preferencias personales por cuenta (tema + orden de columnas), para
--     que viajen entre dispositivos en vez de quedarse solo en el
--     localStorage del navegador que las guardó.
-- --------------------------------------------------------------------------

-- STAFF: todas las preferencias del equipo viven en UNA fila
-- db_personal(id='userPrefs'), como un objeto { <userId>: {...} } --
-- mismo patrón "una fila por clave" que ya usan drivers/routes/settings.
-- Esta función NUNCA recibe el userId por parámetro: lo saca de la propia
-- sesión (_staff_session), así que un usuario jamás puede pisar ni leer a
-- propósito las preferencias de otro por esta vía. El merge es atómico
-- (jsonb_set sobre un solo path dentro de la fila) para que dos personas
-- guardando su propio tema al mismo tiempo no se pisen entre sí -- a
-- diferencia de staff_set_fields, que sobreescribe la fila entera y por
-- eso no es seguro para esto (ver riesgo de concurrencia documentado en
-- PROMPT_CONTINUAR.md, pendiente #7).
create or replace function public.staff_save_own_prefs(p_token text, p_prefs jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_user_id text;
begin
  select subject_id into v_user_id from public._staff_session(p_token);

  insert into db_personal (id, payload, updated_at)
    values ('userPrefs', jsonb_build_object(v_user_id, coalesce(p_prefs, '{}'::jsonb)), now())
  on conflict (id) do update
    set payload = jsonb_set(coalesce(db_personal.payload, '{}'::jsonb), array[v_user_id], coalesce(p_prefs, '{}'::jsonb), true),
        updated_at = now();

  return true;
end;
$$;
revoke all on function public.staff_save_own_prefs(text, jsonb) from public;
grant execute on function public.staff_save_own_prefs(text, jsonb) to anon, authenticated;

-- Para LEER las propias preferencias no hace falta una función nueva: el
-- genérico staff_get_fields('personal', ['userPrefs']) que ya existe
-- devuelve la fila completa (payload = objeto con TODOS los usuarios --
-- no es dato sensible, son solo preferencias de UI como tema/columnas).
-- El frontend simplemente se queda con payload[suPropioUserId].

-- CLIENTES: se suma 'uiTheme' a la lista blanca de campos que un cliente
-- puede tocar de su propia fila. cliente_save_profile ya validaba
-- ownership (_require_cliente_owns) + una lista blanca de campos
-- (v_allowed) antes de esto -- no hace falta una función nueva, solo
-- ampliar esa lista. Se redefine la función completa porque Postgres no
-- permite tocar el cuerpo de una función con ALTER, pero es exactamente
-- el mismo código de antes salvo la lista v_allowed.
create or replace function public.cliente_save_profile(p_token text, p_client_id text, p_updates jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row db_clientes_rows%rowtype;
  v_new jsonb;
  v_allowed text[] := array['pauseStart','returnDate','status','pauseDates','activeAddressId','uiTheme'];
  v_key text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  select * into v_row from db_clientes_rows where id = p_client_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  v_new := v_row.payload;
  foreach v_key in array v_allowed loop
    if p_updates ? v_key then
      v_new := jsonb_set(v_new, array[v_key], coalesce(p_updates -> v_key, 'null'::jsonb), true);
    end if;
  end loop;

  if p_updates ? 'status' and not (p_updates->>'status' in ('Programado','Pausado','Activo')) then
    v_new := jsonb_set(v_new, '{status}', coalesce(v_row.payload->'status', 'null'::jsonb), true);
  end if;

  update db_clientes_rows set payload = v_new, updated_at = now() where id = p_client_id;
  return true;
end;
$$;
revoke all on function public.cliente_save_profile(text, text, jsonb) from public;
grant execute on function public.cliente_save_profile(text, text, jsonb) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 16. Cierre de seguridad del bucket "app-images": saca a `anon` (la
--     clave pública) los permisos directos de subir/reemplazar/borrar.
--     Antes CUALQUIERA con la anon key (visible en el navegador de
--     cualquiera, sin loguearse) podía escribir o borrar en el bucket.
--     Ahora esas acciones solo las puede hacer la Edge Function
--     `image-storage` (supabase-functions/image-storage/index.ts), que
--     usa la service_role key (nunca expuesta al navegador) y antes de
--     todo valida el mismo token de sesión que ya usan las RPCs de la
--     app. La lectura pública (para que las fotos/logos se vean sin
--     login) NO cambia.
--
--     *** IMPORTANTE: desplegar la Edge Function ANTES de correr esta
--     sección ***  (`supabase functions deploy image-storage
--     --no-verify-jwt`) -- si se corre esta sección primero, subir o
--     borrar imágenes queda roto hasta que la función esté desplegada.
-- --------------------------------------------------------------------------
drop policy if exists "app-images: subir" on storage.objects;
drop policy if exists "app-images: reemplazar" on storage.objects;
drop policy if exists "app-images: borrar" on storage.objects;
-- La política de lectura pública ("app-images: lectura pública", creada
-- en la sección 5) se deja intacta a propósito.

-- =============================================================================
-- FIN. Verificaciones útiles después de correrlo:
--
--   select * from login_staff('admin@catering.local','admin123');
--   -- debe traer session_token -- este es el admin de arranque, cámbialo
--   -- por uno real en cuanto puedas (Personal → Usuarios).
--
--   select get_branding();      -- {} vacío hasta que cargues Configuración
--   select get_plan_status();   -- {"plan":"basico","clientPortalLocked":true}
--
--   select * from cron.job;     -- los 7 jobs de limpieza programados
--
--   curl "https://<tu-proyecto>.supabase.co/rest/v1/db_personal?select=*&apikey=<publishable key>"
--   -- tiene que devolver un array vacío, no datos.
--
--   select * from pg_policies where tablename = 'messages' and schemaname = 'realtime';
--   -- deben aparecer las 2 políticas de presencia de la sección 14.
--
--   select staff_save_own_prefs(<session_token de un login_staff>, '{"theme":"night"}'::jsonb);
--   select * from staff_get_fields(<mismo token>, 'personal', array['userPrefs']);
--   -- debe devolver {"<userId>": {"theme":"night"}} -- prueba de la sección 15.
--
--   select * from pg_policies where tablename = 'objects' and schemaname = 'storage'
--     and policyname like 'app-images%';
--   -- después de la sección 16 debe quedar SOLO "app-images: lectura
--   -- pública" -- si siguen apareciendo "subir"/"reemplazar"/"borrar", la
--   -- sección 16 no se corrió (o corrió contra otro proyecto).
--
-- Después de esto: copiá URL + publishable key a config.js, y si necesitás
-- un rol Super Admin aparte, corré supabase-promote-superadmin.sql.
-- =============================================================================

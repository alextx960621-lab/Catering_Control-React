-- Catering Control · instalación completa para una empresa nueva (un solo archivo).
-- Pegarlo entero en el SQL Editor de Supabase; se puede volver a correr sin romper nada.
set search_path = public, extensions;

-- 1. Extensiones necesarias
create extension if not exists pgcrypto;
create extension if not exists pg_cron;  -- si da error de permisos, actívala en Database → Extensions

-- 2. Tablas

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

-- 3. Índices
create index if not exists db_audit_log_at_idx on db_audit_log (at desc);
create index if not exists db_delivery_status_date_idx on public.db_delivery_status (date);
create index if not exists db_delivery_status_client_idx on public.db_delivery_status (client_id);

-- 4. RLS cerrado desde el arranque en TODAS las tablas
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

-- 5. Storage: bucket de imágenes
insert into storage.buckets (id, name, public)
values ('app-images', 'app-images', true)
on conflict (id) do nothing;

-- Bucket PRIVADO para lo que identifica a una persona: comprobantes de pago (nombre, monto) y fotos
-- de entrega (la puerta de una casa). Nadie lo lee sin una URL firmada que emite la Edge Function.
insert into storage.buckets (id, name, public)
values ('app-docs', 'app-docs', false)
on conflict (id) do update set public = false;

drop policy if exists "app-images: borrar" on storage.objects;
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

  -- Sesión de arranque: solo vale mientras NO exista ningún usuario cargado
  if v_id = 'staff_admin' and exists (
    select 1 from db_personal p
    where p.id = 'staffUsers' and jsonb_typeof(p.payload) = 'array' and jsonb_array_length(p.payload) > 0
      and not exists (select 1 from jsonb_array_elements(p.payload) u where u ->> 'id' = 'staff_admin')
  ) then
    raise exception 'Sesión inválida o expirada. Vuelve a iniciar sesión.';
  end if;

  update db_sessions set expires_at = now() + interval '7 days' where token = p_token;
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

-- Igual que _require_staff, pero además exige permiso de EDICIÓN sobre p_page (mismo criterio que…
create or replace function public._require_permission(p_token text, p_page text)
returns table(subject_id text, subject_name text, role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text; v_name text; v_role text;
  v_allowed boolean := false;
begin
  select s.subject_id, s.subject_name, s.role into v_id, v_name, v_role from public._staff_session(p_token) s;

  if v_role in ('admin', 'superadmin') then
    v_allowed := true;
  elsif v_role = 'editor' and p_page not in ('users', 'settings') then
    v_allowed := true;
  elsif v_role = 'kitchen' and p_page = 'inventory' then
    v_allowed := true;
  elsif v_role = 'driver' and p_page = 'delivery' then
    v_allowed := true;
  elsif v_role not in ('admin', 'superadmin', 'editor', 'kitchen', 'driver') then
    select coalesce((r -> 'pages' -> p_page ->> 'edit')::boolean, false) into v_allowed
    from jsonb_array_elements(public._custom_roles()) r
    where r ->> 'id' = v_role
    limit 1;
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'Tu rol no tiene permiso para hacer esto.';
  end if;

  return query select v_id, v_name, v_role;
end;
$$;
revoke all on function public._require_permission(text, text) from public;

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

-- 6. hash_password y día operativo (zona horaria, fecha del servidor)
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

-- Zona horaria de ESTA empresa (una por proyecto de Supabase -- no hace falta resolverla "por fila"…
create or replace function get_company_timezone()
returns text
language sql
security definer
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select nullif(trim(payload->>'timezone'), '') from db_personal where id = 'settings'),
    'America/La_Paz');
$$;
grant execute on function get_company_timezone() to anon, authenticated;

create or replace function get_server_date()
returns text
language sql
security definer
stable
as $$
  select to_char(now() at time zone get_company_timezone(), 'YYYY-MM-DD');
$$;
grant execute on function get_server_date() to anon, authenticated;

-- Día operativo: el "hoy" de la operación (Día de trabajo, Notas, portal del cliente)
create or replace function get_day_cutoff_hour()
returns int
language sql
security definer
stable
set search_path = public, extensions
as $$
  select least(12, greatest(0, coalesce(
    (select case when payload ->> 'dayCutoffHour' ~ '^[0-9]{1,2}$' then (payload ->> 'dayCutoffHour')::int end
       from db_personal where id = 'settings'),
    4)));
$$;
revoke all on function get_day_cutoff_hour() from public;

create or replace function get_business_date()
returns text
language sql
security definer
stable
set search_path = public, extensions
as $$
  select to_char((now() at time zone get_company_timezone()) - make_interval(hours => get_day_cutoff_hour()), 'YYYY-MM-DD');
$$;
grant execute on function get_business_date() to anon, authenticated;

-- 7. Lecturas públicas: branding, plan y catálogo del portal
create or replace function get_branding()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from db_personal p,
       jsonb_each(case when jsonb_typeof(p.payload) = 'object' then p.payload else '{}'::jsonb end) e
  where p.id = 'settings'
    and e.key in (
      'companyName', 'logoUrl', 'itemIcons', 'whatsappNumber',
      'instagramUrl', 'instagramHandle', 'adImageUrl', 'paymentQrUrl',
      'renewalWarningDays', 'menuItems', 'language', 'currency'
    );
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
declare
  v_plans jsonb; v_days jsonb; v_current jsonb; v_main jsonb;
  v_days_src jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  select payload into v_plans   from db_clientes where id = 'plans';
  select payload into v_days_src from db_clientes where id = 'days';
  select payload into v_current from db_clientes where id = 'currentDate';

  -- Compatibilidad con bases viejas que guardaban todo en la fila 'main'
  if v_plans is null and v_days_src is null and v_current is null then
    select payload into v_main from db_clientes where id = 'main';
    if jsonb_typeof(v_main) = 'object' then
      v_plans := v_main -> 'plans';
      v_days_src := v_main -> 'days';
      v_current := v_main -> 'currentDate';
    end if;
  end if;

  -- Del calendario solo sale "laborable" -- NUNCA processedClientIds ni payrollSnapshot (sueldos…
  if v_days_src is not null and jsonb_typeof(v_days_src) = 'object' then
    select coalesce(jsonb_object_agg(d.key,
             jsonb_build_object('laborable', coalesce(
               case when jsonb_typeof(d.value) = 'object' then (d.value ->> 'laborable')::boolean end, true))),
           '{}'::jsonb)
    into v_days
    from jsonb_each(v_days_src) d;
  end if;

  if v_plans is not null then v_result := v_result || jsonb_build_object('plans', v_plans); end if;
  if v_days is not null then v_result := v_result || jsonb_build_object('days', v_days); end if;
  -- La fecha de trabajo ya no es un dato guardado: es el día operativo del servidor (get_business_date)
  v_result := v_result || jsonb_build_object('currentDate', get_business_date());
  return v_result;
end;
$$;

grant execute on function public.get_portal_catalog() to anon, authenticated;

-- 8. Login de cliente y de staff (bloqueo por intentos + token de sesión)

revoke all on function public.get_portal_catalog() from public;

grant execute on function public.get_portal_catalog() to anon, authenticated;

-- Contraseñas: nadie recibe hashes, y hashear exige ser administrador
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
  -- Un carnet o teléfono vacío (o ridículamente corto) NUNCA puede coincidir con nada: antes, un…
  if length(v_carnet) < 4 or length(v_phone) < 6 then
    return;
  end if;

  select * into v_attempt from public.db_client_login_attempts where carnet = v_carnet;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    v_remaining := ceil(extract(epoch from (v_attempt.locked_until - now())));
    return query select null::text, null::text, greatest(v_remaining, 1), null::text;
    return;
  end if;

  select r.id, r.payload ->> 'name' into v_id, v_name
  from db_clientes_rows r
  where lower(trim(coalesce(r.payload ->> 'carnet', ''))) = v_carnet
    and (
      regexp_replace(coalesce(r.payload ->> 'phone1', ''), '\D', '', 'g') = v_phone
      or regexp_replace(coalesce(r.payload ->> 'phone2', ''), '\D', '', 'g') = v_phone
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
  v_lock_minutes int;
  v_id text; v_name text; v_role text; v_routeId text; v_driverId text;
  v_token text;
begin
  select * into v_attempt from db_login_attempts where email = v_email;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    v_remaining := ceil(extract(epoch from (v_attempt.locked_until - now())));
    return query select null::text, null::text, null::text, null::text, null::text, greatest(v_remaining, 1), null::text;
    return;
  end if;

  select payload into v_users from db_personal where db_personal.id = 'staffUsers';
  if v_users is null or jsonb_typeof(v_users) <> 'array' then v_users := '[]'::jsonb; end if;

  if jsonb_array_length(v_users) = 0 then
    -- Solo mientras NO exista ningún usuario cargado (instalación nueva)
    if v_email = 'admin@catering.local' and p_password = 'admin123' then
      v_id := 'staff_admin'; v_name := 'Administrador'; v_role := 'admin'; v_routeId := ''; v_driverId := '';
    end if;
  else
    select u ->> 'id', u ->> 'name', u ->> 'role', u ->> 'routeId', u ->> 'driverId'
      into v_id, v_name, v_role, v_routeId, v_driverId
    from jsonb_array_elements(v_users) as u
    where lower(u ->> 'email') = v_email
      and u ->> 'passwordHash' is not null
      and u ->> 'passwordHash' <> ''
      and crypt(p_password, u ->> 'passwordHash') = (u ->> 'passwordHash')
    limit 1;
  end if;

  if v_id is not null then
    delete from db_login_attempts where email = v_email;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into db_sessions (token, subject_type, subject_id, subject_name, role, expires_at)
    values (v_token, 'staff', v_id, v_name, v_role, now() + interval '7 days');
    return query select v_id, v_name, v_role, v_routeId, v_driverId, 0, v_token;
    return;
  end if;

  -- Cada 3 fallos seguidos el bloqueo se duplica (1, 2, 4, 8, 
  v_new_fail_count := coalesce(v_attempt.fail_count, 0) + 1;
  if v_new_fail_count % 3 = 0 then
    v_lock_minutes := least(60, power(2, greatest(v_new_fail_count / 3 - 1, 0))::int);
    insert into db_login_attempts (email, fail_count, locked_until, last_attempt)
      values (v_email, v_new_fail_count, now() + make_interval(mins => v_lock_minutes), now())
    on conflict (email) do update
      set fail_count = v_new_fail_count, locked_until = now() + make_interval(mins => v_lock_minutes), last_attempt = now();
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

-- 9. RPCs de staff
create or replace function public.staff_get_block(p_token text, p_table_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_payload jsonb; v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if p_table_key = 'clientes' then
    select payload into v_payload from db_clientes where id = 'main';
  elsif p_table_key = 'personal' then
    select payload into v_payload from db_personal where id = 'main';
    if jsonb_typeof(v_payload) = 'object' and v_payload ? 'staffUsers' then
      v_payload := jsonb_set(v_payload, '{staffUsers}', public._sanitize_staff_users(v_payload -> 'staffUsers', v_role));
    end if;
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
declare v_role text;
begin
  select role into v_role from public._staff_session(p_token);
  if p_table_key = 'inventario' then
    perform public._require_permission(p_token, 'inventory');
  elsif p_table_key in ('clientes', 'personal') then
    -- Sobrescribe TODO el bloque de una (sin la granularidad por campo que sí tiene staff_set_fields)…
    if v_role not in ('admin', 'superadmin') then
      raise exception 'Tu rol no tiene permiso para hacer esto.';
    end if;
  else
    raise exception 'Tabla no permitida.';
  end if;
  if p_table_key = 'clientes' then
    insert into db_clientes (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
  elsif p_table_key = 'personal' then
    insert into db_personal (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
  elsif p_table_key = 'inventario' then
    insert into db_inventario (id, payload, updated_at) values ('main', p_payload, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
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
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  if p_table_key = 'clientes' then
    return query select r.id, r.payload from db_clientes r where r.id = any(p_ids) and r.id <> 'main';
  elsif p_table_key = 'personal' then
    return query
      select r.id,
             case when r.id = 'staffUsers' then public._sanitize_staff_users(r.payload, v_role) else r.payload end
      from db_personal r
      where r.id = any(p_ids) and r.id <> 'main';
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
declare
  v_key text; v_val jsonb; v_role text;
  v_allowed text[];
  v_old_settings jsonb; v_new_settings jsonb;
  v_old_users jsonb; v_new_users jsonb; v_merged jsonb := '[]'::jsonb;
  v_u jsonb; v_o jsonb; v_hash text; v_old_hash text;
  v_changed_ids text[] := '{}';
  v_page text;
  v_pages text[] := array['notes','payroll','inventory','audit','metrics','delivery','weeklySchedule','returnDate','specialDietPrint','clientPortal'];
begin
  select s.role into v_role from public._staff_session(p_token) s;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Datos inválidos.';
  end if;

  -- Solo las claves que la app realmente guarda por esta vía
  v_allowed := case p_table_key
    when 'clientes' then array['plans','days','currentDate']
    when 'personal' then array['drivers','routes','settings','staffUsers']
    else null end;
  if v_allowed is null then
    raise exception 'Tabla no permitida.';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'Campo no permitido: %', v_key;
    end if;
  end loop;

  if p_table_key = 'clientes' then
    if p_fields ? 'plans' then perform public._require_permission(p_token, 'plans'); end if;
    if p_fields ? 'days' or p_fields ? 'currentDate' then perform public._require_permission(p_token, 'dispatch'); end if;
  end if;

  if p_table_key = 'personal' then
    if p_fields ? 'staffUsers' and v_role not in ('admin','superadmin') then
      raise exception 'Solo un administrador puede modificar las cuentas de staff.';
    end if;
    if p_fields ? 'settings' and v_role not in ('admin','superadmin') then
      raise exception 'Solo un administrador puede modificar la configuración.';
    end if;
    if p_fields ? 'drivers' then perform public._require_permission(p_token, 'drivers'); end if;
    if p_fields ? 'routes' then perform public._require_permission(p_token, 'routes'); end if;

    -- ---- Plan Premium: solo el Super Administrador puede darlo/ampliarlo ----
    if p_fields ? 'settings' and v_role <> 'superadmin' then
      select payload into v_old_settings from db_personal where id = 'settings';
      v_old_settings := coalesce(v_old_settings, '{}'::jsonb);
      v_new_settings := p_fields -> 'settings';
      if jsonb_typeof(v_new_settings) <> 'object' then raise exception 'Configuración inválida.'; end if;

      if coalesce(v_new_settings ->> 'plan', 'basico') = 'premium' then
        if coalesce(v_old_settings ->> 'plan', 'basico') <> 'premium'
           or coalesce(v_new_settings ->> 'premiumUntil', '') <> coalesce(v_old_settings ->> 'premiumUntil', '') then
          raise exception 'Solo el Super Administrador puede activar o ampliar el plan Premium.';
        end if;
      end if;

      for v_page in
        select unnest(v_pages)
        union
        select jsonb_object_keys(coalesce(
          case when jsonb_typeof(v_new_settings -> 'premiumLockedPages') = 'object' then v_new_settings -> 'premiumLockedPages' end,
          '{}'::jsonb))
      loop
        if public._premium_page_locked(v_old_settings, v_page) and not public._premium_page_locked(v_new_settings, v_page) then
          raise exception 'Solo el Super Administrador puede desbloquear funciones Premium.';
        end if;
      end loop;
    end if;

    -- ---- Cuentas de personal ----
    if p_fields ? 'staffUsers' then
      v_new_users := p_fields -> 'staffUsers';
      if jsonb_typeof(v_new_users) <> 'array' then raise exception 'Lista de usuarios inválida.'; end if;
      select payload into v_old_users from db_personal where id = 'staffUsers';
      if v_old_users is null or jsonb_typeof(v_old_users) <> 'array' then v_old_users := '[]'::jsonb; end if;

      -- Nadie más que el Super Administrador puede crear/ascender/tocar a un Super Administrador
      if v_role <> 'superadmin' then
        for v_u in select * from jsonb_array_elements(v_new_users) loop
          if v_u ->> 'role' = 'superadmin' and not exists (
            select 1 from jsonb_array_elements(v_old_users) o
            where o ->> 'id' = v_u ->> 'id' and o ->> 'role' = 'superadmin'
          ) then
            raise exception 'Solo el Super Administrador puede asignar ese rol.';
          end if;
        end loop;
        for v_o in select * from jsonb_array_elements(v_old_users) loop
          if v_o ->> 'role' = 'superadmin' then
            select u into v_u from jsonb_array_elements(v_new_users) u where u ->> 'id' = v_o ->> 'id' limit 1;
            if v_u is null
               or v_u ->> 'role' is distinct from 'superadmin'
               or lower(coalesce(v_u ->> 'email', '')) is distinct from lower(coalesce(v_o ->> 'email', ''))
               or (coalesce(v_u ->> 'passwordHash', '') <> '' and v_u ->> 'passwordHash' is distinct from v_o ->> 'passwordHash') then
              raise exception 'Solo el Super Administrador puede modificar o quitar esa cuenta.';
            end if;
          end if;
        end loop;
      end if;

      -- Los hashes nunca viajan al navegador: si llega un usuario sin hash, se conserva el que ya tenía; si…
      for v_u in select * from jsonb_array_elements(v_new_users) loop
        v_u := v_u - 'hasPassword';
        v_hash := coalesce(v_u ->> 'passwordHash', '');
        select o ->> 'passwordHash' into v_old_hash
        from jsonb_array_elements(v_old_users) o where o ->> 'id' = v_u ->> 'id' limit 1;
        if v_hash = '' then
          if v_old_hash is not null then v_u := jsonb_set(v_u, '{passwordHash}', to_jsonb(v_old_hash), true); end if;
        elsif v_old_hash is not null and v_hash <> v_old_hash then
          v_changed_ids := v_changed_ids || (v_u ->> 'id');
        end if;
        v_merged := v_merged || jsonb_build_array(v_u);
      end loop;
      p_fields := jsonb_set(p_fields, '{staffUsers}', v_merged, true);
    end if;
  end if;

  for v_key, v_val in select * from jsonb_each(p_fields) loop
    if p_table_key = 'clientes' then
      insert into db_clientes (id, payload, updated_at) values (v_key, v_val, now())
        on conflict (id) do update set payload = excluded.payload, updated_at = now();
    else
      insert into db_personal (id, payload, updated_at) values (v_key, v_val, now())
        on conflict (id) do update set payload = excluded.payload, updated_at = now();
    end if;
  end loop;

  -- Cierra las sesiones de quien fue dado de baja, cambió de rol o de contraseña (la sesión desde la…
  if p_table_key = 'personal' and p_fields ? 'staffUsers' then
    delete from db_sessions s
    where s.subject_type = 'staff'
      and s.token <> p_token
      and (
        not exists (select 1 from jsonb_array_elements(v_merged) u where u ->> 'id' = s.subject_id)
        or exists (select 1 from jsonb_array_elements(v_merged) u
                   where u ->> 'id' = s.subject_id and u ->> 'role' is distinct from s.role)
        or s.subject_id = any(v_changed_ids)
      );
  end if;

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
  perform public._require_permission(p_token, 'clients');
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
as $$ begin perform public._require_permission(p_token, 'clients'); delete from db_clientes_rows where id = any(p_ids); return true; end; $$;
revoke all on function public.staff_delete_client_rows(text, text[]) from public;
grant execute on function public.staff_delete_client_rows(text, text[]) to anon, authenticated;

create or replace function public.staff_get_note_rows(p_token text)
returns table(id text, payload jsonb)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if not public._staff_can_view(v_role, 'notes') then return; end if;
  return query select r.id, r.payload from db_notas_rows r;
end; $$;
revoke all on function public.staff_get_note_rows(text) from public;
grant execute on function public.staff_get_note_rows(text) to anon, authenticated;

create or replace function public.staff_upsert_note_rows(p_token text, p_rows jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_row jsonb;
begin
  perform public._require_permission(p_token, 'notes');
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
as $$ begin perform public._require_permission(p_token, 'notes'); delete from db_notas_rows where id = any(p_ids); return true; end; $$;
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
as $$
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if not public._staff_can_view(v_role, 'audit') then return; end if;
  return query select * from db_audit_log order by at desc limit least(coalesce(p_limit, 200), 2000);
end; $$;
revoke all on function public.staff_get_audit_log(text, int) from public;
grant execute on function public.staff_get_audit_log(text, int) to anon, authenticated;

create or replace function public.staff_get_all_audit_log(p_token text, p_since timestamptz default null)
returns setof db_audit_log
language plpgsql security definer set search_path = public, extensions
as $$
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if not public._staff_can_view(v_role, 'audit') then return; end if;
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
  perform public._require_permission(p_token, 'dispatch');
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

-- El chofer solo reporta el motivo y la foto: de quién fue la falla lo decide un editor desde
-- Avisos. Mientras no esté clasificada, esta función deja (y refresca) una nota con id
-- determinístico para que aparezca en la bandeja; al clasificarla, el propio editor cierra la
-- nota. Si la marca se quita o pasa a "entregado", la nota pendiente sobraba y se borra.
create or replace function public.staff_upsert_delivery_rows(p_token text, p_rows jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_r jsonb;
  v_payload jsonb;
  v_date text;
  v_client_id text;
  v_status text;
  v_fault text;
  v_note_id text;
  v_client_name text;
begin
  perform public._require_permission(p_token, 'delivery');
  for v_r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_payload := coalesce(v_r->'payload', '{}'::jsonb);
    v_date := v_r->>'date';
    v_client_id := v_r->>'clientId';
    v_status := coalesce(v_payload->>'status', '');
    v_fault := coalesce(v_payload->>'fault', '');
    v_note_id := 'n_dlv_' || replace(v_date, '-', '') || '_' || v_client_id;

    insert into db_delivery_status (id, date, client_id, payload, updated_at)
    values (v_date || '_' || v_client_id, v_date::date, v_client_id, v_payload, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();

    continue when v_fault <> '';

    if v_status = 'no_entregado' then
      select c.payload ->> 'name' into v_client_name from db_clientes_rows c where c.id = v_client_id;
      insert into db_notas_rows (id, payload, updated_at)
      values (
        v_note_id,
        jsonb_build_object(
          'id', v_note_id,
          'kind', 'delivery-fault',
          'clientId', v_client_id,
          'clientName', coalesce(v_client_name, ''),
          'text', 'Falla de entrega sin clasificar de ' || coalesce(v_client_name, v_client_id) || ': ' || coalesce(v_payload->>'reason', 'sin motivo indicado'),
          'reason', coalesce(v_payload->>'reason', ''),
          'markedBy', coalesce(v_payload->>'by', ''),
          'dueDate', v_date,
          'deliveryDate', v_date,
          'status', 'pendiente',
          'source', 'staff',
          'read', false,
          'createdAt', now(),
          'createdBy', coalesce(v_payload->>'by', 'Chofer')
        ),
        now()
      )
      on conflict (id) do update set payload = excluded.payload, updated_at = now();
    else
      delete from db_notas_rows where id = v_note_id;
    end if;
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

-- 10. RPCs del portal cliente
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
  v_allowed text[] := array['pauseStart','returnDate','status','pauseDates','activeAddressId','uiTheme'];
  v_key text;
  v_val jsonb;
  v_d jsonb;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Datos inválidos.';
  end if;

  select * into v_row from db_clientes_rows where id = p_client_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  v_new := v_row.payload;
  foreach v_key in array v_allowed loop
    if p_updates ? v_key then
      v_val := coalesce(p_updates -> v_key, 'null'::jsonb);

      if v_key in ('pauseStart', 'returnDate') then
        if jsonb_typeof(v_val) not in ('string', 'null')
           or (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') !~ '^(\d{4}-\d{2}-\d{2})?$') then
          raise exception 'Fecha inválida.';
        end if;

      elsif v_key = 'status' then
        if jsonb_typeof(v_val) <> 'string' or not ((v_val #>> '{}') in ('Programado','Pausado','Activo')) then
          v_val := coalesce(v_row.payload -> 'status', 'null'::jsonb);  -- se ignora el valor y se deja el que estaba
        end if;

      elsif v_key = 'pauseDates' then
        if jsonb_typeof(v_val) = 'null' then
          v_val := '[]'::jsonb;
        elsif jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 120 then
          raise exception 'Fechas de pausa inválidas.';
        else
          for v_d in select * from jsonb_array_elements(v_val) loop
            if jsonb_typeof(v_d) <> 'string' or (v_d #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
              raise exception 'Fechas de pausa inválidas.';
            end if;
          end loop;
        end if;

      elsif v_key = 'activeAddressId' then
        if jsonb_typeof(v_val) = 'null' or v_val = '""'::jsonb then
          null;  -- sin dirección activa: se deja como llegó
        elsif jsonb_typeof(v_val) <> 'string' or not exists (
          select 1 from jsonb_array_elements(coalesce(v_row.payload -> 'addresses', '[]'::jsonb)) a
          where a ->> 'id' = (v_val #>> '{}')
        ) then
          raise exception 'Esa dirección no pertenece a este cliente.';
        end if;

      elsif v_key = 'uiTheme' then
        if jsonb_typeof(v_val) <> 'string' or not ((v_val #>> '{}') in ('light','night','forest')) then
          raise exception 'Tema inválido.';
        end if;
      end if;

      v_new := jsonb_set(v_new, array[v_key], v_val, true);
    end if;
  end loop;

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
declare v_name text; v_today int; v_details jsonb;
begin
  perform public._require_cliente_owns(p_token, p_client_id);
  select subject_name into v_name from public._cliente_session(p_token);

  select count(*) into v_today from db_audit_log
  where actor_id = p_client_id and actor_role = 'cliente' and at > now() - interval '1 day';
  if v_today >= 100 then return true; end if;  -- tope diario silencioso (anti-spam)

  v_details := coalesce(p_entry -> 'details', '{}'::jsonb);
  if length(v_details::text) > 2000 then v_details := '{}'::jsonb; end if;

  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (p_client_id, left(coalesce(v_name, ''), 120), 'cliente',
    left(coalesce(p_entry->>'action', ''), 160), left(p_entry->>'entity_type', 60),
    left(p_entry->>'entity_label', 160), p_client_id, v_details);
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
  v_texto text := trim(coalesce(p_texto, ''));
  v_recent int;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if length(v_texto) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;
  if length(v_texto) > 1000 then
    raise exception 'El mensaje es demasiado largo (máx. 1000 caracteres).';
  end if;

  select count(*) into v_recent from db_notas_rows n
  where n.payload ->> 'clientId' = p_client_id
    and n.payload ->> 'source' = 'cliente'
    and public._safe_ts(n.payload ->> 'createdAt') > now() - interval '1 day';
  if v_recent >= 30 then
    raise exception 'Enviaste demasiados mensajes hoy. Contáctanos por WhatsApp.';
  end if;

  select payload->>'name' into v_client_name from db_clientes_rows where id = p_client_id;

  insert into db_notas_rows (id, payload, updated_at)
  values (
    v_id,
    jsonb_build_object(
      'text', v_texto, 'dueDate', get_business_date(),
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
  v_now_local timestamptz := now() at time zone get_company_timezone();
  v_addr_exists boolean;
  v_overrides jsonb;
  v_today date := get_server_date()::date;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha inválida.';
  end if;
  if p_date::date < v_today or p_date::date > v_today + 14 then
    raise exception 'Fecha fuera de rango.';
  end if;

  if extract(hour from v_now_local) >= 22 then
    raise exception 'Ya pasó el horario para cambiar la dirección (22:00 hora local).';
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

  -- Tope de 60 cambios guardados (se descartan los más viejos)
  if jsonb_array_length(v_overrides) > 60 then
    select coalesce(jsonb_agg(o order by o->>'date'), '[]'::jsonb) into v_overrides
    from (
      select o from jsonb_array_elements(v_overrides) o order by o->>'date' desc limit 60
    ) t(o);
  end if;

  update db_clientes_rows
    set payload = jsonb_set(payload, '{addressOverrides}', v_overrides, true),
        updated_at = now()
    where id = p_client_id;

  return v_overrides;
end;
$$;
revoke all on function public.set_client_address_override(text, text, text, text) from public;
grant execute on function public.set_client_address_override(text, text, text, text) to anon, authenticated;

-- Driver de la dirección activa del cliente, para mostrar "tu repartidor" en el portal…
create or replace function public.cliente_get_own_driver(p_token text, p_client_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_client db_clientes_rows%rowtype;
  v_route_id text;
  v_drivers jsonb;
  v_driver jsonb;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  select * into v_client from db_clientes_rows where id = p_client_id;
  if not found then return null; end if;

  select a->>'routeId' into v_route_id
  from jsonb_array_elements(coalesce(v_client.payload->'addresses', '[]'::jsonb)) a
  where a->>'id' = v_client.payload->>'activeAddressId'
  limit 1;

  if v_route_id is null or v_route_id = '' then return null; end if;

  select payload into v_drivers from db_personal where id = 'drivers';

  select d into v_driver
  from jsonb_array_elements(coalesce(v_drivers, '[]'::jsonb)) d
  where (d ->> 'routeId') = v_route_id
     or exists (
       select 1 from jsonb_array_elements_text(coalesce(d -> 'extraRouteIds', '[]'::jsonb)) x
       where x = v_route_id
     )
  limit 1;

  if v_driver is null then return null; end if;

  return jsonb_build_object(
    'firstName', v_driver ->> 'firstName',
    'lastName', v_driver ->> 'lastName',
    'photoUrl', v_driver ->> 'photoUrl'
  );
end;
$$;
revoke all on function public.cliente_get_own_driver(text, text) from public;
grant execute on function public.cliente_get_own_driver(text, text) to anon, authenticated;

-- 11. Datos iniciales
insert into db_clientes (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into db_personal (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into db_inventario (id, payload) values ('main', '{}'::jsonb) on conflict (id) do nothing;

-- 12. Limpieza automática (pg_cron)
do $do$
begin
  perform cron.unschedule('delivery-status-cleanup')
  where exists (select 1 from cron.job where jobname = 'delivery-status-cleanup');

  perform cron.schedule(
    'delivery-status-cleanup',
    '0 1 * * *',
    $cron$ delete from public.db_delivery_status where date < (current_date - interval '2 years'); $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de delivery_status (revisa permisos/pg_cron).';
end $do$;

-- Snapshots de días procesados (Sueldos): mismo criterio de 2 años
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

-- Movimientos de inventario (Cocina): a diferencia de las dos tablas de arriba, estos NO viven en una…
do $do$
begin
  perform cron.unschedule('trim-inventory-movements')
  where exists (select 1 from cron.job where jobname = 'trim-inventory-movements');

  perform cron.schedule(
    'trim-inventory-movements',
    '15 1 * * *',
    $cron$
      update db_inventario
      set payload = jsonb_set(
        payload,
        '{movements}',
        coalesce(
          (
            select jsonb_agg(m)
            from jsonb_array_elements(payload -> 'movements') as m
            where (m ->> 'date')::date >= (current_date - interval '2 years')
          ),
          '[]'::jsonb
        )
      )
      where id = 'main' and jsonb_typeof(payload -> 'movements') = 'array';
    $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de recorte de movimientos de inventario (revisa permisos/pg_cron).';
end $do$;

-- Fotos de respaldo de entrega ('delivery-proof/') y comprobantes de pago ('comprobantes/'): 15 días…
do $do$
begin
  perform cron.unschedule('borrar-fotos-viejas-storage')
  where exists (select 1 from cron.job where jobname = 'borrar-fotos-viejas-storage');

  perform cron.schedule(
    'borrar-fotos-viejas-storage',
    '0 2 * * *',
    $cron$
      delete from storage.objects
      where bucket_id in ('app-images', 'app-docs')
        and (name like 'delivery-proof/%' or name like 'comprobantes/%')
        and created_at < now() - interval '15 days';
    $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de fotos en Storage (revisa permisos/pg_cron).';
end $do$;

-- Clientes inactivos: a propósito NO hay cron acá
do $do$
begin
  perform cron.unschedule('borrar-clientes-inactivos')
  where exists (select 1 from cron.job where jobname = 'borrar-clientes-inactivos');
exception when others then null;
end $do$;

-- Sesiones de login vencidas: 6 meses de margen desde que expiraron (no desde que se crearon -- una…
do $do$
begin
  perform cron.unschedule('borrar-sesiones-vencidas')
  where exists (select 1 from cron.job where jobname = 'borrar-sesiones-vencidas');

  perform cron.schedule(
    'borrar-sesiones-vencidas',
    '30 1 * * *',
    $cron$ delete from public.db_sessions where expires_at < now() - interval '6 months'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de sesiones vencidas (revisa permisos/pg_cron).';
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
  perform cron.unschedule('limpiar-intentos-login-viejos')
  where exists (select 1 from cron.job where jobname = 'limpiar-intentos-login-viejos');

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

-- 13. Preferencias por cuenta (tema y orden de columnas)

-- STAFF: todas las preferencias del equipo viven en UNA fila db_personal(id='userPrefs'), como un…
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

-- Para LEER las propias preferencias no hace falta una función nueva: el genérico…

-- CLIENTES: se suma 'uiTheme' a la lista blanca de campos que un cliente puede tocar de su propia fila
grant execute on function public.cliente_save_profile(text, text, jsonb) to anon, authenticated;

-- 14. Storage cerrado a escritura pública: solo la Edge Function image-storage escribe (desplegarla ANTES)
drop policy if exists "app-images: subir" on storage.objects;
drop policy if exists "app-images: reemplazar" on storage.objects;
drop policy if exists "app-images: borrar" on storage.objects;

-- 15. Comprobantes de pago: verificación automática + renovación compartida
create table if not exists db_comprobantes_rows (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table db_comprobantes_rows enable row level security;
drop policy if exists "no direct access comprobantes" on db_comprobantes_rows;
create policy "no direct access comprobantes" on db_comprobantes_rows for all using (false) with check (false);

create index if not exists idx_comprobantes_estado on db_comprobantes_rows ((payload ->> 'estado'));
create index if not exists idx_comprobantes_client on db_comprobantes_rows ((payload ->> 'clientId'));

-- _aplicar_renovacion: ÚNICA implementación de renovar/cambiar de plan, sacada de ClientsPage.jsx…
create or replace function public._aplicar_renovacion(
  p_client_id text,
  p_plan_id text,
  p_dias int,
  p_modo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row db_clientes_rows%rowtype;
  v_payload jsonb;
  v_paid_days numeric;
  v_consumed_days numeric;
  v_same_plan boolean;
  v_has_remaining boolean;
  v_pending jsonb;
  v_threshold numeric;
  v_new_items jsonb;
begin
  if p_dias is null or p_dias < 1 then
    raise exception 'Los días a agregar tienen que ser al menos 1.';
  end if;

  select * into v_row from db_clientes_rows where id = p_client_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  v_payload := v_row.payload;
  v_paid_days := coalesce((v_payload ->> 'paidDays')::numeric, 0);
  v_consumed_days := coalesce((v_payload ->> 'consumedDays')::numeric, 0);
  v_same_plan := (p_plan_id is null or p_plan_id = '' or p_plan_id = (v_payload ->> 'planId'));
  v_has_remaining := v_paid_days > v_consumed_days;

  if v_same_plan then
    v_paid_days := v_paid_days + p_dias;
    v_payload := jsonb_set(v_payload, '{paidDays}', to_jsonb(v_paid_days), true);

    if (v_payload -> 'pendingPlan') is not null and (v_payload -> 'pendingPlan') <> 'null'::jsonb then
      v_pending := v_payload -> 'pendingPlan';
      v_pending := jsonb_set(
        v_pending, '{activateAtConsumedDays}',
        to_jsonb(coalesce((v_pending ->> 'activateAtConsumedDays')::numeric, 0) + p_dias), true
      );
      v_payload := jsonb_set(v_payload, '{pendingPlan}', v_pending, true);
    end if;

  elsif v_has_remaining and p_modo = 'carry' then
    v_threshold := v_paid_days;
    v_paid_days := v_paid_days + p_dias;
    v_payload := jsonb_set(v_payload, '{paidDays}', to_jsonb(v_paid_days), true);
    v_payload := jsonb_set(
      v_payload, '{pendingPlan}',
      jsonb_build_object('planId', p_plan_id, 'activateAtConsumedDays', v_threshold),
      true
    );

  else
    select (p -> 'items') into v_new_items
    from db_clientes, jsonb_array_elements(payload) p
    where db_clientes.id = 'plans' and p ->> 'id' = p_plan_id
    limit 1;

    v_payload := jsonb_set(v_payload, '{planId}', to_jsonb(p_plan_id), true);
    v_payload := jsonb_set(v_payload, '{items}', coalesce(v_new_items, '{}'::jsonb), true);
    v_paid_days := v_paid_days + p_dias;
    v_payload := jsonb_set(v_payload, '{paidDays}', to_jsonb(v_paid_days), true);
    v_payload := jsonb_set(v_payload, '{pendingPlan}', 'null'::jsonb, true);
  end if;

  if (v_payload ->> 'status') in ('Pausado', 'Retorno pendiente') then
    v_payload := jsonb_set(v_payload, '{status}', '"Activo"', true);
    v_payload := jsonb_set(v_payload, '{pauseStart}', '""', true);
    v_payload := jsonb_set(v_payload, '{pauseDates}', '[]'::jsonb, true);
  end if;

  update db_clientes_rows set payload = v_payload, updated_at = now() where id = p_client_id;
  return v_payload;
end;
$$;
revoke all on function public._aplicar_renovacion(text, text, int, text) from public;
grant execute on function public._aplicar_renovacion(text, text, int, text) to service_role;

create or replace function public.staff_aplicar_renovacion(
  p_token text, p_client_id text, p_plan_id text, p_dias int, p_modo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_permission(p_token, 'clients');
  return public._aplicar_renovacion(p_client_id, p_plan_id, p_dias, coalesce(p_modo, 'immediate'));
end;
$$;
revoke all on function public.staff_aplicar_renovacion(text, text, text, int, text) from public;
grant execute on function public.staff_aplicar_renovacion(text, text, text, int, text) to anon, authenticated;

create or replace function public.cliente_crear_comprobante(
  p_token text, p_client_id text, p_texto text, p_tipo text,
  p_plan_id text, p_plan_nombre text, p_dias int, p_monto_esperado numeric,
  p_storage_path text, p_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_comprobante_id text := 'cp_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  v_note_id text := 'n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  v_client db_clientes_rows%rowtype;
  v_plan jsonb;
  v_cost numeric;
  v_dias int;
  v_plan_name text;
  v_prefix text := 'comprobantes/' || p_client_id || '_';
  v_recent int;
  v_mime text;
  v_texto text := left(trim(coalesce(p_texto, '')), 600);
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_tipo not in ('renovacion', 'plan_nuevo') then
    raise exception 'Tipo de solicitud inválido.';
  end if;
  if length(v_texto) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;

  -- El archivo tiene que ser uno subido por ESTE cliente
  if p_storage_path is null
     or left(p_storage_path, length(v_prefix)) <> v_prefix
     or substr(p_storage_path, length(v_prefix) + 1) !~ '^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$' then
    raise exception 'Comprobante inválido.';
  end if;
  if exists (select 1 from db_comprobantes_rows c where c.payload ->> 'storagePath' = p_storage_path) then
    raise exception 'Ese comprobante ya fue enviado.';
  end if;
  v_mime := case when lower(p_storage_path) like '%.pdf' then 'application/pdf'
                 when lower(p_storage_path) like '%.png' then 'image/png'
                 when lower(p_storage_path) like '%.webp' then 'image/webp'
                 else 'image/jpeg' end;

  select count(*) into v_recent from db_comprobantes_rows c
  where c.payload ->> 'clientId' = p_client_id
    and public._safe_ts(c.payload ->> 'createdAt') > now() - interval '1 day';
  if v_recent >= 5 then
    raise exception 'Llegaste al máximo de comprobantes por día. Contáctanos por WhatsApp.';
  end if;

  select * into v_client from db_clientes_rows where id = p_client_id;
  if not found then raise exception 'Cliente no encontrado.'; end if;

  -- Plan, monto y días: SIEMPRE del catálogo del servidor
  select p into v_plan
  from db_clientes c,
       jsonb_array_elements(case when jsonb_typeof(c.payload) = 'array' then c.payload else '[]'::jsonb end) p
  where c.id = 'plans' and p ->> 'id' = p_plan_id
  limit 1;
  if v_plan is null then raise exception 'Plan no encontrado.'; end if;

  if p_tipo = 'renovacion' then
    if p_plan_id is distinct from (v_client.payload ->> 'planId') then
      raise exception 'Solo puedes renovar tu plan actual.';
    end if;
  else
    if not coalesce((v_plan ->> 'availableForPurchase')::boolean, false) then
      raise exception 'Ese plan no está disponible.';
    end if;
  end if;

  v_cost := coalesce((v_plan ->> 'cost')::numeric, 0);
  if v_cost <= 0 then raise exception 'Este plan no tiene un costo definido. Contáctanos por WhatsApp.'; end if;
  v_dias := greatest(1, round(coalesce((v_plan ->> 'serviceDays')::numeric, 1))::int);
  v_plan_name := coalesce(v_plan ->> 'name', '');

  insert into db_notas_rows (id, payload, updated_at)
  values (
    v_note_id,
    jsonb_build_object(
      'text', v_texto || ' | Sistema: plan "' || v_plan_name || '", Bs ' || v_cost || ', ' || v_dias || ' días.',
      'dueDate', get_business_date(),
      'status', 'pendiente', 'source', 'cliente', 'clientId', p_client_id,
      'clientName', coalesce(v_client.payload ->> 'name', ''), 'createdAt', now(), 'read', false
    ),
    now()
  );

  insert into db_comprobantes_rows (id, payload, updated_at)
  values (
    v_comprobante_id,
    jsonb_build_object(
      'clientId', p_client_id, 'clientName', coalesce(v_client.payload ->> 'name', ''),
      'noteId', v_note_id, 'tipo', p_tipo, 'planId', p_plan_id, 'planNombre', v_plan_name,
      'dias', v_dias, 'montoEsperado', v_cost, 'modo', 'carry',
      'storagePath', p_storage_path, 'mimeType', v_mime,
      'estado', 'pendiente_lectura', 'createdAt', now()
    ),
    now()
  );

  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (p_client_id, coalesce(v_client.payload ->> 'name', ''), 'cliente',
    case when p_tipo = 'plan_nuevo' then 'Envió comprobante de compra de plan' else 'Envió comprobante de renovación' end,
    'comprobante', v_plan_name, v_comprobante_id,
    jsonb_build_object('plan', v_plan_name, 'monto', v_cost, 'dias', v_dias));

  return jsonb_build_object('comprobanteId', v_comprobante_id, 'noteId', v_note_id);
end;
$$;
revoke all on function public.cliente_crear_comprobante(text, text, text, text, text, text, int, numeric, text, text) from public;
grant execute on function public.cliente_crear_comprobante(text, text, text, text, text, text, int, numeric, text, text) to anon;

create or replace function public.staff_listar_comprobantes(p_token text)
returns table(id text, payload jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if not public._staff_can_view(v_role, 'notes') then return; end if;
  return query select r.id, r.payload, r.updated_at from db_comprobantes_rows r order by r.updated_at desc;
end;
$$;
revoke all on function public.staff_listar_comprobantes(text) from public;
grant execute on function public.staff_listar_comprobantes(text) to anon, authenticated;

create or replace function public.staff_marcar_comprobante_revisado(
  p_token text, p_comprobante_id text, p_aprobado boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_row db_comprobantes_rows%rowtype;
  v_payload jsonb;
begin
  select * into v_actor from public._require_permission(p_token, 'notes');

  select * into v_row from db_comprobantes_rows where id = p_comprobante_id;
  if not found then raise exception 'Comprobante no encontrado.'; end if;
  if (v_row.payload ->> 'estado') not in ('pendiente_revision', 'pendiente_lectura') then
    raise exception 'Este comprobante ya fue procesado.';
  end if;

  if p_aprobado then
    perform public._aplicar_renovacion(
      v_row.payload ->> 'clientId', v_row.payload ->> 'planId',
      (v_row.payload ->> 'dias')::int, coalesce(v_row.payload ->> 'modo', 'carry')
    );
    v_payload := jsonb_set(v_row.payload, '{estado}', '"aprobado_manual"', true);
  else
    v_payload := jsonb_set(v_row.payload, '{estado}', '"rechazado"', true);
  end if;

  v_payload := v_payload || jsonb_build_object('revisadoPor', v_actor.subject_name, 'revisadoAt', now());
  update db_comprobantes_rows set payload = v_payload, updated_at = now() where id = p_comprobante_id;

  if p_aprobado and (v_row.payload ? 'noteId') then
    update db_notas_rows set
      payload = payload || jsonb_build_object(
        'status', 'cumplida', 'completedAt', get_business_date(),
        'autoApproved', false, 'waPending', true,
        'waPlanName', v_row.payload ->> 'planNombre', 'waDays', v_row.payload -> 'dias',
        'waKind', case when v_row.payload ->> 'tipo' = 'plan_nuevo' then 'compra' else 'renovacion' end
      ),
      updated_at = now()
    where id = v_row.payload ->> 'noteId';
  end if;

  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (v_actor.subject_id, v_actor.subject_name, v_actor.role,
    case when p_aprobado then 'Aprobó un comprobante y renovó el plan' else 'Rechazó un comprobante' end,
    'comprobante', v_row.payload ->> 'clientName', p_comprobante_id,
    jsonb_build_object('cliente', v_row.payload ->> 'clientName', 'plan', v_row.payload ->> 'planNombre'));

  return v_payload;
end;
$$;
revoke all on function public.staff_marcar_comprobante_revisado(text, text, boolean) from public;
grant execute on function public.staff_marcar_comprobante_revisado(text, text, boolean) to anon, authenticated;

do $do$
begin
  perform cron.unschedule('rescatar-comprobantes-atascados')
  where exists (select 1 from cron.job where jobname = 'rescatar-comprobantes-atascados');

  perform cron.schedule(
    'rescatar-comprobantes-atascados',
    '*/10 * * * *',
    $cron$
      update db_comprobantes_rows
      set payload = payload || jsonb_build_object(
            'estado', 'pendiente_revision',
            'motivoError', 'La verificación automática no terminó a tiempo (el cliente pudo haber cerrado la app antes de que termine).'
          ),
          updated_at = now()
      where payload ->> 'estado' in ('pendiente_lectura', 'procesando')
        and updated_at < now() - interval '10 minutes';
    $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de rescate de comprobantes atascados (revisa permisos/pg_cron).';
end $do$;

-- Las referencias de operación se guardan 400 días (para detectar reuso)
do $do$
begin
  perform cron.unschedule('borrar-comprobantes-viejos')
  where exists (select 1 from cron.job where jobname = 'borrar-comprobantes-viejos');

  perform cron.schedule(
    'borrar-comprobantes-viejos',
    '10 2 * * *',
    $cron$ delete from public.db_comprobantes_rows where updated_at < now() - interval '15 days'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de comprobantes (revisa permisos/pg_cron).';
end $do$;

-- 16. Menú semanal (web pública + edición desde el Panel)
create table if not exists public.db_menu_semanal (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.db_menu_semanal enable row level security;
drop policy if exists "no direct access menu semanal" on public.db_menu_semanal;
create policy "no direct access menu semanal" on public.db_menu_semanal for all using (false) with check (false);

create or replace function public.get_menu_semanal()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(payload, '{}'::jsonb) from public.db_menu_semanal where id = 'main';
$$;
revoke all on function public.get_menu_semanal() from public;
grant execute on function public.get_menu_semanal() to anon, authenticated;

create or replace function public.staff_save_menu_semanal(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
begin
  select * into v_actor from public._require_permission(p_token, 'menu');

  insert into public.db_menu_semanal (id, payload, updated_at)
  values ('main', coalesce(p_payload, '{}'::jsonb), now())
  on conflict (id) do update set payload = excluded.payload, updated_at = now();

  insert into public.db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, details)
  values (v_actor.subject_id, coalesce(v_actor.subject_name, ''), v_actor.role,
    'Editó el Menú Semanal', 'menu', 'Menú Semanal', '{}'::jsonb);

  return coalesce(p_payload, '{}'::jsonb);
end;
$$;
revoke all on function public.staff_save_menu_semanal(text, jsonb) from public;
grant execute on function public.staff_save_menu_semanal(text, jsonb) to anon, authenticated;

-- 17. Auto-registro de clientes desde el Login
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
  v_name   text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_address text := regexp_replace(trim(coalesce(p_address, '')), '\s+', ' ', 'g');
  v_attempt public.db_client_login_attempts%rowtype;
  v_global  public.db_client_login_attempts%rowtype;
  v_exists boolean;
  v_id text;
  v_token text;
  v_new_fail_count int;
  v_note_due_date text;
  v_recent int;
begin
  -- Freno global contra "barridos" de carnets (adivinar quién ya es cliente)
  select * into v_global from public.db_client_login_attempts where carnet = '__signup_probe__';
  if found and v_global.locked_until is not null and v_global.locked_until > now() then
    return query select null::text, null::text,
      greatest(ceil(extract(epoch from (v_global.locked_until - now())))::int, 1),
      null::text, null::text;
    return;
  end if;

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

  if length(v_carnet) < 5 or length(v_carnet) > 20 or v_carnet !~ '^[a-z0-9 -]+$' then
    return query select null::text, null::text, 0, null::text,
      'El carnet no tiene un formato válido.'::text;
    return;
  end if;
  if length(v_phone) < 7 or length(v_phone) > 15 then
    return query select null::text, null::text, 0, null::text,
      'El teléfono no tiene un formato válido.'::text;
    return;
  end if;
  if length(v_name) < 3 or length(v_name) > 80 then
    return query select null::text, null::text, 0, null::text,
      'El nombre debe tener entre 3 y 80 caracteres.'::text;
    return;
  end if;
  if length(v_address) > 200 then
    return query select null::text, null::text, 0, null::text,
      'La dirección es demasiado larga (máx. 200 caracteres).'::text;
    return;
  end if;

  -- Tope de registros nuevos por hora (protege contra cuentas basura)
  select count(*) into v_recent
  from db_clientes_rows r
  where r.payload ->> 'selfSignup' = 'true'
    and r.updated_at > now() - interval '1 hour'
    and public._safe_ts(r.payload ->> 'createdAt') > now() - interval '1 hour';
  if v_recent >= 30 then
    return query select null::text, null::text, 0, null::text,
      'Hay demasiados registros nuevos en este momento. Intenta más tarde o contacta al equipo.'::text;
    return;
  end if;

  select exists(
    select 1 from db_clientes_rows r
    where lower(trim(coalesce(r.payload ->> 'carnet', ''))) = v_carnet
  ) into v_exists;

  if v_exists then
    -- por carnet (igual que antes)
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
    -- y global: 10 carnets ya registrados probados seguidos => 5 min de freno
    v_new_fail_count := coalesce(v_global.fail_count, 0) + 1;
    if v_new_fail_count >= 10 then
      insert into public.db_client_login_attempts (carnet, fail_count, locked_until, last_attempt)
        values ('__signup_probe__', 0, now() + interval '5 minutes', now())
      on conflict (carnet) do update
        set fail_count = 0, locked_until = now() + interval '5 minutes', last_attempt = now();
    else
      insert into public.db_client_login_attempts (carnet, fail_count, locked_until, last_attempt)
        values ('__signup_probe__', v_new_fail_count, null, now())
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

  v_note_due_date := get_business_date()::text;

  insert into db_notas_rows (id, payload, updated_at)
  values (
    'n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    jsonb_build_object(
      'text', 'Cliente nuevo autorregistrado desde el login: ' || v_name || ' (tel. ' || v_phone || ')'
        || case when v_address <> '' then '. Dirección indicada: ' || v_address else '. No indicó dirección.' end
        || ' Falta asignarle ruta, plan y revisar/completar sus datos.',
      'dueDate', v_note_due_date,
      'status', 'pendiente',
      'source', 'signup',
      'clientId', v_id,
      'clientName', v_name,
      'createdAt', now(),
      'read', false
    ),
    now()
  );

  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (v_id, v_name, 'cliente', 'Se autorregistró desde el login', 'cliente', v_name, v_id, '{}'::jsonb);

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into db_sessions (token, subject_type, subject_id, subject_name, role)
  values (v_token, 'cliente', v_id, v_name, null);

  return query select v_id, v_name, 0, v_token, null::text;
end;
$$;
revoke all on function public.signup_cliente(text, text, text, text) from public;
grant execute on function public.signup_cliente(text, text, text, text) to anon, authenticated;

-- 18. Notificaciones push (recordatorio de plan)
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

-- Versión anterior: un trigger reprogramaba el aviso diario según settings.pushReminderHour. Ya no hace falta:
-- el cron nuevo (abajo) corre cada minuto y lee la configuración completa.
drop trigger if exists trg_reschedule_push_reminder_cron on public.db_personal;
drop function if exists public._reschedule_push_reminder_cron();

-- 18b. Recordatorio automático configurable.
-- Qué se manda y a quién se define en el Panel (Publicidad → Recordatorio
-- automático, guardado en settings.pushReminder): hora y minutos, días de la
-- semana, destinatarios (clientes activos con pocos días de plan / todos los
-- activos / clientes elegidos) y el texto. Un cron corre CADA MINUTO, se fija
-- si toca según esa configuración (en la zona horaria de la empresa) y solo
-- entonces llama a la Edge Function send-push.
create table if not exists public.db_push_reminder_state (
  id text primary key default 'main',
  last_sent_on date
);
alter table public.db_push_reminder_state enable row level security;
drop policy if exists "no direct access push reminder state" on public.db_push_reminder_state;
create policy "no direct access push reminder state" on public.db_push_reminder_state for all using (false) with check (false);

-- Configuración efectiva: lo guardado en el Panel + valores por defecto
-- (todos los días a las 09:00, clientes activos con 1 a 3 días de plan).
create or replace function public.get_push_reminder_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_settings jsonb;
  v_cfg jsonb;
  v_time text;
  v_days jsonb;
  v_mode text;
begin
  select payload into v_settings from public.db_personal where id = 'settings';
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_cfg := coalesce(v_settings -> 'pushReminder', '{}'::jsonb);

  v_time := v_cfg ->> 'time';
  if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    -- Compatibilidad: antes solo se guardaba la hora en punto (pushReminderHour)
    v_time := case
      when (v_settings ->> 'pushReminderHour') ~ '^[0-9]{1,2}$' and (v_settings ->> 'pushReminderHour')::int between 0 and 23
        then lpad(v_settings ->> 'pushReminderHour', 2, '0') || ':00'
      else '09:00'
    end;
  end if;

  v_days := v_cfg -> 'days';
  if v_days is null or jsonb_typeof(v_days) <> 'array' then
    v_days := '[0,1,2,3,4,5,6]'::jsonb;  -- 0 = domingo ... 6 = sábado
  end if;

  v_mode := coalesce(v_cfg ->> 'mode', 'expiring');
  if v_mode not in ('expiring', 'all_active', 'selected') then
    v_mode := 'expiring';
  end if;

  return jsonb_build_object(
    'enabled', case when (v_cfg ->> 'enabled') in ('true', 'false') then (v_cfg ->> 'enabled')::boolean else true end,
    'time', v_time,
    'days', v_days,
    'mode', v_mode,
    'minDays', case when (v_cfg ->> 'minDays') ~ '^[0-9]{1,3}$' then (v_cfg ->> 'minDays')::int else 1 end,
    'maxDays', case when (v_cfg ->> 'maxDays') ~ '^[0-9]{1,3}$' then greatest(1, (v_cfg ->> 'maxDays')::int) else 3 end,
    'clientIds', case when jsonb_typeof(v_cfg -> 'clientIds') = 'array' then v_cfg -> 'clientIds' else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.get_push_reminder_config() from public;
grant execute on function public.get_push_reminder_config() to service_role;

-- A quién le toca el recordatorio según esa configuración.
create or replace function public.get_push_reminder_targets()
returns table(client_id text, name text, remaining int)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cfg jsonb := public.get_push_reminder_config();
  v_mode text := v_cfg ->> 'mode';
begin
  return query
  select
    r.id,
    r.payload ->> 'name',
    greatest(0, coalesce((r.payload ->> 'paidDays')::int, 0) - coalesce((r.payload ->> 'consumedDays')::int, 0))
  from public.db_clientes_rows r
  where case v_mode
    when 'selected' then r.id in (select jsonb_array_elements_text(v_cfg -> 'clientIds'))
    when 'all_active' then coalesce(r.payload ->> 'status', 'Activo') = 'Activo'
    else coalesce(r.payload ->> 'status', 'Activo') = 'Activo'
      and greatest(0, coalesce((r.payload ->> 'paidDays')::int, 0) - coalesce((r.payload ->> 'consumedDays')::int, 0))
          between (v_cfg ->> 'minDays')::int and (v_cfg ->> 'maxDays')::int
  end;
end;
$$;
revoke all on function public.get_push_reminder_targets() from public;
grant execute on function public.get_push_reminder_targets() to service_role;

-- La llama el cron cada minuto: manda el recordatorio UNA vez por día, dentro
-- de los 10 minutos siguientes a la hora configurada (así un minuto perdido
-- no lo deja sin enviar) y solo en los días elegidos.
create or replace function public.run_push_reminder(p_url text, p_secret text default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg jsonb := public.get_push_reminder_config();
  v_local timestamp := now() at time zone public.get_company_timezone();
  v_minutes_since numeric;
  -- Sin secreto explícito se usa el que se genera solo en db_secretos_internos (sección 20)
  v_secret text := coalesce(p_secret, (select valor from public.db_secretos_internos where clave = 'cron_secret'));
begin
  if not (v_cfg ->> 'enabled')::boolean then return 'desactivado'; end if;
  if not (v_cfg -> 'days') @> to_jsonb(extract(dow from v_local)::int) then return 'hoy no toca'; end if;

  v_minutes_since := extract(epoch from (v_local::time - (v_cfg ->> 'time')::time)) / 60;
  if v_minutes_since < 0 or v_minutes_since >= 10 then return 'no es la hora'; end if;

  if exists (select 1 from public.db_push_reminder_state where id = 'main' and last_sent_on = v_local::date) then
    return 'ya enviado hoy';
  end if;
  insert into public.db_push_reminder_state (id, last_sent_on) values ('main', v_local::date)
  on conflict (id) do update set last_sent_on = excluded.last_sent_on;

  perform net.http_post(
    url := p_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('action', 'cron')
  );
  return 'enviado';
end;
$$;
revoke all on function public.run_push_reminder(text, text) from public;

-- Programación. Antes había un cron diario a las 13:00 UTC ('push-recordatorio-plan-diario'):
-- si existe, se pasa al nuevo (cada minuto) CONSERVANDO su URL y su secreto, y se da de baja.
-- Empresa nueva: reemplaza <PROJECT_REF> (el "project ref" de Supabase) ANTES de correr esto; el
-- secreto no hace falta: se usa el que se genera solo en db_secretos_internos (sección 20).
do $push$
declare
  v_old text;
  v_url text;
  v_secret text;
begin
  if exists (select 1 from cron.job where jobname = 'push-recordatorio') then
    return;  -- ya instalado: no se pisa la URL ni el secreto que tenga
  end if;

  select command into v_old from cron.job where jobname = 'push-recordatorio-plan-diario';
  if v_old is not null then
    v_url := substring(v_old from 'url := ''([^'']+)''');
    v_secret := substring(v_old from '''x-cron-secret'', ''([^'']+)''');
    -- Si el secreto quedó como el placeholder sin reemplazar (<CRON_SECRET>), ese aviso nunca funcionó: se usa el secreto interno
    if v_secret is null or v_secret like '<%>' then v_secret := null; end if;
  end if;

  perform cron.schedule(
    'push-recordatorio',
    '* * * * *',
    case
      when v_secret is not null then format('select public.run_push_reminder(%L, %L)', v_url, v_secret)
      else format('select public.run_push_reminder(%L)', coalesce(v_url, 'https://<PROJECT_REF>.functions.supabase.co/send-push'))
    end
  );

  if v_old is not null then
    perform cron.unschedule('push-recordatorio-plan-diario');
  end if;
end;
$push$;

-- 19. Endurecimiento de seguridad

set search_path = public, extensions;

-- Utilidades internas

-- Convierte texto a fecha/hora sin romper nunca (devuelve NULL si no es una fecha)
create or replace function public._safe_ts(p text)
returns timestamptz
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public._safe_ts(text) from public;

-- Roles a medida (Usuarios -> Roles): viven en la fila 'settings'; se deja como respaldo la ubicación…
create or replace function public._custom_roles()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select case when jsonb_typeof(payload -> 'customRoles') = 'array' then payload -> 'customRoles' end
       from db_personal where id = 'settings'),
    (select case when jsonb_typeof(payload -> 'settings' -> 'customRoles') = 'array' then payload -> 'settings' -> 'customRoles' end
       from db_personal where id = 'main'),
    '[]'::jsonb
  );
$$;
revoke all on function public._custom_roles() from public;

revoke all on function public._require_permission(text, text) from public;

-- Limpia un array de staffUsers para mandarlo al navegador: nunca sale un hash
create or replace function public._sanitize_staff_users(p_payload jsonb, p_role text)
returns jsonb
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_role not in ('admin', 'superadmin') then '[]'::jsonb
    when p_payload is null or jsonb_typeof(p_payload) <> 'array' then '[]'::jsonb
    else coalesce(
      (select jsonb_agg(
         (u - 'passwordHash') || jsonb_build_object('hasPassword', coalesce(u ->> 'passwordHash', '') <> '')
       ) from jsonb_array_elements(p_payload) u),
      '[]'::jsonb)
  end;
$$;
revoke all on function public._sanitize_staff_users(jsonb, text) from public;

-- ¿Puede este rol VER la página indicada?
create or replace function public._staff_can_view(p_role text, p_page text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_ok boolean;
begin
  if p_role in ('admin', 'superadmin') then return true; end if;
  if p_role = 'editor' then return p_page <> 'audit' and p_page <> 'users'; end if;
  if p_role in ('kitchen', 'driver') then return false; end if;
  select coalesce((r -> 'pages' -> p_page ->> 'view')::boolean, false) into v_ok
  from jsonb_array_elements(public._custom_roles()) r
  where r ->> 'id' = p_role
  limit 1;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public._staff_can_view(text, text) from public;

-- Bloqueo por lock de páginas Premium: valor efectivo de cada página (si no está en la configuración…
create or replace function public._premium_page_locked(p_settings jsonb, p_page text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(
    (p_settings -> 'premiumLockedPages' ->> p_page)::boolean,
    p_page <> 'delivery'
  );
$$;
revoke all on function public._premium_page_locked(jsonb, text) from public;

-- Sesión de staff: dura 7 días (deslizantes) y la sesión "de arranque"
revoke all on function public._staff_session(text) from public;

-- login_cliente: nunca comparar contra vacío
grant execute on function login_cliente(text, text) to anon, authenticated;

-- signup_cliente: validación de datos + freno global
grant execute on function public.signup_cliente(text, text, text, text) to anon, authenticated;

-- Lecturas públicas: solo lo que de verdad necesitan el login y el portal
revoke all on function hash_password(text) from anon, authenticated;

create or replace function public.staff_hash_password(p_token text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_role text;
begin
  select s.role into v_role from public._staff_session(p_token) s;
  if v_role not in ('admin', 'superadmin') then
    raise exception 'Solo un administrador puede definir contraseñas.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres.';
  end if;
  return crypt(p_password, gen_salt('bf', 10));
end;
$$;
revoke all on function public.staff_hash_password(text, text) from public;
grant execute on function public.staff_hash_password(text, text) to anon, authenticated;

grant execute on function public.staff_get_fields(text, text, text[]) to anon, authenticated;

-- staff_set_fields: solo claves conocidas, permisos también en el
grant execute on function public.staff_set_fields(text, text, jsonb) to anon, authenticated;

-- login_staff: bloqueo que escala (1, 2, 4, 8 
grant execute on function login_staff(text, text) to anon, authenticated;

-- Lecturas sensibles solo para quien puede ver esa página
grant execute on function public.staff_listar_comprobantes(text) to anon, authenticated;

-- Funciones del portal del cliente: validar y acotar lo que manda el navegador
create index if not exists idx_notas_client on db_notas_rows ((payload ->> 'clientId'));

grant execute on function public.set_client_address_override(text, text, text, text) to anon, authenticated;

-- Comprobantes de pago: el monto, los días y el plan salen SIEMPRE del
create table if not exists public.db_comprobantes_refs (
  referencia text primary key,
  client_id  text,
  created_at timestamptz not null default now()
);
alter table public.db_comprobantes_refs enable row level security;
drop policy if exists "no direct access comprobantes refs" on public.db_comprobantes_refs;
create policy "no direct access comprobantes refs" on public.db_comprobantes_refs for all using (false) with check (false);

-- Solo la Edge Function (service_role) la usa
create or replace function public._registrar_referencia_comprobante(p_ref text, p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_ref text := lower(regexp_replace(coalesce(p_ref, ''), '[^a-zA-Z0-9]', '', 'g')); v_n int;
begin
  if length(v_ref) < 6 then return false; end if;
  insert into public.db_comprobantes_refs (referencia, client_id) values (v_ref, p_client_id)
  on conflict (referencia) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public._registrar_referencia_comprobante(text, text) from public;
grant execute on function public._registrar_referencia_comprobante(text, text) to service_role;

grant execute on function public.cliente_crear_comprobante(text, text, text, text, text, text, int, numeric, text, text) to anon;

-- Cron de rescate: ahora también rescata los que quedaron "procesando"
do $do$
begin
  perform cron.unschedule('borrar-referencias-comprobantes-viejas')
  where exists (select 1 from cron.job where jobname = 'borrar-referencias-comprobantes-viejas');

  perform cron.schedule(
    'borrar-referencias-comprobantes-viejas',
    '20 2 * * *',
    $cron$ delete from public.db_comprobantes_refs where created_at < now() - interval '400 days'; $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de limpieza de referencias de comprobantes.';
end $do$;

-- Versión vieja de crear_nota_cliente (con p_meta): sin límites de tamaño ni de cantidad, ya no se usa
drop function if exists public.crear_nota_cliente(text, text, text, jsonb);

-- Storage: sin listado público del bucket + solo imágenes/PDF de hasta 15 MB
drop policy if exists "app-images: lectura pública" on storage.objects;

update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id in ('app-images', 'app-docs');

-- 20. Cierre automático del día (22:00 hora de la empresa; lo ejecuta la Edge Function cerrar-dia-automatico)
create table if not exists public.db_secretos_internos (
  clave text primary key,
  valor text not null
);
alter table public.db_secretos_internos enable row level security;
drop policy if exists "no direct access secretos internos" on public.db_secretos_internos;
create policy "no direct access secretos internos" on public.db_secretos_internos for all using (false) with check (false);

-- Clave con la que pg_cron se identifica ante la Edge Function (se genera sola, una vez)
insert into public.db_secretos_internos (clave, valor)
values ('cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (clave) do nothing;

-- Aplica el cierre de un día en una sola transacción; falla entera si los datos cambiaron mientras tanto
create or replace function public._cerrar_dia_aplicar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_date date := (p ->> 'date')::date;
  v_n int;
begin
  update db_clientes set payload = p -> 'new_days', updated_at = now()
  where id = 'days' and payload = p -> 'expected_days';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'days_changed');
  end if;

  -- Suma 1 día consumido a cada cliente que paga el servicio (sobre el valor actual, sin pisar otros cambios).
  -- "charged_ids" excluye los "no entregado" por falla del personal: el día no se le cobra al cliente.
  update db_clientes_rows r set
    payload = jsonb_set(r.payload, '{consumedDays}', to_jsonb(
      case when r.payload ->> 'consumedDays' ~ '^-?[0-9]+(\.[0-9]+)?$' then (r.payload ->> 'consumedDays')::numeric else 0 end + 1), true),
    updated_at = now()
  where r.id in (select jsonb_array_elements_text(coalesce(p -> 'charged_ids', '[]'::jsonb)));

  if jsonb_typeof(p -> 'new_inventory') = 'object' then
    update db_inventario set payload = p -> 'new_inventory', updated_at = now()
    where id = 'main' and payload = p -> 'expected_inventory';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'El inventario cambió mientras se cerraba el día.'; end if;
  end if;

  insert into db_dispatch_snapshots (date, payload, created_at) values (v_date, p -> 'snapshot', now())
  on conflict (date) do update set payload = excluded.payload, created_at = now();

  insert into db_audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_label, entity_id, details)
  values (null, 'Cierre automático', 'sistema', p -> 'audit' ->> 'action', 'day', v_date::text, v_date::text,
    coalesce(p -> 'audit' -> 'details', '{}'::jsonb));

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public._cerrar_dia_aplicar(jsonb) from public, anon, authenticated;
grant execute on function public._cerrar_dia_aplicar(jsonb) to service_role;

-- Corre cada hora y solo llama a la función cuando en la empresa son las 22:00 (para cambiar la hora, edita el 22).
-- Empresa nueva: reemplaza <PROJECT_REF> (el "project ref" de Supabase) ANTES de correr esto. Si el job ya existe no se toca.
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'cierre-automatico-dia') then
    perform cron.schedule(
      'cierre-automatico-dia',
      '0 * * * *',
      $cron$
      select net.http_post(
        url := 'https://<PROJECT_REF>.functions.supabase.co/cerrar-dia-automatico',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select valor from public.db_secretos_internos where clave = 'cron_secret')),
        body := '{}'::jsonb
      )
      where extract(hour from now() at time zone public.get_company_timezone()) = 22;
      $cron$
    );
  end if;
end $do$;

-- 21. Aviso push a editores/administradores/superadmin cuando un cliente escribe una nota
-- desde su portal (al revés del "Recordatorio de plan" de la sección 18, que es de la empresa
-- hacia el cliente). Reusa el mismo par de claves VAPID y la misma Edge Function send-push,
-- con una acción nueva ('staff-note').
create table if not exists public.db_staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_push_subscriptions_user on public.db_staff_push_subscriptions(user_id);

alter table public.db_staff_push_subscriptions enable row level security;
drop policy if exists "no direct access staff push subscriptions" on public.db_staff_push_subscriptions;
create policy "no direct access staff push subscriptions" on public.db_staff_push_subscriptions for all using (false) with check (false);

-- Cada editor/admin/superadmin se suscribe a mano desde Configuración (botón "Activar en este
-- dispositivo"): no se pide permiso solo al entrar, como sí pasa con el recordatorio de clientes.
create or replace function public.staff_save_push_subscription(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_user_id text; v_role text;
begin
  select s.subject_id, s.role into v_user_id, v_role from public._staff_session(p_token) s;
  if v_role not in ('admin', 'editor', 'superadmin') then
    raise exception 'Tu rol no recibe este aviso.';
  end if;
  insert into public.db_staff_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_user_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function public.staff_save_push_subscription(text, text, text, text) from public;
grant execute on function public.staff_save_push_subscription(text, text, text, text) to anon, authenticated;

create or replace function public.staff_remove_push_subscription(p_token text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_user_id text;
begin
  select s.subject_id into v_user_id from public._staff_session(p_token) s;
  delete from public.db_staff_push_subscriptions where endpoint = p_endpoint and user_id = v_user_id;
end;
$$;
revoke all on function public.staff_remove_push_subscription(text, text) from public;
grant execute on function public.staff_remove_push_subscription(text, text) to anon, authenticated;

-- Se re-declara crear_nota_cliente (idéntica a la de la sección del Portal más arriba) solo
-- para agregar, al final, el aviso a editores/admins/superadmin cuando la nota viene del portal.
-- Empresa nueva: reemplaza <PROJECT_REF> igual que en las otras Edge Functions de este script.
create or replace function crear_nota_cliente(p_token text, p_client_id text, p_texto text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := 'n_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  v_client_name text;
  v_texto text := trim(coalesce(p_texto, ''));
  v_recent int;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if length(v_texto) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;
  if length(v_texto) > 1000 then
    raise exception 'El mensaje es demasiado largo (máx. 1000 caracteres).';
  end if;

  select count(*) into v_recent from db_notas_rows n
  where n.payload ->> 'clientId' = p_client_id
    and n.payload ->> 'source' = 'cliente'
    and public._safe_ts(n.payload ->> 'createdAt') > now() - interval '1 day';
  if v_recent >= 30 then
    raise exception 'Enviaste demasiados mensajes hoy. Contáctanos por WhatsApp.';
  end if;

  select payload->>'name' into v_client_name from db_clientes_rows where id = p_client_id;

  insert into db_notas_rows (id, payload, updated_at)
  values (
    v_id,
    jsonb_build_object(
      'text', v_texto, 'dueDate', get_business_date(),
      'status', 'pendiente', 'source', 'cliente', 'clientId', p_client_id,
      'clientName', coalesce(v_client_name, ''), 'createdAt', now(), 'read', false
    ),
    now()
  );

  -- Si esto falla (Edge Function caída, secreto mal puesto, etc.) la nota igual queda guardada:
  -- el aviso push es "mejor si llega", nunca debe bloquear al cliente escribiendo su nota.
  begin
    perform net.http_post(
      url := 'https://<PROJECT_REF>.functions.supabase.co/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', (select valor from public.db_secretos_internos where clave = 'cron_secret')),
      body := jsonb_build_object('action', 'staff-note', 'clientName', coalesce(v_client_name, ''), 'texto', v_texto)
    );
  exception when others then null;
  end;

  return v_id;
end;
$$;
revoke all on function crear_nota_cliente(text, text, text) from public;
grant execute on function crear_nota_cliente(text, text, text) to anon;

-- ============================================================================
-- Calificaciones del portal cliente (estrellas 1-5 + recomendaciones)
-- ----------------------------------------------------------------------------
-- Una calificación por cliente (el cliente puede actualizarla cuando quiera).
-- El staff ve el resumen y las recomendaciones de forma ANÓNIMA (sin client_id ni
-- nombre). Idempotente: safe para empresa nueva y para actualizar una existente.
-- ============================================================================

-- Tabla
create table if not exists public.db_ratings (
  client_id  text primary key,
  stars      int  not null check (stars between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists db_ratings_updated_idx on public.db_ratings (updated_at desc);

-- RLS cerrado (todo acceso pasa por las funciones SECURITY DEFINER de abajo)
alter table public.db_ratings enable row level security;
drop policy if exists "no direct access ratings" on public.db_ratings;
create policy "no direct access ratings" on public.db_ratings for all using (false) with check (false);

-- Cliente: guarda/actualiza SU propia calificación
create or replace function public.cliente_save_rating(
  p_token text, p_client_id text, p_stars int, p_comment text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_comment text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'La calificación debe ser entre 1 y 5 estrellas.';
  end if;

  v_comment := left(btrim(coalesce(p_comment, '')), 1000);
  if v_comment = '' then v_comment := null; end if;

  insert into public.db_ratings (client_id, stars, comment, created_at, updated_at)
  values (p_client_id, p_stars, v_comment, now(), now())
  on conflict (client_id) do update
    set stars = excluded.stars,
        comment = excluded.comment,
        updated_at = now();
  return true;
end;
$$;
revoke all on function public.cliente_save_rating(text, text, int, text) from public;
grant execute on function public.cliente_save_rating(text, text, int, text) to anon, authenticated;

-- Cliente: lee SU propia calificación (para precargar la tarjeta)
create or replace function public.cliente_get_own_rating(p_token text, p_client_id text)
returns table(stars int, comment text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_cliente_owns(p_token, p_client_id);
  return query
    select r.stars, r.comment, r.updated_at
    from public.db_ratings r
    where r.client_id = p_client_id;
end;
$$;
revoke all on function public.cliente_get_own_rating(text, text) from public;
grant execute on function public.cliente_get_own_rating(text, text) to anon, authenticated;

-- Staff: todas las calificaciones, ANÓNIMAS (sin client_id ni nombre).
-- Métricas calcula el promedio/distribución y lista las recomendaciones.
create or replace function public.staff_get_ratings(p_token text)
returns table(stars int, comment text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
  return query
    select r.stars, r.comment, r.updated_at
    from public.db_ratings r
    order by r.updated_at desc;
end;
$$;
revoke all on function public.staff_get_ratings(text) from public;
grant execute on function public.staff_get_ratings(text) to anon, authenticated;

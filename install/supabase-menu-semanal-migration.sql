-- =============================================================================
-- MIGRACIÓN: Menú Semanal (web pública + edición desde el Panel)
-- =============================================================================
-- Corré esto UNA VEZ en el SQL Editor de tu proyecto de Supabase. Es seguro
-- volver a correrlo (create table if not exists / create or replace).
--
-- Qué hace:
--   · Tabla db_menu_semanal: una sola fila (id = 'main') con el contenido
--     de los 7 días en payload (jsonb): { lun: {text, updatedAt,
--     updatedBy}, mar: {...}, ... , dom: {...} }.
--   · RLS cerrada desde el arranque, igual que el resto -- todo pasa por
--     las 2 funciones de abajo.
--   · get_menu_semanal(): lectura pública (anon), la usan tanto la web
--     pública del menú como el propio Panel para mostrar lo ya guardado.
--   · staff_save_menu_semanal(token, payload): requiere permiso de
--     edición sobre la página 'menu' (mismo mecanismo que 'notes',
--     'clients', etc. -- admin/editor siempre pueden, un rol a medida
--     necesita que se lo den desde Usuarios).
-- =============================================================================

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

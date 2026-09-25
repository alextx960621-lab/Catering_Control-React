-- Catering Control · restablece el usuario admin (admin@catering.local).
-- 1) Cambia 'PON-AQUI-TU-CONTRASEÑA-NUEVA' por la contraseña que quieras.
-- 2) Pega todo en el SQL Editor de Supabase, dale Run y entra con ese correo y esa contraseña.

set search_path = public, extensions;

do $$
declare
  v_password text := 'PON-AQUI-TU-CONTRASEÑA-NUEVA';
  v_users    jsonb;
begin
  select payload into v_users from db_personal where id = 'staffUsers';
  v_users := coalesce(v_users, '[]'::jsonb);

  -- Quita el admin anterior para no dejar dos copias
  select coalesce(jsonb_agg(u), '[]'::jsonb) into v_users
  from jsonb_array_elements(v_users) as u
  where lower(u ->> 'email') <> 'admin@catering.local';

  -- Lo agrega de nuevo con la contraseña hasheada
  v_users := v_users || jsonb_build_array(jsonb_build_object(
    'id', 'staff_admin',
    'username', 'admin',
    'email', 'admin@catering.local',
    'name', 'Administrador',
    'role', 'admin',
    'routeId', '',
    'driverId', '',
    'passwordHash', crypt(v_password, gen_salt('bf', 10))
  ));

  insert into db_personal (id, payload, updated_at) values ('staffUsers', v_users, now())
  on conflict (id) do update set payload = excluded.payload, updated_at = now();
end $$;

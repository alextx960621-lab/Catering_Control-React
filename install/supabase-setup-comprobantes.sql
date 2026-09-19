-- ============================================================================
-- Verificación automática de comprobantes de pago + renovación compartida
-- ============================================================================
-- Correr ESTE archivo DESPUÉS de install/supabase-setup-final.sql (asume que
-- ya existen: db_clientes_rows, db_notas_rows, db_clientes, _require_staff,
-- _require_permission, _require_cliente_owns, _cliente_session, get_server_date.
--
-- Qué agrega:
--   1. Tabla db_comprobantes_rows (mismo patrón id+payload que el resto).
--   2. _aplicar_renovacion(): ÚNICA implementación de la lógica de renovar/
--      cambiar de plan -- hoy esa lógica vive duplicada dentro de
--      ClientsPage.jsx (función confirmRenew, componente RenewPlanModal).
--      La saqué de ahí tal cual (mismas reglas de paidDays/pendingPlan/carry/
--      reactivar pausado) para que la use tanto el botón manual "Renovar"
--      (vía staff_aplicar_renovacion) como la verificación automática (vía
--      la Edge Function verificar-comprobante, con la service_role key).
--   3. cliente_crear_comprobante(): reemplaza a crear_nota_cliente para el
--      flujo de PlanChangeModal.jsx -- crea la nota de siempre (compatibilidad
--      con NotesPage.jsx) Y ADEMÁS una fila en db_comprobantes_rows con los
--      datos estructurados (monto esperado, plan, días) que necesita la
--      lectura automática para comparar.
--   4. staff_listar_comprobantes() / staff_marcar_comprobante_revisado():
--      para el panel de "Comprobantes" (cola de revisión manual).
--   5. Cron: borra filas de db_comprobantes_rows de más de 15 días -- el
--      archivo en Storage YA se borra solo a los 15 días (ver sección 13 de
--      supabase-setup-final.sql, job "borrar-fotos-viejas-storage", ya
--      cubre 'comprobantes/'); esto solo limpia la fila de metadata que
--      queda apuntando a un archivo que ya no existe.
--
-- Verificado contra la base real (proyecto "catering control react",
-- kkqcaiunetlikfyaldab) antes de aplicar: el bloque "clientes" son filas
-- separadas por campo (id='plans', id='days', id='currentDate', id='main'),
-- no una fila única -- _aplicar_renovacion ya está escrita para eso.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Tabla
-- --------------------------------------------------------------------------
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

-- --------------------------------------------------------------------------
-- 2. _aplicar_renovacion: lógica única de renovar / cambiar de plan
-- --------------------------------------------------------------------------
-- Replica EXACTO lo que hace confirmRenew() en ClientsPage.jsx:
--   - Mismo plan (p_plan_id vacío o igual al actual): suma p_dias a paidDays
--     (y a pendingPlan.activateAtConsumedDays si había uno encolado).
--   - Plan distinto CON saldo restante Y p_modo = 'carry': no cambia el plan
--     todavía -- deja pendingPlan = {planId, activateAtConsumedDays: <paidDays
--     actual>} y de todos modos suma los días pagados nuevos.
--   - Plan distinto sin saldo o con p_modo = 'immediate': cambia planId ya
--     mismo, trae los "items" del plan nuevo desde db_clientes.plans, limpia
--     pendingPlan.
--   - Si el cliente estaba Pausado/Retorno pendiente, lo reactiva.
-- Solo la puede llamar: staff_aplicar_renovacion (staff) o el service_role
-- (Edge Function verificar-comprobante) -- nunca directo con anon key.
create or replace function public._aplicar_renovacion(
  p_client_id text,
  p_plan_id text,
  p_dias int,
  p_modo text -- 'immediate' | 'carry'
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
    -- Cambio inmediato: trae los items del plan nuevo desde db_clientes.
    -- OJO: en este proyecto el bloque "clientes" no es una fila única
    -- id='main' con {plans,...} adentro -- son filas separadas por campo:
    -- id='plans' (payload = el array de planes directo), id='days',
    -- id='currentDate', id='main'. Verificado contra la base real.
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

-- Wrapper para el botón manual "Renovar" del staff (reemplaza el cálculo que
-- hoy hace confirmRenew() en el navegador y después manda con saveClients).
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

-- --------------------------------------------------------------------------
-- 3. cliente_crear_comprobante: sube la solicitud + el comprobante
-- --------------------------------------------------------------------------
-- p_texto: el mismo texto armado hoy en PlanChangeModal.jsx ("Solicitud de
-- plan: ..."), se guarda igual que antes en la nota para no romper
-- NotesPage.jsx. p_tipo: 'renovacion' | 'plan_nuevo'.
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
  v_client_name text;
begin
  perform public._require_cliente_owns(p_token, p_client_id);

  if p_tipo not in ('renovacion', 'plan_nuevo') then
    raise exception 'Tipo de solicitud inválido.';
  end if;
  if p_monto_esperado is null or p_monto_esperado <= 0 then
    raise exception 'Monto inválido.';
  end if;
  if p_texto is null or length(trim(p_texto)) = 0 then
    raise exception 'El mensaje no puede estar vacío';
  end if;

  select payload ->> 'name' into v_client_name from db_clientes_rows where id = p_client_id;

  insert into db_notas_rows (id, payload, updated_at)
  values (
    v_note_id,
    jsonb_build_object(
      'text', trim(p_texto), 'dueDate', get_server_date(),
      'status', 'pendiente', 'source', 'cliente', 'clientId', p_client_id,
      'clientName', coalesce(v_client_name, ''), 'createdAt', now(), 'read', false
    ),
    now()
  );

  insert into db_comprobantes_rows (id, payload, updated_at)
  values (
    v_comprobante_id,
    jsonb_build_object(
      'clientId', p_client_id, 'clientName', coalesce(v_client_name, ''),
      'noteId', v_note_id, 'tipo', p_tipo, 'planId', p_plan_id, 'planNombre', p_plan_nombre,
      'dias', p_dias, 'montoEsperado', p_monto_esperado, 'modo', 'carry',
      'storagePath', p_storage_path, 'mimeType', p_mime_type,
      'estado', 'pendiente_lectura', 'createdAt', now()
    ),
    now()
  );

  return jsonb_build_object('comprobanteId', v_comprobante_id, 'noteId', v_note_id);
end;
$$;
revoke all on function public.cliente_crear_comprobante(text, text, text, text, text, text, int, numeric, text, text) from public;
grant execute on function public.cliente_crear_comprobante(text, text, text, text, text, text, int, numeric, text, text) to anon;

-- --------------------------------------------------------------------------
-- 4. Panel de revisión ("Comprobantes")
-- --------------------------------------------------------------------------
create or replace function public.staff_listar_comprobantes(p_token text)
returns table(id text, payload jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._require_staff(p_token);
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
        'status', 'cumplida', 'completedAt', get_server_date(),
        'autoApproved', false, 'waPending', true,
        'waPlanName', v_row.payload ->> 'planNombre', 'waDays', v_row.payload -> 'dias',
        'waKind', case when v_row.payload ->> 'tipo' = 'plan_nuevo' then 'compra' else 'renovacion' end
      ),
      updated_at = now()
    where id = v_row.payload ->> 'noteId';
  end if;

  return v_payload;
end;
$$;
revoke all on function public.staff_marcar_comprobante_revisado(text, text, boolean) from public;
grant execute on function public.staff_marcar_comprobante_revisado(text, text, boolean) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 5. Cron: rescata comprobantes atascados en "pendiente_lectura"
-- --------------------------------------------------------------------------
-- verificar-comprobante corre en segundos normalmente, pero si el cliente
-- cierra la app/pestaña justo mientras se está leyendo, o la Edge Function
-- falla de una forma que no llega a actualizar la fila (corte de red,
-- timeout, etc.), el comprobante se queda en 'pendiente_lectura' para
-- siempre y nunca cae a la cola de revisión del staff. Este cron (cada 10
-- minutos, ventana bien generosa) lo detecta y lo pasa a
-- 'pendiente_revision' -- así siempre termina visible para alguien, nunca
-- desaparece en el limbo.
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
      where payload ->> 'estado' = 'pendiente_lectura'
        and updated_at < now() - interval '10 minutes';
    $cron$
  );
exception when others then
  raise notice 'No se pudo programar el cron de rescate de comprobantes atascados (revisa permisos/pg_cron).';
end $do$;

-- --------------------------------------------------------------------------
-- 6. Cron: limpia filas de comprobantes de más de 15 días (el archivo en
--    Storage ya lo borra el cron existente "borrar-fotos-viejas-storage").
-- --------------------------------------------------------------------------
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

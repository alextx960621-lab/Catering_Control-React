# CAMBIOS — registro de lo que cambia en Catering Control

Archivo de trabajo del repositorio maestro (`G:\catering control\Catering Control`).
Sirve para saber, en cada momento, **qué cambió** y **qué hay que hacer en las bases
que ya están en producción** para ponerlas al día.

## Reglas fijas

1. En `install/` solo puede haber **3 archivos SQL**:
   - `supabase-setup-final.sql` — instalación completa, fuente única de verdad.
   - `reset-admin-password.sql` — recuperación de acceso (una tarea, no una migración).
   - `supabase-promote-superadmin.sql` — ascender a Super Admin (idem).
   **No se crean archivos `migracion-*.sql`.** Todo cambio de esquema o de función va
   directo dentro de `supabase-setup-final.sql`.
2. `supabase-setup-final.sql` tiene que poder correrse **entero sobre una base ya con
   datos, todas las veces que haga falta, sin romper nada**: solo
   `create table if not exists`, `create or replace function`, `insert … on conflict do nothing`,
   `alter table … enable row level security`. Nunca `drop table`, `truncate` ni `delete` de filas de la app.
3. Después de actualizar el setup en una base existente, hay que **redesplegar las Edge
   Functions que cambiaron** (el SQL no las toca). Se anota en la entrada correspondiente.
4. Cuando un cambio entra al maestro, se actualiza este archivo y se anota la versión de
   código (`VERSION_CODIGO` en `scripts/nueva-empresa.mjs`).

---

## v71 · 2026-09-25 — Plan Premium: nueva tabla de funciones + candado en el servidor

### Qué cambió

**Frontend (tabla de planes)**
- Pasaron a **Premium**: portal de clientes (incluidos "Nuestros planes" y "Menú de la
  semana" dentro del portal), Notas (con verificación de comprobante), Despacho, Sueldos,
  Inventario, horario semanal y exportar dietas especiales.
- Siguen en **Básico**: Métricas, Auditoría y cierre automático del día.
- Total de páginas bloqueables: **11**. Se eliminó `returnDate` (reactivación por fecha):
  estaba marcado como Premium pero ningún llamador pasaba nunca `true`, así que el candado
  no hacía nada. Ahora la reactivación por fecha siempre funciona.
- Archivos: `src/services/panelAuth.js`, `src/services/dispatchHelpers.js`
  (`dispatchStatus` ahora recibe 3 argumentos, se actualizaron 24 usos en 8 archivos),
  `src/components/panel/settings/SettingsPage.jsx`, `src/i18n/locales/{es,en,pt}.json`.

**Backend (el candado ahora corre en Postgres, no en la app)**
- `_plan_blocks(p_page)` lee `db_personal` fila `settings` y decide si la página está
  bloqueada, teniendo en cuenta `premiumUntil` en la **zona horaria de la empresa**.
- Escrita: `_require_permission` llama a `_plan_blocks` → un editor sin Premium recibe
  error al guardar Notas/Sueldos/Inventario/Despacho. Super Admin exento.
- Lectura: los RPCs de lectura devuelven **vacío**, no error, para que el panel arranque
  sin páginas rotas.
- `plan_blocks_page(p_page)` es la misma comprobación para las Edge Functions (service_role).
- **Sweep de permisos** (último bloque `do $$` del setup): repasa *todas* las funciones
  `_`-prefijadas más 6 funciones sin token que usan pg_cron y las Edge Functions, y hace
  `revoke … from public, anon, authenticated` + `grant … to service_role`.
  Motivo: los **default privileges** de Supabase vuelven a dar `EXECUTE` a `anon` en cada
  función nueva, así que un `revoke` suelto no sirve. Verificado: el cron de cierre de día
  sigue ejecutándose (job 95, `cron.job_run_details`).

**Edge Functions**
- `send-push` → **v15**, desplegada en pruebas. El modo `manual` comprueba
  `plan_blocks_page('manualPush')` para todo el que no sea Super Admin.

**Seguridad (punto 4 del informe)**
- 6 funciones internas que estaban accesibles con la clave anónima quedaron cerradas
  (`get_push_reminder_config`, `get_push_reminder_targets`, `get_clients_for_push_reminder`,
  `run_push_reminder`, `plan_blocks_page`, `get_company_timezone`, `get_day_cutoff_hour`).

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| Pruebas `kkqcaiunetlikfyaldab` | ✅ al día (2026-09-25) | ✅ `send-push` v15 |
| In Shape `spvqcxomhkukwzijhvlm` | ⬜ pendiente: correr `install/supabase-setup-final.sql` (resuelto con su ref) | ⬜ pendiente: redesplegar `send-push` |

Correr el setup en In Shape **no borra ni toca datos**: son tablas/functions idempotentes.
Único paso manual después, si se quisiera que Métricas y Auditoría queden libres en Básico:

```sql
update db_personal set payload = jsonb_set(payload, '{premiumLockedPages}',
  (payload -> 'premiumLockedPages') - 'audit' - 'metrics')
  where id = 'settings' and payload -> 'premiumLockedPages' ?| array['audit','metrics'];
```

Un valor explícito en `premiumLockedPages` manda sobre el default del código, por eso se
limpia: si una base vieja guardó `{"audit": true, "metrics": true}`, esas dos páginas
seguirían cerradas aunque Básico las regale.

### Pendiente de decidir
- `VERSION_CODIGO` sigue en `v71` aunque el código cambió. Subirlo a `v72` antes del push
  es lo que hace que los clientes existentes reciban el update por Service Worker.

---

## Arreglos de UI del mismo día

- **Scroll del menú lateral en teléfonos con letra grande** (`src/pages/PanelPage.css`,
  `PanelPage.jsx`): la barra se salía de la pantalla y no se podía bajar. Ahora el
  contenedor del menú tiene altura propia y `overflow-y: auto`.

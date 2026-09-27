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
5. **Formato de encabezado de entrada** (lo lee `scripts/versiones.mjs` para decir qué le falta
   a cada empresa, no lo cambies de forma):
   `## esquema X.Y · vNN · AAAA-MM-DD — título`. La versión de esquema vive en la línea
   `-- version de esquema: X.Y` del setup y se escribe en la tabla `db_app_version` de cada base.
   En cada entrada, la tabla **`Estado por base` tiene que usar el `projectRef` en la primera
   celda** y `✅` / `⬜` en las columnas SQL y Edge Functions: eso es lo que levanta el script.

---

## esquema 1.24 · v72 · 2026-09-27 — Versión de código v72, panel operatorio `.bat` y maestro sin tests en las copias

### Qué cambió

**`VERSION_CODIGO` → `v72`** (`scripts/nueva-empresa.mjs`) y campo `version` en las tres filas de
`install/empresas.json`.

Aclaración importante, porque la entrada v71 decía otra cosa: **esta etiqueta no llega a la app.**
No la lee ningún archivo de `src/` ni `public/config.js` (verificado con `grep` sobre `src`,
`public`, `vite.config.js`): es solo contabilidad del registro para saber qué copia de cada cliente
corresponde a qué estado del maestro. Que un cliente instalado reciba el update **no** depende de
ella: `vite.config.js` tiene `VitePWA({ registerType: 'prompt' })`, así que el Service Worker nuevo
se detecta por el hash de los `assets` del build y aparece el aviso "Actualizar ahora". O sea:
el push a producción sigue siendo `build` + desplegar, no tocar este número.

**`panel-catering.bat`, el panel operatorio del maestro** (menú interactivo: 1 actualizar una
empresa, 2 actualizar todas, 3 inventario de versiones, 4 alta de empresa nueva). Antes de escribir
hace doble resguardo: corre `difundir` **sin** `--aplicar` (dry-run) y después pide un `S/N`
explícito. Los nombres del menú 2 están escritos tal como figuran en `install/empresas.json`
(`Green Fork`, `In Shape Catering`). Verificado: `--list`, `versiones.mjs` y los dry-runs que invoca
corren bien desde la raíz; la navegación del menú hay que probarla a mano (cmd no permite pipear
`set /p` para simular teclas).
Ahora `difundir.mjs` lo protege con `PROTEGIDOS_NOMBRE` (valga el nombre de archivo, esté donde
esté): en una carpeta de cliente no habría `install/empresas.json` y el panel daría error.

**Protecciones nuevas en `difundir.mjs`**: `tests/` y `CAMBIOS.md` (decisión del dueño), cualquier
`panel-catering.bat`, y la carpeta `supabase/.temp/` del CLI de Supabase. Lo último además evita que
`--aplicar` borre cosas como pasó antes con `.temp/cli-latest`; `supabase/.temp/` se agregó al
`.gitignore` del maestro (y ya viajó a las dos copias).

**`nueva-empresa.mjs` aborta si falta `--out`.** Sin esa bandera escribía sobre la carpeta del
maestro: `public/config.js`, el SQL y el registro con `carpeta: "Catering Control"`, o sea se
podía destrozar la copia de pruebas dando de alta otra empresa. Verificado: el intento sin `--out`
lanza el error, no crea ninguna carpeta y no toca `public/config.js`. Sigue habilitado el camino
explícito `--pruebas`.

**Las copias de cliente ya no llevan `tests/` ni `CAMBIOS.md`** (decisión del dueño 2026-09-27,
ya reflejada en `PROTEGIDOS_*` de `difundir.mjs`): la suite de 45 tests y el changelog son
herramientas del maestro; el ZIP que recibe un cliente es solo app.
Consecuencia: `node --test tests/` se corre **una sola vez**, en el maestro, y `difundir` deja de
llevarse cambios de test a las carpetas.

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ 1.24 (`5ffbfc61`), verificado en la base 2026-09-27 | ✅ `send-push` v15 |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ 1.24 (`bf469e08`) | ✅ las 5 redesplegadas 2026-09-27 |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ 1.24 (`6c2fa992`) | ✅ las 5 desplegadas 2026-09-27 |

Código difundido del maestro a las dos carpetas de cliente con v72 (dry-run + `--aplicar`), y
`versiones.mjs` vuelve a reportar las tres "al día" después del push.

---

## esquema 1.24 · v71 · 2026-09-26 — Marca de versión por empresa, tests de lógica y difusión a clientes

### Qué cambió

**Marca de versión dentro de la base (setup, sección 23)**
- Tabla nueva `public.db_app_version` (fuera de los datos de la app) con una sola fila `main`
  que guarda `{"setup": "supabase-setup-final.sql", "esquema": "1.24"}`.
- La versión se declara en **un solo lugar**: la línea `-- version de esquema: 1.24` del
  encabezado del setup. Subila cuando el setup evolucione y el `insert` la propagua sola.
- Por qué tabla propia y no la fila `settings` de `db_personal`: `_save_table_field` reemplaza
  el payload de `settings` **entero** cada vez que un admin guarda Configuración, así que
  cualquier marca puesta ahí desaparece al primer guardado.
- RPC de lectura `_app_version()` (`stable`, `security definer`). El barrido de permisos del
  `do $$` final la cubre por estar prefijada con `_`: verificado en la base, solo
  `postgres` y `service_role` tienen `EXECUTE`; `anon` y `authenticated` no.
- `install/empresas.json`: campos `schemaVersion` y `sqlHash` por empresa, y
  `esquemaVersion` + `actualizado` arriba del arreglo.

**`scripts/versiones.mjs` — inventario de versiones (solo lectura)**
- `--local` compara el sha256 del setup del maestro contra el snapshot SQL de cada empresa y
  lista qué entradas de este archivo le faltan.
- `--api` lee `public._app_version()` de cada base por la API de gestión de Supabase con
  `SUPABASE_ACCESS_TOKEN`; si no hay token o la organización no llega al proyecto, avisa por
  empresa y sigue (no crashea, no imprime el token).
- `--json` para consumirlo desde otros scripts. Verificado: pruebas reporta `1.24` desde la
  base real; In Shape devuelve `HTTP 403` (el token del CLI no es de esa organización) y el
  script lo degrada a `error` por fila.

**`scripts/difundir.mjs` — réplica maestro → empresa (dry-run por defecto)**
- Sin `--aplicar` no escribe un byte (verificado contra `G:\catering control\In Shape`).
- `--list`, `--empresa <nombre|storagePrefix>`, `--solo <ruta>`, `--detallado`, `--aplicar`.
- Protege lo white-label y lo que genera `nueva-empresa.mjs`: `public/config.js`,
  `public/manifest.json`, `public/icons/**`, `install/*.sql`, `install/*.local.json`,
  `install/empresas.json`, `wrangler.jsonc/.toml`, `.env*`, `claves.txt`,
  `.sincronizado.json`, `node_modules`, `dist`, `.git`, `.vercel`, `*.zip`, `*.rar`.
- Detecta ediciones a mano en la empresa con `.sincronizado.json` (en la raíz del maestro,
  agregado a `.gitignore`) y **no las pisa**: reporta `CONFLICTO` y sale con código 1.
- Nunca corre git que escriba, ni en el maestro ni en la empresa.

**Tests (`tests/`, `node --test`, cero dependencias nuevas)**
- 45 tests: 43 pasan, 2 quedan como `todo` marcando deuda real. `npm test` (única línea
  agregada a `package.json`).
- Cubren las 8 ramas de `dispatchStatus`, `effectiveRouteId/DriverId`, `resolvedAddress`,
  `shiftOrdersFrom`, `extractLatLngFromMapsField`, `googleMapsDirectLink`, `addDays` /
  `nextWorkDay` con bordes de fin de mes y año, `planFor` / `stateFor` / `statusClass`,
  y tres invariantes estructurales: **las 11 páginas Premium del JS coinciden con las del
  SQL**, es/en/pt tienen el mismo set de 1275 claves, y `install/` sigue teniendo 3 SQL sin
  `drop table` / `truncate` / `delete` en el scope de instalación.

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ 1.24 con el guard nuevo de cron, aplicado y verificado 2026-09-27 (`5ffbfc61`) | ✅ `send-push` v15 |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ 1.24 con el guard nuevo, verificado 2026-09-27 desde la base (`bf469e08`) | ✅ las 5 redesplegadas 2026-09-27: `image-storage` v5, `resolve-maps-link` v4, `send-push` v4, `verificar-comprobante` v4, `cerrar-dia-automatico` v4 (antes v3/v4 con `send-push` viejo) |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ 1.24, primera vez que se le corre el snapshot propio (`6c2fa992`) | ✅ las 5 desplegadas 2026-09-27, todas v1 o v2 (antes: cero funciones) |

`verify_jwt` verificado por PATCH en las dos bases: `true` en `image-storage` y
`verificar-comprobante`, `false` en `resolve-maps-link`, `send-push` y `cerrar-dia-automatico`.
Arranque comprobado invocando cada función: las cuatro con CORS devuelven su propio mensaje de app
(`send-push` → 400 "Acción no reconocida", `resolve-maps-link` → "No autorizado.");
`cerrar-dia-automatico` no manda cabeceras CORS a propósito, así que se probó abriendo la URL como
navegación y devolvió `{"error":"No autorizado."}` en las dos bases (levanta y rechaza sin secreto).
Secretos de Green Fork dejados con el mismo set que In Shape: `GEMINI_API_KEY` copiado de la base
de In Shape por API (los valores nunca salieron del navegador) + su propio par VAPID, que ya era
distinto al de In Shape y al de pruebas (medido sobre los 3 `config.js`).

### Arreglo del 2026-09-27: los cron con el ref sin resolver se auto-reparan

Medido en la base real de Green Fork: los jobs `push-recordatorio` y `cierre-automatico-dia`
tenían grabado literalmente `https://<PROJECT_REF>.functions.supabase.co/...` como URL. O sea que
el recordatorio de plan y el cierre de día automático **nunca se disparaban** ahí. La causa no fue
el snapshot (ese llega con el ref resuelto) sino el guard del setup:

- `push-recordatorio`: `if exists (…) then return;` — "ya instalado, no se pisa".
- `cierre-automatico-dia`: `if not exists (…) then cron.schedule(…)`.

Como la base se creó primero corriendo **la plantilla del maestro** (con el placeholder), el
segundo paso —correr el snapshot resuelto— encontraba el job ya creado y lo dejaba intacto. Roto
para siempre. El mismo bug ya está reconocido en el archivo para el secreto (`<CRON_SECRET>`).

Cambios en `install/supabase-setup-final.sql` (sección 18 y sección 20):
- El guard ahora mira el **contenido**: si el job existente trae un placeholder (`%<%>%`) se da de
  baja con `cron.unschedule` y se programa con la URL de este archivo; si tiene una URL real se
  respeta tal cual (puede estar personalizada a mano).
- La URL heredada del job viejo `push-recordatorio-plan-diario` se descarta también si venía con
  el placeholder, y la rama de dos argumentos exige `v_url not null` (antes podía quedar
  `run_push_reminder(NULL, 'secreto')`).
- El snapshot de cada empresa ahora **se autoderá** en el marcador: la línea 3054 dice
  `'setup', 'supabase-setup-greenfork.sql'` en vez del nombre del maestro copiado. Lo hace
  `nueva-empresa.mjs` al generar, y `versiones.mjs` normaliza ese literal antes de comparar hashes
  (si no, `coincide` mentiría al revés).

Verificado sobre las bases reales, no solo en el archivo:
- Green Fork: se rompieron a propósito los dos jobs con el placeholder → se volvió a correr el
  snapshot → los dos quedaron recreados con `https://inirizkgxkpvqnityvud…`, `literal: []`,
  13 jobs en total.
- In Shape: 13 jobs, `url_rota: []`, y los dos jobs correctos **no** se tocaron (rama de "no pisar").
- Pruebas: 13 jobs, 0 literales, `anon_ejecutan = 0`, `db_app_version = 1.24`.
- La única diferencia de bytes entre las dos bases de clientes es el largo del comando de
  `cierre-automatico-dia` (427 vs 435): saltos de línea `\n` vs `\r\n` por cómo se pegó cada vez.
  Mismo texto SQL, no se persigue.

### Deuda que los tests dejaron registrada (no corregida aún)
1. **El panel y el portal del cliente calculan estados distintos para el mismo cliente y día.**
   `dispatchStatus()` (`src/services/dispatchHelpers.js`) vs `stateFor()`
   (`src/services/planHelpers.js`): sin días cargados el panel dice `Retorno pendiente` y el
   portal `Activo`; con `startDate` futuro y días agotados `Retorno pendiente` vs `Programado`;
   fuera de las franjas del `schedule` `Fuera de horario` vs `Activo`. Test:
   `tests/dispatch-vs-portal-status.test.js` (marcado `todo`).
2. La invariante "cero `delete from` en todo el archivo" da 19 ocurrencias, todas **dentro de
   cuerpos de función** (limpieza de sesiones, intentos de login, borrados por RPC). El scope
   de instalación tiene 0, que es lo que importa para re-correr sin romper datos.

### Riesgo aceptado a conciencia (decisión del dueño, 2026-09-26)
`login_staff()` (setup, ~línea 633) mantiene un **admin con credenciales por defecto** que
funciona mientras no exista ningún usuario de staff cargado, y esas credenciales son las
mismas en todas las empresas porque el setup es compartido. Decisión: se deja así, el flujo
previsto es entrar con ese usuario y **borrarlo a mano** al dar de alta el definitivo.
Consecuencia operativa: en cada empresa nueva hay que borrar ese usuario **antes** de dejar
la app pública, y el ZIP que se entrega a un cliente contiene esa línea.

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
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ al día (2026-09-25) | ✅ `send-push` v15 |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ 1.24 corrido el 2026-09-27 (antes el snapshot era pre-Premium) | ✅ las 5 redesplegadas 2026-09-27 |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ 1.24 corrido el 2026-09-27 | ✅ las 5 desplegadas 2026-09-27 |

Correr el setup en una base con datos **no borra ni toca datos**: son tablas/functions
idempotentes (así se corrió en In Shape y en Green Fork el 2026-09-27).
Único paso manual después, si se quisiera que Métricas y Auditoría queden libres en Básico:

```sql
update db_personal set payload = jsonb_set(payload, '{premiumLockedPages}',
  (payload -> 'premiumLockedPages') - 'audit' - 'metrics')
  where id = 'settings' and payload -> 'premiumLockedPages' ?| array['audit','metrics'];
```

Un valor explícito en `premiumLockedPages` manda sobre el default del código, por eso se
limpia: si una base vieja guardó `{"audit": true, "metrics": true}`, esas dos páginas
seguirían cerradas aunque Básico las regale.

### Resuelto
- ~~`VERSION_CODIGO` sigue en `v71`~~ → subido a `v72` el 2026-09-27 (entrada arriba). Ojo con la
  premisa de esta línea, que era falsa y por eso queda escrita: el número **no** interviene en el
  update del Service Worker, que se dispara por el hash del build con `registerType: 'prompt'`.

---

## Arreglos de UI del mismo día

- **Scroll del menú lateral en teléfonos con letra grande** (`src/pages/PanelPage.css`,
  `PanelPage.jsx`): la barra se salía de la pantalla y no se podía bajar. Ahora el
  contenedor del menú tiene altura propia y `overflow-y: auto`.

---

## Pendientes (medidos, sin hacer)

1. **Despliegue de pruebas sin verificar.** El `site_url` de Auth del proyecto
   `kkqcaiunetlikfyaldab` es `https://catering-control-react-cateringcontrol.vercel.app/` y esa
   URL responde 200 con una app **Next.js** (`/_next/static/…`), no con el bundle de Vite
   (`/assets/index-*.js`). En el repo aparecieron las ramas `vercel/install-vercel-speed-insights-*`
   y `vercel/install-vercel-web-analytics-*`. Revisar en Vercel: Settings → Production Branch =
   `main`, y qué deployment es el de producción.
2. **`origin/master`** es una rama vieja divergida (2 commits propios, 141 archivos de
   diferencia contra `main`). Confirmar que nada la despliegue y borrarla o dejarla muerta.
3. **`cerrar-dia-automatico` de PRUEBAS sigue en v5** (deploy 2026-09-24, anterior al commit
   `5d0ad8d`). Medido 2026-09-27 con `supabase functions list --project-ref kkqcaiunetlikfyaldab`:
   `image-storage` v14, `resolve-maps-link` v10, `verificar-comprobante` v14, `send-push` v15,
   `cerrar-dia-automatico` v5. Las dos bases de cliente sí quedaron con el código actual ese día.
   Ojo: los números de versión son contadores **por proyecto**, no comparables entre bases.
   Sus `shared/` cambiaron pero el comportamiento es idéntico (los llamadores ya pasaban `false`).
4. **`site_url` de Auth en `http://localhost:3000`**, con el allowlist de Redirect URLs **vacío**.
   Medido directamente en `spvqcxomhkukwzijhvlm` (In Shape); en `inirizkgxkpvqnityvud` (Green Fork)
   hay que confirmarlo desde el dashboard, porque el token del CLI no llega a esa organización.
   Cualquier correo de invitación / confirmación / recuperación que mande Supabase lleva al cliente
   a localhost. No se tocó: hay que decidir el dominio definitivo por marca primero, y el push queda
   **atado al origen** (cada mudanza invalida las suscripciones ya hechas), así que se decide antes
   de repartir el link. Medible solo con la sesión del dashboard: el token del CLI da HTTP 403 en
   las dos (son de la organización `inshapecatering`).
5. **Nunca se probó una sesión de cliente real.** En las dos bases de cliente
   `db_clientes_rows = 0` y `db_push_subscriptions = 0` (medido 2026-09-27): falta dar de alta al
   primer usuario de cliente, subir un comprobante y que salga un push a un dispositivo suscripto.
   Es el único camino que prueba de punta a punta `verificar-comprobante`, `send-push` y el
   recordatorio por pg_cron con datos reales.
6. **Sin `node_modules` en ninguna de las tres carpetas** (verificado 2026-09-27): ni maestro ni
   clientes. No está roto nada — es el disco limpio — pero ningún despliegue se puede correr hasta
   `npm install` en la carpeta que corresponda.
7. **`panel-catering.bat` está duplicado**: en la raíz del maestro y en `scripts/`, mismo sha256.
   Solo funciona el de la raíz (busca `scripts\difundir.mjs` relativo a su propia carpeta; desde
   `scripts/` imprime su propio mensaje de error). Decidir cuál de los dos se queda en git.
   Desde hoy `difundir.mjs` no copia ninguno a las carpetas de empresa.

### Resuelto durante esta pasada (2026-09-27)
- **In Shape y Green Fork al día, código y base**: `difundir --aplicar` dejó las dos carpetas con
  0 diferencias contra el maestro (131 archivos sin cambios, 0 conflictos, 0 eliminaciones) y sus
  bases quedaron en esquema **1.24** con las 5 Edge Functions y `verify_jwt` correcto — ver tabla
  `Estado por base` de la entrada v72.
- **Regla de 3 SQL también en las copias**: `In Shape/install/` tenía 4 archivos SQL por un
  `supabase-setup-final.sql` copiado a mano (pre-Premium, con `<PROJECT_REF>` sin resolver,
  inutilizable). Ya no está: las dos carpetas tienen `reset-admin-password.sql`,
  `supabase-promote-superadmin.sql` y su setup propio.
- **`Catering Control.rar` (939 KB con secretos a la vista) desapareció del disco**:
  `find` por `G:\catering control` no devuelve ningún `.rar` ni `.zip`.
- **Los cron con el ref sin resolver se auto-reparan** (sección 18 y 20 del setup) y el snapshot de
  cada empresa se autolibera en el marcador de versión: ver la entrada del esquema 1.24.
- **`nueva-empresa.mjs` ya no escribe sobre el maestro por olvido de una bandera**: sin `--out`
  aborta con explicación (y sigue permitiendo `--pruebas` explícito). Verificado: el intento de
  alta sin `--out` lanza el error y no crea carpeta ni toca `public/config.js`.
- **`difundir.mjs` protege `tests/`, `CAMBIOS.md`, `panel-catering.bat` y `supabase/.temp/`**: las
  carpetas de cliente quedan solo con la app, y el estado del CLI de Supabase ya no viaja ni se
  borra (antes `--aplicar` se llevaba puesto un `.temp/cli-latest` propio).

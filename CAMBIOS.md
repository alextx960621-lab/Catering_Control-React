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

## esquema 1.25 · v72 · 2026-09-27 — La hora de cierre sobrevivía a todo, y dos lecturas Premium sin candado

Reporte del dueño: "cambio la hora de cierre en Configuración, salgo y entro, vuelve a aparecer
4am", en **las dos empresas probadas**. No era un bug: eran cuatro capas con el mismo error, y
ninguna alcanzaba sola.

### 1. El tope 12 repartido en cuatro lados

El selector de Configuración ofrece las 24 horas (`Array.from({length: 24})`), pero el resto del
sistema rechazaba todo lo mayor a 12 y lo tiraba a 4:

| Capa | Archivo | Estaba | Ahora |
|---|---|---|---|
| Normalización del panel | `src/services/normalize.js` | `cutoff <= 12` | `<= 23` |
| Cierre automático (cron) | `supabase/functions/cerrar-dia-automatico/shared/normalize.js` | `<= 12` | `<= 23` |
| SQL | `get_day_cutoff_hour()` | `least(12, …)` | `least(23, …)` |
| UI | `SettingsPage.jsx` (timezone y cutoff) | `defaultValue=` (input muerto) | `value=` (controlado) |

El circuito que destruía el dato: el dueño ponía 18:00 → se guardaba 18 bien → al recargar,
`normalizeSettings` lo aplastaba a 4 → **el siguiente guardado de cualquier campo de Configuración
escribía ese 4 sobre el 18 real**. Por eso "salgo y entro". Medido en las bases: In Shape tenía
`dayCutoffHour = 23` guardado y el panel mostraba 4; Green Fork ya estaba en 4 (el dato se perdió).

La copia de la Edge Function estaba **dormida** (el cron solo usa `menuItems` y `companyName` de
`settings`, y la hora de corte la pregunta al SQL), pero seguía siendo código viejo que alguien
puede encender. Se corrigió igual y ahora un test la vigila (ver abajo).

### 2. La misma clase de bug en otros cinco campos

Inputs no controlados (`defaultValue` + guardar en el `blur`) muestran el valor con el que se
montaron, no el que hay en la base: si `settings` llega después, o lo cambia un refresco, la pantalla
muestra un valor viejo y el blur lo re-escribe encima. Cure del proyecto: `key=` basado en el valor,
para que el input se resiembra. Aplicado a `PublicidadPage.jsx` (`companyName`, `whatsappNumber`,
`instagramUrl`, `instagramHandle`, `renewalWarningDays`), `SettingsPage.jsx` (`premiumWhatsapp`),
`MetricsPage.jsx` (`costPerKm`), `ReminderCard.jsx` (`pushReminderText`) y `PayrollPage.jsx` (la
tarifa por driver, que además dependía de `currentDate`, no del mes).
Ya estaban bien: las filas de `DispatchPage.jsx` usan `key={`${c.id}::${date}`}` desde antes.

### 3. "Hoy" con `toISOString()` (UTC) en un movimiento de inventario

`InventoryPage.jsx` fechaba el movimiento con `new Date().toISOString().slice(0,10)`: en Bolivia
(UTC-4) entre las 20:00 y las 23:59 eso es el **día siguiente**, y cualquier reloj mal ajustes del
teléfono también. Cambió a `serverToday` (la fecha operativa real del servidor, la que ya usa todo
el panel).
Se evaluaron y se dejaron como están: los `toISOString()` de `OperationsContext.jsx` son default de
`dueDate` de notas que el `...nt` de la propia fila siempre pisa, y `serverToday` en esa misma línea
es el estado inicial antes de que conteste el servidor.

### 4. Dos lecturas Premium que respetaban el rol pero no el plan

Encontrado en el barrido de seguridad. La escritura de esas mismas pantallas ya pasaba por
`_require_permission` (que sí consulta el plan), así que el candado era de un solo lado:

- `staff_listar_comprobantes` leía `db_comprobantes_rows` con solo tener rol con acceso a `notes`.
  Un admin de plan Básico podía llamar la RPC directo con su token y ver todos los comprobantes
  (monto esperado, monto leído), aunque la pantalla estuviera bloqueada de fábrica. Agregado
  `if public._plan_blocks('notes') then return; end if;`.
- `staff_get_audit_log` lo mismo con `audit`. Gate agregado.
- `staff_get_all_audit_log` quedó **sin gate a propósito**: es la lectura que usa el respaldo
  completo de Configuración. Bloquearla por plan haría que un cliente con "audit" bloqueado
  exportara un respaldo sin historial y, al restaurarlo, perdiera filas (la restauración
  `staff_insert_audit_bulk` no está bloqueada). Para que la pantalla no se aprovechara del hueco,
  el botón "ver todo" de `AuditPage.jsx` ahora usa `staff_get_audit_log` (tope 2000) en vez de la
  lectura libre.
- El barrido de la sección 24 sigue igual. Medido en las tres bases: `has_function_privilege('anon',
  'hash_password(text)', 'execute')` = **false**, o sea el oráculo de hashing que marcó el análisis
  ya estaba cerrado por la línea 2650 del setup (`revoke … from anon, authenticated`).
- Medido en pruebas sobre las RPCs de lectura (`staff_get_audit_log('')`, `staff_listar_comprobantes('')`,
  `staff_get_all_audit_log('')`): las tres lanzan `Sesión inválida o expirada` desde `_staff_session`.
  El `EXECUTE` que sí tienen `anon`/`authenticated` (lo necesita el panel, que llama con la publishable)
  no expone nada sin un token de sesión válido.

**Comprobado en la base de pruebas, dentro de una transacción con `rollback`** (token de un admin
sintético, 1 comprobante y 1 fila de auditoría sembrados, nada persistido):

| Plan | Comprobantes visibles | Auditoría visible | Filas reales |
|---|---|---|---|
| premium | 5 | 169 | 5 / 169 |
| básico | **0** | 169 (audit se regala en Básico, es la regla vigente) | 5 / 169 |

### 5. Tests: de 49 a 52 (`node --test tests/`, 50 pasan, 0 fallan, 2 `todo`)

- `tests/sql-plan-lock-reads.test.js` (nuevo): recorre **todas** las funciones `staff_*` y exige que
  cualquiera que pregunte `_staff_can_view(rol, 'página')` consulte también `_plan_blocks('página')`
  para esa misma página, con excepciones nombradas y su motivo. Este test habría encontrado los dos
  agujeros del punto 4 solo. Verificado con mutación: al sacar el gate de comprobantes, falla.
- `tests/normalize-settings.test.js`: toda hora de 0 a 23 se conserva, lo inválido (`24`, `-1`, `''`,
  `null`, `1.5`, `'x'`, `{}`, `NaN`) vuelve a 4, y el `normalize.js` del panel y el de la Edge
  Function tienen que dar **el mismo texto** (la deriva que produjo la capa dormida).
- `tests/sql-invariants.test.js`: el tope del `least()` del SQL y el del `normalize.js` tienen que
  ser el mismo número, y la marca de esquema del encabezado tiene que coincidir con la del `insert`
  de `db_app_version`.

### 6. Difusión y aseo de las carpetas

- Esquema del maestro `1.24 → 1.25`. Los dos snapshots de cliente se **regeneraron enteros** desde
  el maestro (sustitución de `<PROJECT_REF>` ×6 y del nombre del setup) y verificados byte a byte:
  revertida la sustitución, el archivo vuelve a ser idéntico al del maestro.
- Inventario de las tres carpetas (162 rutas): **0 archivos distintos** que no sean lo white-label
  (`config.js`, `manifest.json`, `icons`, el SQL propio, `*.local.json`, `panel-catering.bat`). Lo
  exclusivo del maestro: `CAMBIOS.md`, `install/empresas.json`, `tests/`, `.sincronizado.json`.
- Borrado lo generado que no es proyecto: `supabase/.temp/` en las tres carpetas (cache del CLI) y
  un `normalize.js` suelto que había quedado en `G:\catering control\` (copia exacta del del maestro,
  verificada con `diff`). Después de verificar el build (`npm ci` + `npm run build` en el maestro),
  se volvieron a borrar `node_modules/` y `dist/`: se recrean con `npm ci && npm run build`.
- Pendiente del lado del dueño: en **Green Fork** el archivo `supabase/.temp/cli-latest` sigue
  **seguido por git** (en el maestro e In Shape no), por eso `git status` ahí muestra una `D`.
  Basta `git rm --cached supabase/.temp/cli-latest` en esa carpeta para que las tres repos queden iguales.

### 7. El hallazgo más importante del barrido final: `verify_jwt` en las dos bases de cliente

Medido en las tres cuentas desplegadas: en **pruebas** las 5 funciones tienen `verify_jwt = false`,
pero en **Green Fork** y **In Shape** `image-storage` y `verificar-comprobante` estaban en **`true`**.
Como la app **nunca** usa Supabase Auth (en `src/` no hay ni un `supabase.auth`; se autentica con su
propio `p_token` contra `db_sessions`), el gateway de Supabase cortaba **antes** de que corriera el
código: `POST` sin header de autorización devolvía **HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`** (medido
con `net.http_post` desde la propia base de Green Fork). O sea: subir una foto y verificar un
comprobante fallaban en producción en las dos marcas, y en pruebas funcionaban. Root cause: esas dos
se desplegaron con `supabase functions deploy` sin `--no-verify-jwt`, y el `PATCH` corrector solo se
había aplicado a las tres que daban error visible.

Arreglado con `PATCH /functions/{slug} {"verify_jwt":false}` sobre esas dos funciones en las dos
marcas (leído antes y después: `true → false`, HTTP 200). Verificación posterior, misma técnica: las
dos responden **HTTP 400 `Parámetros inválidos.`**, o sea ya entran al código y lo rechaza la
validación propia de la función — el candado de sesión sigue adentro, lo que se quitó es la barrera
del gateway. Las cinco funciones de las dos marcas quedaron con body idéntico entre sí (sha256 del
ESZIP: `fd9aac6f`, `4f6047f8`, `07a307cd`, `ec086536`, `ee7faf3e`) y con el mismo patrón de
`verify_jwt` que pruebas.

**Regla para la próxima empresa:** `nueva-empresa.mjs` ya imprime los 5 deploys con
`--no-verify-jwt`; hay que correr los cinco, no solo los que fallan a la vista.

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ 1.25 (`71cd97a4`), verificado en la base 2026-09-27 | ✅ `cerrar-dia-automatico` v6 con `cutoff <= 23` (0 ocurrencias de `<= 12`), las 5 con `verify_jwt=false` |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ 1.25 (`f0bc6396`), releído en la base 2026-09-27 | ✅ 5 funciones, body idéntico al de Green Fork, `cerrar-dia-automatico` v5 con `cutoff <= 23`; `image-storage` y `verificar-comprobante` corregidas `true → false` |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ 1.25 (`70e8d8ba`), releído en la base 2026-09-27 | ✅ 5 funciones, `cerrar-dia-automatico` v3 con `cutoff <= 23`, smoke test `dryRun` HTTP 200; `image-storage` y `verificar-comprobante` corregidas `true → false` |

Verificado en cada base después de correr el setup: marca `db_app_version = 1.25`,
`get_day_cutoff_hour` con `least(23`, los dos gates nuevos presentes en `pg_proc`, `cron.job` con
sus 13 trabajos, y conteos de datos sin cambios (`db_clientes`, `db_personal`, `db_sessions`,
`db_audit_log`, `db_dispatch_snapshots`). In Shape: `dayCutoffHour` guardado 23 → hora efectiva 23
(y antes de esto el panel mostraba 4). Green Fork: sigue 4 porque el valor real se perdió con el bug
→ **hay que volver a ponerlo en Configuración** cuando el frontend nuevo esté desplegado.

Re-medido en las dos bases de cliente el 2026-09-27 por la tarde (API de gestión con la sesión del
dashboard): `esquema = 1.25`, **9** funciones `staff_*` que consultan `_plan_blocks`, 13 jobs de
`pg_cron`, `db_clientes_rows = 0` y `db_push_subscriptions = 0` en las dos (el trayecto con un
cliente real sigue sin probarse), `db_audit_log` 3 en Green Fork y 6 en In Shape,
`db_comprobantes_rows = 0`.

### Qué falta del lado del dueño

1. `npm install` + `npm run build` + desplegar en Vercel (las tres carpetas están sin
   `node_modules` y sin `dist`; el fix del panel no llega al navegador hasta ese push).
2. Green Fork: volver a elegir la hora de cierre (23 en In Shape ya funciona solo).
3. Commitear y pushear las tres carpetas (en las tres hay cambios sin commitear: 8-12 archivos).

---

## esquema 1.26 · v72 · 2026-09-27 — Once fallas del dueño: sesiones cruzadas, direcciones que se perdían y el corte del autoservicio en el servidor

Segunda lista del dueño (11 puntos, sobre login/sesiones, ClientsPage y portal). Se midió cada
afirmación contra el código antes de tocar nada: **8 ciertas, 1 cierta pero con otro alcance, 2 no
eran bugs**. Se corrigieron 8 y se dejaron 3 a propósito (sección 7, con el porqué).

### 1. El logout de un staff expulsaba al cliente del mismo teléfono (falla 1, cierta)

`clearSessions()` borraba staff **y** cliente. La sesión de cliente es la única que vive en
`localStorage` (en la PWA tiene que sobrevivir al cierre de la pestaña), así que salir del panel en
el teléfono personal del repartivo mandaba al portal al login. Dividido en `clearStaffSession()` y
`clearClientSession()` (`src/services/session.js`), cada página usa el suyo
(`PanelPage.jsx:169`, `ClientePage.jsx:187`), y `clearSessions` ya no existe como código: queda solo
en el comentario que explica el porqué y en el test que lo vigila
(`tests/sessions-portal-cache.test.js`).

### 2. Con dos sesiones abiertas, LoginPage elegía al azar (falla 1, continuación)

Podía existir sesión de staff (en `sessionStorage`) y de cliente (en `localStorage`) a la vez: el
`useEffect` miraba primero la de staff, así que el cliente que además usa el panel caía al panel en
cada F5. Ahora la última entrada de **esta pestaña** desempata: los dos logins marcan
`STORAGE_KEYS.lastLoginOrigin` (nuevo, en `sessionStorage`) y sin marca LoginPage **no redirige** y
muestra el formulario, que es lo único honesto.

### 3. Escrituras optimistas que no se revertían (falla 3, cierta)

`dbUpsert*`/`dbSet` devuelven `false` cuando fallan (no lanzan), y los guardadores de
`OperationsContext` pintaban el estado antes de saber el resultado: la pantalla quedaba mostrando
un cliente/nota/día que la base nunca tuvo. `saveClients`, `saveNotes`, `deleteNote` y
`deleteClients` ahora hacen snapshot → set → escribir → **revertir con el snapshot si devolvió
`false`**, igual que ya hacían `saveDays`/`saveInventory`. Los espejos `clientsRef`/`notesRef`
existen solo para eso. Cuatro checks parametrizados en `tests/operations-snapshot-guards.test.js`.

### 4. ClientsPage: datos que se perdían al Guardar (fallas 5, 6, 7, 8, todas ciertas)

- **Direcciones con solo el link de Maps** (5): el filtro era `(a) => a.address`, así que una
  dirección pasada como link (sin texto — lo habitual cuando el cliente lo manda por WhatsApp) se
  botaba enterita al guardar: link, coordenadas, orden y observaciones. Nuevo
  `hasAddressData()` (acepta `address`, `maps`, `lat` o `lng`), usado tanto al guardar como por
  `ScheduleRows`, que antes mostraba la dirección ya descartada.
- **Horario semanal borrado en silencio** (6): quitar una dirección filtra las franjas que apuntan
  a ella en `handleSubmit`. `AddressRows` ahora recibe el `schedule`, cuenta las franjas afectadas y
  pide `window.confirm`; si aun así caen, el guardado avisa cuántas (`scheduleRowsDroppedNotice`), y
  **no** cuenta las del horario bloqueado (`scheduleLocked`).
- **`togglePause` usaba `currentDate`** (7): que es la fecha que se está *mirando* (puede ser
  pasada o futura), no el hoy. Pausar desde el lunes escribía `pauseStart` del martes visto. Ahora
  `serverToday` + `dayInfoToday`, y la etiqueta del botón consulta lo mismo que escribe.
- **Guardado en dos pasos sin transacción** (8): "correr el orden de los demás" se escribía aunque
  el cliente no se hubiera guardado, dejando dos clientes con el mismo número en la base. Ahora solo
  corre si `saved`, el `addressId` de la fila sigue siendo el mismo, y su propio fallo se avisa por
  separado (`shiftOrdersSaveFailed`).

### 5. El corte del autoservicio se medía con la relojera del cliente (falla 2, cierta)

`Portal.jsx` tenía `pastCutoff() { return new Date().getHours() >= 22; }`: atrasando el reloj del
teléfono el cliente pausaba o cambiaba la dirección a cualquier hora. El candado del SQL en
`set_client_address_override` sí existía, pero `cliente_save_profile` (pausa/reactivación) **no
tenía ninguno**, así que un POST directo al RPC lo saltaba aunque la pantalla se comportara.

- SQL: nuevo helper `_autoservicio_cerrado()` (`security definer`, revocado de `public/anon/
  authenticated`) que mide `extract(hour from now() at time zone get_company_timezone()) >= 22`. Se
  usa en `cliente_save_profile` (dentro de la rama `pauseStart`/`returnDate`), en
  `set_client_address_override` y se expone como `autoservicioCerrado` en `get_portal_catalog`.
- Frontend: `pastCutoff()` lee esa marca; el catálogo la propaga en las dos fusiones de
  `ClientePage.jsx` (95 y 122) y el resync por `visibilitychange` la refresca.

**Decisión de semántica (para revisar si él quiere otra cosa):** se mantuvo la regla de las **22:00
de la hora local de la empresa**, no se ató a `dayCutoffHour`. Medido por qué: `get_business_date()`
resta la hora de corte, así que "mañana" (`currentDate + 1`) recién se cierra al empezar su propio
día operativo; una condición `_autoservicio_cerrado(p_date)` por fecha **nunca se cumplía** dentro de
la jornada (era código muerto). La regla global de las 22:00 es lo que el dueño ya tiene hoy, solo
que ahora la pone el servidor.

### 6. Cache del portal (fallas 10 y 3-b, ciertas)

- `getClientTheme()`/`saveClientTheme()` ignoraban el `clientId`: dos clientes que comparten teléfono
  (familia, mismo origen) se pintaban el portal el uno al otro. La llave ahora es
  `${STORAGE_KEYS.uiTheme}:${clientId}`; la llave genérica queda solo para el login (`useTheme.js`).
- `saveClient()` escribía `writeClientRow()` (el cache que la ruta rápida pinta al abrir) **antes**
  de la confirmación: un "Pausado" que la base nunca tuvo, visible hasta el siguiente sync. Ahora se
  escribe solo si `saved`.

### 7. Dejada a propósito, con el motivo

- **Duplicado de carnet en signup** (4): no se agrega una lectura previa. `signup_cliente` ya falla
  con su propio mensaje y agregar un `SELECT` abierto por carnet sería un oráculo de existencia
  (`login_cliente` tiene candado de 3 intentos justamente para eso).
- **Conflicto de orden con un solo slot** (9): es verdad que solo vive el último blur, pero el
  diagnóstico real es otro — `orderConflict` y `orderShift` son un estado único, así que editar el
  orden de dos direcciones del mismo cliente solo corre a los demás para el último. No rompe datos
  (el orden duplicado queda visible en la ruta) y arreglarlo pide convertir el corrimiento en lista;
  queda para otra ronda si él lo pide.
- **`fetchIsPremium` con cache viejo** (11): el cache solo decide la fase *inicial* del camino
  rápido; a los segundos `fetchIsPremium()` re-confirma y `setPhase('locked')` si corresponde, y
  desde 1.24/1.25 el servidor gatingea `clientPortal` en cada RPC del portal. Impacto: un flash, no
  una puerta abierta. Sin cambio.

### 8. Tests: de 68 a 81 (`node --test tests/` → 79 pasan, 0 fallan, 2 `todo`)

- `tests/clients-page-gates.test.js` (nuevo, 6): forma de `hasAddressData`, confirmación al quitar
  una dirección referenciada, aviso de franjas caídas, orden de los dos guardados, `serverToday` en
  `togglePause` y su botón, y que **todas** las claves `t(...)` del archivo existan en es/en/pt.
- `tests/sessions-portal-cache.test.js` (nuevo, 7): los dos cierres separados, la marca
  `lastLoginOrigin`, el cache de la fila después de la confirmación, el tema por cliente, el corte
  del lado del servidor (JS y SQL), y que la marca de esquema del encabezado coincida con el literal
  de `db_app_version`.
- Lint: 1 aviso (el de siempre, `CompanyPrefsContext.jsx:70`). Build: OK.
- Locales: 4 claves nuevas en `panel.clients` (`clientSaveFailed`, `removeAddressScheduleConfirm`,
  `scheduleRowsDroppedNotice`, `shiftOrdersSaveFailed`) en es/en/pt; paridad verificada por el test.

### 9. El setup 1.26 ya está corrido en las tres bases (medido, no assumed)

Esta vez el CLI llegó a las tres (`supabase projects list` muestra los cuatro proyectos con el token
local; antes solo alcanzaba a pruebas). Ruta usada en las dos bases de cliente, con el snapshot propio
de cada una: `supabase link --project-ref <ref>` → dry-run (`begin;` + setup + `rollback;`) → aplicar
el archivo → verificar. Los conteos de las 20 tablas antes y después dan `diff` vacío: cero filas
perdidas.

| Base | antes | después | verificado |
|---|---|---|---|
| pruebas | 1.25 | 1.26 | `_autoservicio_cerrado()` con una sola sobrecarga de 0 argumentos, el gate presente en los dos RPC y `autoservicioCerrado` en el catálogo |
| In Shape | 1.25 · 81 funciones · 13 jobs | 1.26 · 82 funciones · 13 jobs | `proacl` del helper = `{postgres=X, service_role=X}` (anon ya no puede ejecutarlo), gate en `cliente_save_profile` (posición 1236) y en `set_client_address_override` (436), catálogo con la bandera, conteos idénticos |
| Green Fork | 1.25 · 81 funciones · 13 jobs | 1.26 · 82 funciones · 13 jobs | igual que In Shape, más las dos URLs de `cron.job` (`cierre-automatico-dia`, `push-recordatorio`) apuntando a `inirizkgxkpvqnityvud.functions.supabase.co` |

Huella de funciones (cuerpo + ACL por firma, con el projectRef normalizado para poder comparar): In
Shape y Green Fork **coinciden exacto** — `8d8ed664a30259e445306dcceb41143d`, 82 funciones. El
`currentDate` del catálogo salió `2026-09-26` en In Shape y `2026-09-27` en Green Fork: es la
diferencia de `dayCutoffHour` (23 contra 4), no un desfase.

Edge Functions: `supabase/functions` no cambió contra las copias (`diff -rq` vacío), así que no hay
que redesplegarlas; por eso la columna Edge dice "sin cambios".

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ 1.26 | ✅ sin cambios |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ 1.26 | ✅ sin cambios |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ 1.26 | ✅ sin cambios |

### Qué falta del lado del dueño

1. `npm install` + `npm run build` + desplegar Vercel/Workers en las tres carpetas.
2. Commitear y pushear las tres carpetas.
3. Green Fork no tiene catálogo que mostrar: `db_clientes` tiene una sola fila, `main` con `{}` (medido
   por SQL el 2026-09-27, mismo día del despliegue). In Shape y pruebas sí tienen las cuatro
   (`plans`, `days`, `currentDate`, `main`). Con `db_clientes_rows = 0`, el portal de Green Fork no va
   a listar ningún plan hasta cargar Configuración. La hora de cierre ahí ya está en 4 (el default).
4. El `site_url` de Auth sigue en `localhost` en las dos marcas.
5. Ningún trayecto con un cliente real ni push notifications probado end-to-end.
6. Deriva entre bases que el setup no borra (medida con `pg_proc` el 2026-09-27, tras el 1.26):
   - Pruebas tiene 3 funciones que ya no están en el setup ni en el código:
     `cliente_save_feedback`, `cliente_get_own_feedback`, `staff_get_feedback` — las tres con
     `anon=X` y `authenticated=X` (llamables desde internet, aunque se auto-validan por `p_token`).
     Ninguna se usa: `grep` en `src/` y `supabase/functions/` da cero coincidencias.
   - Las dos bases de cliente tienen `public.rls_auto_enable` (= SECURITY DEFINER, ejecutable por
     `anon`) colgada del event trigger `ensure_rls`; pruebas no la tiene. No la creó este setup.
     No la creó este setup. Solo actúa dentro de un event trigger de DDL, pero dejarla pública es la
     excepción a la regla de que `public` solo expone lo que el setup declara.
   - Huella comparable de funciones (cuerpos + ACLs, con el projectRef normalizado): In Shape y Green
     Fork coinciden exacto (`8d8ed664…`, 82 funciones); pruebas da 84 por esas 3 huérfanas menos una
     (`rls_auto_enable`) que nunca tuvo.

---

## esquema 1.25 · v72 · 2026-09-27 — Seis fallas de frontend que el dueño reportó: menú vacío por rol custom, poll oculto y escrituras sin revertir

Lista de 6 fallas enviada por el dueño. Se midió cada una contra el código **antes** de tocar nada:
3 ciertas, 2 ciertas pero con el alcance distinto al que él describió, 1 con el diagnóstico mal
enquiciado. Todas quedaron corregidas en el maestro y difundidas a las dos copias.

### 1. Menú lateral vacío para cualquier rol custom (cierta — la más grave de las 6)

`Sidebar.jsx` filtraba con `canAccessPage(page, user?.role)`, pero la firma es
`canAccessPage(page, role, customRoles = [])`: sin el tercer argumento, `customRoles.find(...)` se
resolvía sobre `[]` y devolvía `false` para **todas** las páginas de un rol custom. Un usuario con
rol custom no veía ninguna opción del menú (podía quedar encerrado en `dispatch`, que tampoco le
correspondía). Ahora `PanelShell` baja `settings.customRoles` al `Sidebar` y, además, corrige la
pantalla activa: si el rol no tiene permiso sobre ella, salta a la primera página visible, así no
queda una pantalla sin botón de menú.

Efecto secundario corregido: `goToClient` desde Notas mandaba a `clients` a un rol sin permiso,
donde `PanelPage` lo rebotaba y el botón quedaba muerto. Esos dos botones ahora solo se muestran si
el rol puede abrir clientes. El arreglo anterior ya tapaba el agujero real (antes el rol custom
**sí** veía la pantalla de clientes aunque el menú no la listara).

`NAV_ITEMS` se movió a `src/components/panel/navItems.js` porque ahora lo consumen dos componentes;
dejarlo exportado desde `Sidebar.jsx` sumaba un aviso de fast-refresh de oxlint.

### 2. `NotesPage` seguía consultando aunque estuviera invisible (cierta)

El panel mantiene `dispatch`/`notes`/`clients` montados con `display:none` (no desmontados, para no
perder el estado de los formularios). `NotesPage` tiene un `setInterval` de 15 s que llama
`refreshNotes()` → 1 RPC; al no desmontarse, el poll seguía corriendo desde una pantalla invisible:
4 RPC/min por pestaña abierta en otra pantalla, y x3 con tres pestañas. Se le pasó `active` y el
callback del intervalo lo mira (junto con `document.hidden`, `editing`, `rescheduling`,
`showComprobantes` que ya estaba).

**Corrección a lo que reportó el dueño:** no son 13 páginas vivas sino 3 (las otras 12 se montan
condicionalmente), y por lo tanto no son 12 RPC/min sino 4 por pestaña.

### 3. `saveDays` mutate antes del guard y sin rollback (cierta, y se extendió)

`setDays(newDays)` corría antes de `if (!confirmed.current.days)`, y el `dbSetFields` no se miraba:
un fallo de escritura dejaba en pantalla días que la base no tiene. Ahora es guard → snapshot →
set → escritura → `if (!ok) setDays(prev)` (los `db*` devuelven `false`, no tiran). El rollback
re-disparaba el efecto de cierre automático de días no laborables con el mismo arreglo en bucle, así
que se agregó `autoCloseAttempt` (una sola intención por conjunto de días).

Se replicó la misma forma a `saveInventory` y, en esta pasada, a los cuatro escritores de listas que
faltaban: `saveClients`, `saveNotes`, `deleteNote`, `deleteClients`.

**Queda sin hacer (a decidir):** `saveStaffUsers`, `saveSettings`, `saveRoutes`, `saveDrivers`,
`savePlans` (en el objeto de contexto, líneas ~411) sí hacen el set local antes de que
`savePersonalFields` / `saveClientesFields` rechacen por falta de confirmación, y no revierten si la
escritura falla. Están en la misma familia pero cada uno necesita su espejo del estado previo.

### 4. El default UTC de `serverToday` al arrancar (cierto pero acotado)

`useState(new Date().toISOString().slice(0, 10))` es fecha UTC: en UTC-4 (Bolivia) da el día
siguiente de 20:00 a 23:59 locales. Solo ocurre mientras el arranque no consigue la fecha del
servidor — si `get_business_date()` responde, el valor se pisa en el mismo `boot`. Con la RPC caída
o lenta, ese bulto se mostraba como si fuera el día operativo. Ahora hay un `dateConfirmed` que
distingue "confirmado por el servidor" de "bulto de arranque", y el aviso de sincronización parcial
del `boot` y de `refreshAll` lo cuenta como fallo (lo reintenta `syncToday` cada 60 s). No se cambió
el default a `''`/`null`: `PayrollPage` corta `currentDate.slice(0, 7)` y otras comparaciones
esperan `YYYY-MM-DD`.

### 5. La columna "Tarifa/día" de Planilla no decía de qué día era (cierto, con alcance distinto)

La tarifa se escribe en `days[currentDate]`, o sea en el **día que se está mirando** (puede ser un
`viewOverride` de otro mes). Eso es intencional, no un bug: es la tarifa del día en curso. El problema
real era que la grilla podía mostrar otro mes mientras editaba otro día, y el encabezado no aclaraba
en qué día se escribía. Ahora el encabezado dice "Tarifa/día de {fecha}" (clave nueva
`panel.payroll.ratePerDayForDay` en es/en/pt) y el mes de la grilla se deriva de `currentDate` salvo
que el selector lo haya cambiado para ese mismo día — sin `useEffect` de sincronización (hubiera
sumado un aviso `set-state-in-effect` y un render extra).

### 6. `userPrefs` con clave de localStorage sin prefijo de empresa (diagnóstico mal encuciado)

Es verdad que `STORE_KEY = 'catering-user-prefs-v2'` no lleva `config.storagePrefix` y que
`STORAGE_KEYS` sí. Pero `localStorage` es por **origen**: dos marcas en dominios distintos nunca se
pisan, y las preferencias que guarda (tema, orden de columnas) no son secrets ni datos de cliente.
El caso real de colisión es desarrollo local, donde las carpetas se turnan `localhost:3000`. Se
arregló igual (consistencia con el resto del código) y la migración de la clave vieja a la nueva es
de una sola vez por carga: si no, cualquiera arrancaba sin tema y sin orden de columnas guardados.

### Tests: de 52 a 68 (`node --test tests/`, 66 pasan, 0 fallan, 2 `todo`)

Tres archivos nuevos: `tests/panel-nav-customroles.test.js` (la firma de 3 argumentos y el cableado
`customRoles` por fuente), `tests/operations-snapshot-guards.test.js` (guard antes del set, rollback
en los seis escritores, `dateConfirmed`, y que toda clave `t(...)` del contexto exista en los tres
idiomas), `tests/user-prefs-key.test.js` (clave derivada de `storagePrefix` y migración de la vieja).

Medición final del maestro: `npm run lint` → **0 errores, 1 warning** (el único preexistente, de
`CompanyPrefsContext`), `npm run build` ok, `node --test tests/` → 68/66/0/2. `node_modules/` y
`dist/` se borraron después de medir.

### Estado por base

| Base | SQL | Edge Functions |
|---|---|---|
| `kkqcaiunetlikfyaldab` (pruebas) | ✅ sin cambios (1.25) | ✅ sin cambios |
| `spvqcxomhkukwzijhvlm` (In Shape) | ✅ sin cambios (1.25) | ✅ sin cambios |
| `inirizkgxkpvqnityvud` (Green Fork) | ✅ sin cambios (1.25) | ✅ sin cambios |

Entrada 100 % de frontend: no se tocó `supabase-setup-final.sql` ni ninguna Edge Function, así que
no hay que volver a correr SQL ni redesplegar funciones por esta entrada. Verificado con `diff -rq`
entre las tres carpetas: `src/` idéntico (las diferencias de `public/` son solo `config.js`,
`manifest.json` e íconos, que `difundir` protege a propósito).

### Qué falta del lado del dueño

1. `npm install` + `npm run build` + desplegar en Vercel/Workers en las tres carpetas (sin eso, el
   navegador sigue con el bundle viejo).
2. Commitear y pushear las tres carpetas: maestro 13 archivos (10 modified + 3 tests nuevos), cada
   copia 10.
3. Prueba real con un cliente y una suscripción de push (las dos bases de cliente siguen con
   `db_clientes_rows = 0`).

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

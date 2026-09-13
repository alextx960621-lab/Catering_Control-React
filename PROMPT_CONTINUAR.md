# Prompt de traspaso — Catering Control (React)

Pega este archivo completo como primer mensaje a la IA que va a continuar. Incluye contexto del proyecto, lo que ya está resuelto, y una lista puntual de lo que falta con pistas concretas de dónde mirar.

---

## ⚠️ REGLA FIJA para quien trabaje en este proyecto (incluida la próxima IA)

**Cada vez que se entreguen cambios de código, hay que devolver SIEMPRE estos 2 archivos juntos, sin excepción:**

1. **El proyecto completo comprimido en un .zip** (`catering-control-react-vNN.zip`, subiendo el número de versión), con todos los cambios ya aplicados.
2. **Este mismo archivo (`PROMPT_CONTINUAR.md`) actualizado**, moviendo lo recién resuelto a la sección "Ya resuelto" (con detalle de causa y archivos tocados, igual que las entradas de abajo) y dejando la sección "Pendiente" al día — para que la siguiente IA (o la misma, en otra sesión) pueda seguir exactamente desde donde quedó, sin tener que releer todo el historial de chat ni adivinar qué se hizo.

No entregar solo el zip, ni solo un resumen en el chat sin el zip, ni un prompt actualizado sin el zip correspondiente: los dos archivos van siempre en la misma entrega. Si en una entrega puntual no se tocó código (por ejemplo, solo se respondió una pregunta), no hace falta regenerar nada — la regla aplica cuando hay cambios de código de por medio.

**Si una entrega necesita un cambio en la base de datos** (tabla nueva, columna nueva, función RPC nueva o modificada, policy nueva, etc.), eso NUNCA queda solo en el código o solo en la cabeza de quien lo hizo — van SIEMPRE los dos:

1. El SQL correspondiente, agregado como sección nueva (numerada, con comentario explicando qué hace y por qué) al final de `supabase-setup-final-v2.sql` — ese archivo es el único que hay que correr para dejar un proyecto de Supabase nuevo al día, así que cualquier cambio de base de datos tiene que quedar reflejado ahí, sea o no la primera vez que se corre.
2. Una mención explícita EN ESTE ARCHIVO (en "Ya resuelto" si ya se aplicó, o en "Pendiente" si falta correrlo) diciendo qué sección del SQL hay que correr en el SQL Editor de Supabase y qué requiere del lado del código para que sirva de algo — para que quien continúe no tenga que adivinar si el código ya tiene su contraparte de base de datos corrida o no.

No alcanza con "ya lo agregué al SQL": si el archivo SQL cambió, el propio ZIP de esta entrega tiene que incluir la versión actualizada de `supabase-setup-final-v2.sql` (no alcanza con haberlo mandado en el chat aparte).

---

## Contexto del proyecto

Es una PWA de gestión de catering (React + Vite + Supabase) con dos frentes:
- **Panel de staff/drivers** (`/src/pages/PanelPage.jsx` y `/src/components/panel/**`): Día de trabajo (Despacho), Notas, Clientes, Drivers, Rutas, Planes, Sueldos, Inventario, Métricas, Usuarios, Configuración.
- **Portal del cliente** (`/src/pages/ClientePage.jsx` y `/src/components/cliente/**`): ver plan, pausar/reanudar servicio, pedir renovación o cambio de plan, notas/soporte.

El backend es Supabase: la mayoría de operaciones de guardado pasan por RPCs (`services/db.js`, `services/supabaseClient.js`), no acceso directo a tablas desde el cliente. Todas las tablas `db_*` tienen RLS `using (false)`: todo pasa por RPCs `security definer` que validan un token de sesión contra `db_sessions` (ver session token en `supabaseClient.js`). El SQL de arranque/al-día de un proyecto de Supabase es **un solo archivo, `supabase-setup-final-v2.sql`** (reemplaza a la cadena vieja de `supabase-setup-completo.sql` + `supabase-storage-setup.sql` + `supabase-security-lockdown.sql` + migraciones sueltas) — es seguro volver a correrlo entero en un proyecto que ya lo corrió antes (todo usa `IF NOT EXISTS`/`OR REPLACE`/`DROP POLICY IF EXISTS`). Cualquier cambio de base de datos nuevo se agrega ahí como sección nueva al final, nunca como un archivo `.sql` suelto aparte (ver la regla fija de arriba).

## Ya resuelto (no volver a tocar salvo que se reporte que sigue roto)

- Sueldos: cuenta solo con `payrollSnapshot` congelado en `processDay()`, no en vivo (`DispatchPage.jsx`/`PayrollPage.jsx`).
- Tarifa Bs/carrera: cada día usa la tarifa vigente ESE día (`rateForDate`), no la de hoy.
- Despacho: los campos editables ya no arrastran el valor del día anterior (`key` incluye la fecha).
- Día procesado permite cambiar de fecha (antes quedaba pegado en el historial).
- Comprobante de pago en Notas se muestra como link "📎 Ver comprobante", no como URL plana.
- "Editar cliente"/"Renovar" desde una nota: navegan y abren el modal correcto (`pendingClientAction`), y ya vuelven solos a Notas al guardar Y al cancelar (`fromNote`/`onReturnToNotes`).
- WhatsApp automático al marcar "Cumplida" una nota de renovación (`NotesPage.jsx`).
- PWA no instalaba: era Vercel Deployment Protection (SSO) bloqueando `manifest.json` en preview — hay que usar el dominio de producción o desactivar esa protección. SW con `autoUpdate` + chequeo horario (ahora reemplazado por `prompt` + banner visible, ver última entrada).
- Modal de columnas ahora usa `<dialog>` nativo (antes quedaba debajo de la tabla).
- Formularios del portal cliente unificados a `col-12` (antes tamaños dispares).
- Botones Editar/Renovar de notas diferenciados por color (`info`/`violet`).
- Orden de columnas en tablas: le faltaba el CSS (`.th-sortable` etc.), la lógica ya existía.
- Campanita de notas: contaba siempre 0 (hardcodeado), ahora cuenta pendientes reales.
- Login: footer de Términos quedaba al costado en pantallas anchas (faltaba `flex-column`).
- Borrado de ruta/driver/usuario/cliente confirmado real en base de datos, no solo visual.
- Ícono de "ver contraseña" se veía redondo por una regla `.btn` sin ámbito en `ClientePage.css` que se filtraba a todas las páginas (bundling global de CSS, ver "Notas generales").
- Botón "Compartir esta app": ahora muestra texto "Link copiado ✅" / error explícito, no solo el cambio de ícono.
- Íconos de la PWA con caché `StaleWhileRevalidate` (antes `CacheFirst` de 30 días podía tardar en mostrar un ícono nuevo); `manifest.json` con `NetworkFirst`.
- Armonización de colores por función en botones de tabla (`icon-btn info/success/warning/violet`) en todas las páginas del panel, más la variable `--panel-violet` por tema.
- Tema y preferencias de columnas ahora viajan con la cuenta (`userPrefs.js` + RPC `staff_save_own_prefs`), no solo con el dispositivo. Requiere secciones 14/15 del SQL corridas.
- Bug de "3 temas mezclados" en Login: 3 hojas de estilo tenían `body { ... }` sin ámbito y se pisaban entre sí — resuelto con `usePageBodyClass.js` (clase por página: `page-login`/`page-cliente`/`page-legal`). De paso, tema Bosque en Login tenía overrides incompletos, ya parejo con Nocturno.
- Botón "+ Crear artículo" sin relleno de color (usaba `outline` en vez de `primary`).
- Despacho: agregada columna "Editar" para abrir la ficha completa del cliente sin ir a Clientes primero.
- Compresión de fotos confirmada en todos los puntos de subida existentes (`imageUpload.js`), sin cambios necesarios.
- Tabla sin ninguna columna visible quedaba en blanco sin ninguna pista — ahora muestra un mensaje ("abrí Columnas para activar alguna").
- "Conectados ahora" en 0: causa real era que `.on('presence','sync')` solo se registraba si había `onChange`, y encima el canal tenía `private: true` sin sentido (esta app no usa JWT de Supabase Auth). Arreglado en `supabaseClient.js`: el binding se registra siempre, y el canal quedó público (igual que la vanilla). Confirmado contra Supabase real: WebSocket conecta, sin errores de RLS en los logs, subidas de foto exitosas post-fix.
- SQL: se sacó un `alter table realtime.messages enable row level security` que Supabase bloquea (jul-2026) y hacía fallar todo el script desde la sección 14 en adelante — sin esa línea (innecesaria, RLS ya viene activado por defecto) las secciones 14/15/16 corren bien. Las 2 policies de presencia de la sección 14 se sacaron del todo (el canal quedó público, no hay nada que evaluar ahí).
- "Pausado" no se quitaba el mismo día al reactivar a mano: 3 mecanismos de pausa (Clientes/Día de trabajo/Editar cliente) no se coordinaban sobre `pauseDates`. Ya sincronizados los 3.
- Formulario de cliente: se agregaron Orden y Observaciones por dirección, columna "Observaciones" y botón "Columnas" en Clientes (`DataTable.jsx` ahora acepta `allColumns` opcional, retrocompatible).
- Configuración en PC: tarjetas de dos columnas con huecos dispares — grid tipo mampostería nuevo (`.settings-grid`), sin tocar `.two-col` que usan Inventario/Métricas.
- Mobile: separación pareja entre menú/Actualizar/Salir; el menú hace scroll automático hacia arriba al abrirse si la página estaba scrolleada.
- Despacho: filtro de "Estado del pedido" ahora incluye "Fuera de horario".
- Edición en línea del link de Maps en Día de trabajo ahora también resuelve links cortos (antes solo desde el formulario completo); lo mismo se agregó al formulario de Clientes (se resuelve al salir del campo, no solo al Guardar).
- Mapa de ruta: geocodifica por Nominatim como último recurso si un cliente queda sin coordenadas, y guarda el resultado para no volver a pedirlo. Línea recta con "P" naranja para clientes sin orden asignado; ruta real por calles (OSRM) cacheada y reutilizada mientras no cambien los clientes/orden.
- Texto obsoleto en Configuración que decía "pendiente" algo ya resuelto (mapa+GPS+foto de respaldo) — borrado.
- Rutinas de limpieza automática que promete la Política de Privacidad (comprobantes/fotos >7 días, clientes inactivos >2 años) — no existían, se crearon en `dataCleanup.js` y se enganchan solas en `OperationsContext.jsx`.
- **(ronda 12 sep, con Supabase/Vercel conectados en vivo)**: tema "a la mitad" en Login (faltaba activar `data-bs-theme` de Bootstrap, ver `useTheme.js`) · `vercel.json` + banner real de "nueva versión disponible" (reemplaza la actualización silenciosa) · formulario de direcciones con más espacio, etiquetas visibles y campo de Coordenadas (se completa solo al resolver el link de Maps) · brillo de texto en todos los botones · inputs a 16px en toda la app (evita el zoom automático de iOS) · Métricas puede usar distancia real por calles (reutilizando el caché de `roadRoute.js`) en vez de solo línea recta · banner de instalación de PWA (Android/PC con `beforeinstallprompt`, iOS con instructivo de Compartir) · code-splitting por ruta (Panel/Cliente ya no vienen en el bundle inicial de Login).
- **(ronda 13 sep)**:
  - **Estilo de las franjas de "Actualización disponible" e "Instalar app" no coincidía**: `UpdateBanner.jsx` (fondo `#1f2a3d`, botón degradado azul) e `InstallBanner.jsx` (fondo plano `#3867f4`, botón blanco) tenían estilos inline distintos y separados. Se extrajeron a `src/components/Banners.css` (`.app-banner`, `.app-banner__btn-primary`, `.app-banner__btn-secondary`) y ambos componentes usan ahora las mismas clases (con el estilo que ya tenía "Actualizar"). De paso, las dos franjas dejaron de tener cada una su propio `position:fixed;top:0` (que hacía que se pisaran si algún día las dos estaban visibles a la vez): ahora comparten un contenedor `.app-banners` en `App.jsx` que las apila una debajo de la otra.
  - **Botón "Actualizar" de Auditoría con estilo distinto a los primarios**: usaba `className="outline"` en vez de `"primary"` (`AuditPage.jsx`). Ya usa `"primary"`, igual que "+ Añadir cliente" y el resto de acciones principales.
  - **"Conectados ahora" actualiza cada 1 minuto**: `usePresence.js` refrescaba por polling cada 4 segundos; se cambió el intervalo a 60000ms (1 minuto), a pedido.
  - **Editar cliente desde Día de trabajo NO te devolvía a Día de trabajo (solo funcionaba bien desde Notas)**: `PanelShell.goToClient()` (en `PanelPage.jsx`) es la función compartida que usan tanto el botón "Editar" de Día de trabajo como "Editar cliente"/"Renovar" de Notas para abrir el formulario en Clientes — pero `ClientsPage` tenía hardcodeado que, sea cual sea el origen, siempre te devolvía a Notas al guardar/cancelar (`fromNote`/`onReturnToNotes` eran un booleano fijo, sin memoria de qué pantalla lo pidió). Ahora `goToClient` guarda el `activePage` real como `origin` dentro de `pendingClientAction`, y `ClientsPage` (renombrado `fromNote`→`returnOrigin`, `onReturnToNotes`→`onReturnToOrigin`) te devuelve exactamente a esa pantalla (Día de trabajo o Notas) al guardar o cancelar el formulario/la renovación.
  - **Coordenadas no se volvían a resolver si se cambiaba el link de Maps**: `resolveShortMapsLinkIfNeeded()` (`services/resolveMapsLink.js`) cortaba apenas veía `addr.lat != null`, sin importar si el link había cambiado — así que una dirección que ya tenía coordenadas de un link viejo nunca intentaba resolver el link nuevo que se pegara encima. Se agregó `mapsResolvedFrom` (guarda cuál fue el link efectivamente resuelto) y ahora solo se saltea la resolución si el link actual es EXACTAMENTE ese mismo; cualquier link distinto (aunque ya hubiera coordenadas) se vuelve a resolver.
  - **La Edge Function `resolve-maps-link` no existía**: el código (`resolveMapsLink.js`) y hasta los comentarios de `image-storage/index.ts` ("igual que resolve-maps-link") la daban por hecha, pero el archivo fuente nunca se había creado en el proyecto — por eso las coordenadas de links cortos (`maps.app.goo.gl/...`) probablemente nunca se estaban resolviendo por este camino (silenciosamente: la función atrapa el error y sigue sin coordenadas). Se creó `supabase/functions/resolve-maps-link/index.ts` (y su copia en `supabase-functions/`, mismo patrón que `image-storage`): sigue la redirección del link corto con `fetch(url, {redirect:'follow'})`, extrae lat/lng de la URL final (o del HTML como respaldo) con los mismos patrones que `extractLatLngFromMapsField` de `dispatchHelpers.js`, y no valida token de sesión (es de solo lectura, sigue un link público). **Falta desplegarla** — ver "Pendiente" más abajo, es el único paso que falta para que esto funcione en producción.

### Convención de colores de botones (documentada en `PanelPage.css`, línea ~291)
- `success` (verde): confirmar/guardar cosas positivas — ej. "✓ Cumplida".
- `warning` (naranja): acciones de alerta suave — ej. "Reprogramar", "Reabrir", "Pausar/Activar".
- `info` (azul): acciones neutras informativas / navegación — ej. "Editar cliente".
- `violet` (morado): acciones especiales/de plan — ej. "Renovar".
- `danger` (rojo) / `.icon-btn.delete`: destructivas — ej. eliminar.
- `primary`: acción principal de un formulario (Guardar).
- `outline`: neutra/secundaria (Cancelar).
- `excel` (verde oscuro): exportar a Excel.

Esta convención ya se aplica tanto a los botones grandes normales (`button.success/.warning/.info/.violet`, con degradado/sombra) como al patrón compacto de tabla (`.icon-btn.success/.warning/.info/.violet`, fondo transparente con tinte suave — ver punto 20 de "ya resuelto"). Si se agrega una acción nueva en cualquier tabla, usar la clase que corresponda por función en vez de dejar `icon-btn` sin variante.

## Pendiente — con pistas de dónde mirar

#### Nota de arquitectura (informativa — no requiere acción)
La vanilla nunca cambia de página al abrir "Editar cliente"/"Renovar" desde una nota (abre el modal encima de Notas, sin navegar) — por eso nunca tuvo la categoría de bug que sí apareció en React al elegir navegar a Clientes y abrir el modal ahí (ya parchado). Si en algún momento se quiere eliminar de raíz esta clase de bug en vez de parchear cada síntoma, la opción es migrar esas acciones rápidas a un modal que nunca navegue.

#### ✅ Confirmado en paridad total con `panel.html`
Roles a medida · Backfill de días + vencimiento de Premium · Ruteo real por calles OSRM con caché reutilizable (`services/roadRoute.js`, ahora también usado por Métricas) · GPS en vivo del driver · Reasignación masiva de clientes entre planes · Congelamiento de Despacho en días procesados · Polling en Despacho · Métricas (KPIs, comparación de periodos, distancia real por calles opcional, ranking, Excel) · Descuento/reposición automática de inventario · Auditoría · WhatsApp de confirmación en notas · Exportar/Importar JSON · Plan de la cuenta.

### Sigue abierto
1. **Desplegar la Edge Function `resolve-maps-link` (recién creada, ronda 13 sep)** — sin este paso, el fix de "las coordenadas no se re-resolvían al cambiar el link" no tiene efecto real en producción: el código ya la llama correctamente, pero si la función no está desplegada, `resolveShortMapsLinkIfNeeded` sigue guardando la dirección sin coordenadas (falla en silencio, a propósito, para no romper el guardado normal). Correr:
   ```
   supabase functions deploy resolve-maps-link --no-verify-jwt
   ```
   No necesita ninguna sección nueva de `supabase-setup-final-v2.sql` (no toca tablas ni RLS, solo seguir un link público) ni variables de entorno extra. Para confirmar que quedó bien: pegar un link corto de Maps (`maps.app.goo.gl/...`) en una dirección de Clientes, salir del campo, y ver que aparece "✓ resuelto" al lado de "Coordenadas".
2. **PWA en un dispositivo real** — el código (ícono que se actualiza, banner de "Compartir", y ahora también el de "Instalar") compila y pasa lint, pero falta que alguien lo confirme mirando un celular/PC real: abrir la PWA instalada, ver el toast de compartir, y en un navegador nuevo ver que aparece el cartel de instalar (Android/PC) o las instrucciones de Agregar a inicio (iOS).
3. `cleanupOldDeliveryPhotos` y el borrado de clientes inactivos piden cada uno por su lado todo el historial de entregas (`dbGetAllDeliveryStatus`). Hoy no es un problema; con años de datos convendría traerlo una sola vez y compartirlo entre los dos.
4. Sacar los `console.warn('[presencia] ...')` de `supabaseClient.js` una vez que se confirme en pantalla que "Conectados ahora" ya cuenta bien en producción (la causa ya está arreglada y verificada contra los logs reales de Supabase, pero falta la confirmación visual).

### Lección para quien continúe
Cuando el dueño reporte que algo "dejó de andar" o "no coincide con lo que arreglamos", antes de asumir un bug de código nuevo, preguntar/verificar si su carpeta local (la que efectivamente se publica) está al día con el último ZIP entregado — ya pasó una vez que el sitio en Vercel corría un build viejo por ese desfasaje.

### Notas generales
- El CSS no usa CSS Modules: todo lo importado en cualquier `.jsx` se bundlea junto y aplica globalmente. Cualquier regla nueva que no empiece con una clase contenedora específica (`.portal`, `.panel-shell`, `body.page-login`, etc.) puede filtrarse a otras páginas sin querer.
- No instalar dependencias nuevas sin verificar que existan en `package.json`.
- **Regla fija del principio de este archivo: toda entrega de código va siempre con el .zip completo Y este prompt actualizado**, y si tocó base de datos, también el `.sql` con el cambio ya integrado.

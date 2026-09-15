# Estado del código: comentarios + auditoría de base de datos

Índice de dos rondas de revisión ya cerradas: (1) qué archivos tienen sus
comentarios revisados/resumidos (explican el "por qué" de una decisión
puntual, no el "qué" — eso ya lo dice el código — y no les quedó pegado
ningún comentario sobre un bug ya arreglado), y (2) la auditoría de
`supabase-setup-final.sql` sobre borrado automático y seguridad de
re-ejecución. Sirve para que la próxima persona (o IA) que trabaje en el
proyecto sepa qué ya se revisó sin tener que releer todo de cero.

**No queda ningún pendiente abierto de esta lista** — de acá en más, lo que
siga es lo que salga de las pruebas manuales sobre `v43`.

## ✅ Ya revisados (proyecto completo)

Se pasó por los ~78 archivos de `src/` buscando dos cosas: (1) comentarios que
narran un bug ya resuelto ("antes esto fallaba porque...", fechas, "RONDA",
"BUG:", etc.) y (2) relleno que repite lo que el código ya dice solo. Se
encontraron y limpiaron 4 casos nuevos en esta pasada:

| Archivo | Qué tenía | Qué quedó |
|---|---|---|
| `src/components/panel/ColumnsModal.jsx` | "Antes este `<dialog>` se renderizaba con `open` a mano..." | Solo la razón de usar `showModal()`/`close()` nativos. |
| `src/components/login/ShareAppButton.jsx` | "Antes solo había un booleano 'copied'..." | Solo qué hace cada estado (`idle`/`copied`/`error`). |
| `src/components/cliente/icons.jsx` | "Reemplazan a los emojis que se usaban antes..." | Solo por qué íconos de línea en vez de emojis (consistencia entre sistemas operativos). |
| `src/services/db.js`, `dispatchHelpers.js`, `userPrefs.js`, `columnPrefs.js`, y el resto de servicios/hooks | Revisados uno por uno | Ya estaban bien — comentarios de arquitectura/decisión, no de historial. Sin cambios. |

Todo el resto del repo (páginas, componentes de Login/Portal cliente/Panel,
hooks, servicios, `main.jsx`, `App.jsx`, CSS) ya se había limpiado en rondas
anteriores y se re-confirmó en esta pasada con una barrida automática de
patrones ("antes...", fechas tipo "13 sep", "RONDA", "BUG", "FIX", "se
corrigió", etc.) — no aparecieron más casos. `npm run build` compila sin
errores después de todos los cambios.

## ✅ Auditoría de base de datos (`supabase-setup-final.sql`)

Las dos preguntas pendientes de la ronda anterior, resueltas:

**1. ¿Todo lo que crece con el uso diario tiene borrado automático?**
Se revisó cada tabla y cada campo que se llena solo con el uso normal
(no con acciones puntuales del staff, que esas quedan hasta que alguien
las borra a propósito). Encontrado un caso real sin cubrir: los
**movimientos de inventario** (Cocina) NO viven en una tabla con columna
`date` como el resto — están guardados como un array dentro del JSON de
`db_inventario` (fila única `'main'`). Cada día procesado con vínculos de
consumo le agrega movimientos nuevos (`DispatchPage.jsx`) y nada los
recortaba nunca: ese payload iba a crecer para siempre. Fix: nuevo cron
`trim-inventory-movements` (sección 13) que recorta el array a movimientos
de los últimos 2 años, mismo criterio que `delivery_status` y
`dispatch_snapshots`. El resto ya estaba bien cubierto (audit_log 15 días,
intentos de login 1 día, sesiones 6 meses tras vencer, fotos del bucket 15
días, clientes inactivos por código de la app). De paso se corrigió el
comentario de cabecera del script, que decía "delivery_status 7d" y "fotos
7 días" — desactualizado, los valores reales ya eran 2 años y 15 días
respectivamente, y no mencionaba el cron de sesiones.

**2. ¿Se puede volver a correr entero sobre una empresa ya existente sin
perder datos?** Sí, confirmado con una barrida completa: las 11 tablas
usan `create table if not exists`, los 4 índices usan `create index if
not exists`, las 44 funciones usan `create or replace function`, las 15
`create policy` tienen su `drop policy if exists` correspondiente antes
(verificado 1 a 1), los 7 cron jobs se desprograman con
`cron.unschedule` antes de volver a programarse (el job de clientes
inactivos es el único que solo desprograma, a propósito — lo maneja el
código de la app), y los `insert` de arranque (bucket de Storage, filas
`'main'` de clientes/personal/inventario) usan `on conflict do nothing`.
No se encontró ningún punto que rompa o duplique datos al re-correrlo.

Entregado en `catering-control-react-v43.zip`.

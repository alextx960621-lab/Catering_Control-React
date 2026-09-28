import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile } from './_helpers.js';

// Sesiones, cache del portal y el corte del autoservicio viven en varios archivos y en el SQL.
// Como en el resto de la suite, se vigila el texto: nada de esto se puede instanciar sin DOM ni red.
const session = repoFile('src/services/session.js');
const login = repoFile('src/pages/LoginPage.jsx');
const panelPage = repoFile('src/pages/PanelPage.jsx');
const clientePage = repoFile('src/pages/ClientePage.jsx');
const clienteData = repoFile('src/services/clienteData.js');
const clienteStorage = repoFile('src/services/clienteStorage.js');
const portal = repoFile('src/components/cliente/Portal.jsx');
const keys = repoFile('src/services/storageKeys.js');
const sql = repoFile('install/supabase-setup-final.sql');
const sqlCode = sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');

function sqlBody(fnSignature) {
  const start = sql.indexOf(fnSignature);
  assert.notEqual(start, -1, `no se encontró ${fnSignature} en el setup`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `no se encontró el cierre de ${fnSignature}`);
  return sql.slice(start, end);
}

// Cuerpo de `export function NAME(...)` hasta el siguiente export
function fn(text, name) {
  const start = text.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `no se encontró export function ${name}`);
  const end = text.indexOf('\nexport ', start + 1);
  return text.slice(start, end === -1 ? text.length : end);
}

// Sin comentarios: las explicaciones mencionan a la función muerta y falsearían los doesNotMatch
const stripComments = (text) => text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').replace(/--.*$/, '')).join('\n');

// Falla 1: clearSessions() borraba también la sesión de cliente, que en la PWA es la única que…
// persiste, así que el logout de un staff en el mismo teléfono expulsaba al cliente.
test('el logout de staff no toca la sesión del cliente y viceversa', () => {
  assert.doesNotMatch(session, /export function clearSessions/, 'volvió a existir clearSessions(): borra las dos sesiones a la vez');
  for (const file of ['src/pages/PanelPage.jsx', 'src/pages/ClientePage.jsx', 'src/pages/LoginPage.jsx', 'src/services/session.js']) {
    assert.doesNotMatch(stripComments(repoFile(file)), /clearSessions\(/, `${file} sigue llamando a clearSessions()`);
  }
  const staffClear = fn(session, 'clearStaffSession');
  assert.match(staffClear, /sessionStorage\.removeItem\(STORAGE_KEYS\.staffSession\);/, 'clearStaffSession debe borrar la sesión de staff');
  assert.doesNotMatch(staffClear, /STORAGE_KEYS\.clientSession/, 'clearStaffSession no puede tocar la sesión de cliente');
  const clientClear = fn(session, 'clearClientSession');
  assert.match(clientClear, /sessionStorage\.removeItem\(STORAGE_KEYS\.clientSession\);/, 'clearClientSession debe limpiar sessionStorage');
  assert.match(clientClear, /localStorage\.removeItem\(STORAGE_KEYS\.clientSession\);/, 'clearClientSession debe limpiar localStorage (PWA)');
  assert.doesNotMatch(clientClear, /STORAGE_KEYS\.staffSession/, 'clearClientSession no puede tocar la sesión de staff');
  assert.match(panelPage, /import \{[^}]*clearStaffSession[^}]*\} from '\.\.\/services\/session';/, 'PanelPage debe importar clearStaffSession');
  assert.match(clientePage, /import \{[^}]*clearClientSession[^}]*\} from '\.\.\/services\/session';/, 'ClientePage debe importar clearClientSession');
});

// Con las dos sesiones abiertas a la vez (mismo teléfono, panel y portal) no se elige al azar.
test('LoginPage desempata con la última entrada de la pestaña y no redirige sin marca', () => {
  assert.match(keys, /lastLoginOrigin/, 'storageKeys.js debe declarar la llave lastLoginOrigin');
  assert.match(session, /export function markLastLogin\(origin\)/, 'session.js debe exportar markLastLogin');
  assert.match(session, /export function readLastLoginOrigin\(\)/, 'session.js debe exportar readLastLoginOrigin');
  // La marca la escriben los dos logins, no quien la lee
  assert.match(fn(session, 'writeStaffSession'), /markLastLogin\('staff'\);/);
  assert.match(fn(session, 'writeClientSession'), /markLastLogin\('client'\);/);
  assert.match(login, /readLastLoginOrigin/, 'LoginPage debe leer la marca de la última entrada');
  assert.match(login, /if \(existingStaff && existingClient\) \{/, 'LoginPage tiene que tener la rama de sesiones cruzadas');
  assert.match(login, /if \(!origin\) return;/, 'sin marca no se puede adivinar: se muestra el formulario');
  assert.match(login, /navigate\(origin === 'client' \? '\/cliente' : '\/panel'\);/);
});

// Falla 3: writeClientRow se escribía antes de la confirmación; la ruta rápida del portal pintaba…
// un "Pausado" que la base nunca tuvo (db* devuelve false, no tira).
test('el cache de la fila del cliente se escribe solo si la base confirmó', () => {
  const body = clienteData.slice(clienteData.indexOf('export async function saveClient'));
  const write = body.indexOf('writeClientRow(updatedClient)');
  assert.notEqual(write, -1, 'saveClient perdió su escritura de cache');
  const guard = body.lastIndexOf('if (saved)', write);
  assert.notEqual(guard, -1, 'saveClient escribe el cache sin comprobar el resultado');
  assert.ok(guard < write, 'writeClientRow debe ir DESPUÉS del guard, no antes');
  assert.match(body, /return saved;/, 'saveClient debe devolver el resultado real de la base');
});

// Falla 10: getClientTheme() ignoraba el clientId: dos clientes del mismo teléfono se pintaban el…
// portal uno al otro. La llave genética queda solo para el login (useTheme).
test('el tema del portal se guarda por cliente', () => {
  assert.match(clienteStorage, /const clientThemeKey = \(clientId\) => `\$\{STORAGE_KEYS\.uiTheme\}:\$\{clientId \|\| 'default'\}`;/,
    'la llave del tema tiene que llevar el clientId');
  assert.match(clienteStorage, /export function getClientTheme\(clientId\)/);
  assert.match(clienteStorage, /export function saveClientTheme\(clientId, theme\)/);
  assert.match(clientePage, /getClientTheme\(localClient\.id\)/, 'ClientePage debe pedir el tema del cliente que entró');
});

// Falla 2: el corte del autoservicio se medía con la hora del teléfono del cliente (22:00 fijo).
test('el corte del autoservicio lo pone el servidor, no la relojera del cliente', () => {
  assert.doesNotMatch(portal, /new Date\(\)\.getHours\(\)/, 'Portal sigue mirando la hora del aparato para el corte');
  assert.match(portal, /function pastCutoff\(\) \{\s*return Boolean\(data\.autoservicioCerrado\);/,
    'pastCutoff debe leer la marca que trae el catálogo');
  // Las dos fusiones del catálogo tienen que propagar la marca, si no nunca llega al portal
  const merges = [...clientePage.matchAll(/const merged = \{[^;]*autoservicioCerrado[^;]*;/g)];
  assert.equal(merges.length, 2, 'ClientePage debe propagar autoservicioCerrado en la carga y en el resync');
  assert.match(sqlCode, /'autoservicioCerrado', public\._autoservicio_cerrado\(\)/, 'get_portal_catalog debe exponer la marca');
  assert.match(sqlCode, /create or replace function public\._autoservicio_cerrado\(\)/);
  assert.match(sqlCode, /revoke all on function public\._autoservicio_cerrado\(\) from public;/,
    'el helper interno no puede quedar ejecutable desde el portal');
  assert.match(sqlCode, /select extract\(hour from now\(\) at time zone get_company_timezone\(\)\)::int >= 22;/,
    'la regla de las 22:00 se mide con la hora local de la empresa');
});

// El candado del portal también tiene que estar en la base: si no, un POST directo al RPC lo salta.
test('los RPCs del cliente rechazan el autoservicio fuera de hora', () => {
  const override = sqlBody('create or replace function public.set_client_address_override(');
  assert.match(override, /if public\._autoservicio_cerrado\(\) then\s*raise exception/i);
  assert.doesNotMatch(override, /extract\(hour from v_now_local\)/, 'set_client_address_override volvió a calcular la hora por su cuenta');
  const profile = sqlBody('create or replace function public.cliente_save_profile(');
  assert.match(profile, /and public\._autoservicio_cerrado\(\) then/);
  assert.match(profile, /v_key in \('pauseStart', 'returnDate'\)/, 'el candado sigue dentro de la rama de pausa/retorno');
});

// La marca de versión del archivo y el literal que se guarda en db_app_version no pueden divergir.
test('la marca de esquema del setup coincide con el literal de db_app_version', () => {
  const header = sql.match(/^-- version de esquema: (\d+\.\d+)/m);
  assert.ok(header, 'la línea 2 del setup perdió la marca "version de esquema: X.Y"');
  const insert = sql.match(/jsonb_build_object\('esquema', '(\d+\.\d+)'/);
  assert.ok(insert, 'no se encontró el INSERT de db_app_version con su literal de esquema');
  assert.equal(header[1], insert[1], `el encabezado dice ${header[1]} y la base va a quedar en ${insert[1]}`);
});

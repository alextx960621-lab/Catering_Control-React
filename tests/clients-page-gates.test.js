import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile } from './_helpers.js';

// ClientsPage tampoco se puede instanciar (necesita React, contexto y red): se vigila el texto.
const src = repoFile('src/components/panel/clients/ClientsPage.jsx');
// Sin comentarios: las explicaciones repiten los identificadores y falsearían los indexOf
const code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function nth(haystack, needle, n = 1) {
  let i = -1;
  for (let k = 0; k < n; k++) {
    i = haystack.indexOf(needle, i + 1);
    assert.notEqual(i, -1, `no se encontró la aparición ${n} de "${needle}" en ClientsPage.jsx`);
  }
  return i;
}

// De `from` (n-ésima aparición) hasta `to`, exclusivo
function slice(from, to, n = 1) {
  const start = nth(code, from, n);
  const end = code.indexOf(to, start);
  assert.notEqual(end, -1, `no se encontró el cierre "${to}" después de "${from}"`);
  return code.slice(start, end);
}

// Falla 5: una dirección que el cliente pasó como link de Maps (sin texto) existía igual; filtrar
// por `address` la botaba y se perdían link, coordenadas, orden y observaciones al Guardar.
test('hasAddressData considera datos el link de Maps y las coordenadas, no solo la dirección', () => {
  assert.match(
    code,
    /const hasAddressData = \(a\) => Boolean\(\(a\.address \|\| ''\)\.trim\(\) \|\| \(a\.maps \|\| ''\)\.trim\(\) \|\| a\.lat != null \|\| a\.lng != null\);/,
    'hasAddressData debe aceptar address, maps, lat o lng'
  );
  assert.ok(code.includes('addresses.filter(hasAddressData).map(resolveShortMapsLinkIfNeeded)'),
    'handleSubmit debe filtrar con hasAddressData antes de resolver los links');
  assert.doesNotMatch(code, /addresses\.filter\(\((\w+)\) => \1\.address\)/,
    'handleSubmit volvió a filtrar direcciones solo por el texto de address');
});

// Falla 6: borrar una dirección arrastraba las franjas del horario semanal que apuntaban a ella,
// y se guardaba sin aviso.
test('quitar una dirección avisa si el horario semanal la referencia', () => {
  const body = slice('function remove(i) {', 'const next = addresses.filter');
  assert.match(body, /const referencing = schedule\.filter\(\(row\) => row\.addressId === removed\?\.id && row\.days\.length\)\.length;/,
    'remove() debe contar las franjas que apuntan a la dirección que se va');
  assert.match(body, /if \(referencing && !window\.confirm\(t\('panel\.clients\.removeAddressScheduleConfirm', \{ count: referencing \}\)\)\) return;/,
    'remove() debe pedir confirmación antes de llevarse las franjas por delante');
  assert.match(code, /function AddressRows\(\{[^}]*schedule = \[\][^}]*\}\)/, 'AddressRows debe recibir el schedule');
  assert.match(code, /<AddressRows[^>]*schedule=\{schedule\}/, 'el JSX debe pasarle el schedule a AddressRows');
});

// Falla 6 (segunda mitad): si aun así caen franjas, el guardado tiene que decirlo.
test('handleSubmit avisa cuántas franjas del horario se fueron y no cuenta las del horario bloqueado', () => {
  // handleSubmit hay dos (la del modal de plan y la del formulario de cliente): es la segunda
  const body = slice('async function handleSubmit(form) {', 'const saved = await saveClients([c]);', 2);
  assert.match(body, /const droppedScheduleRows = scheduleLocked \? 0 : schedule\.length - finalSchedule\.length;/,
    'con el horario bloqueado (scheduleLocked) no se botó ninguna franja: no hay que avisar nada');
  assert.match(body, /const finalSchedule = schedule\.filter\(\(row\) => row\.days\.length && finalAddressIds\.has\(row\.addressId\)\);/,
    'finalSchedule debe filtrar por las direcciones que sobrevivieron');
});

// Falla 8: correr el orden de los demás era un segundo guardado; si el primero fallaba igual se
// escribía, dejando dos clientes con el mismo número en la base.
test('el guardado del cliente manda: sin éxito no corre el orden de los demás y ambos fallos se avisan', () => {
  const tail = slice('const saved = await saveClients([c]);', 'setOrderShift(null);\n    }');
  assert.match(tail, /if \(saved && orderShift\) \{/, 'el corrimiento de orden debe ir detrás del guardado del cliente');
  assert.match(tail, /if \(shifted\.length && !\(await saveClients\(shifted\)\)\) showNotice\(t\('panel\.clients\.shiftOrdersSaveFailed'\), true\);/,
    'el segundo guardado también tiene que comprobarse (db* devuelve false, no tira)');
  const notices = slice("if (!saved) showNotice(t('panel.clients.clientSaveFailed')", 'dbInsertAudit');
  assert.match(notices, /else if \(droppedScheduleRows > 0\) showNotice\(t\('panel\.clients\.scheduleRowsDroppedNotice', \{ count: droppedScheduleRows \}\), true\);/,
    'el aviso de franjas perdidas debe ir antes del "Cliente guardado"');
  assert.match(notices, /else showNotice\(t\('panel\.clients\.clientSaved'\)\);/, 'el camino feliz sigue avisando "Cliente guardado."');
});

// Falla 7: togglePause usaba `currentDate`, que es la fecha que se está mirando (puede ser pasada
// o futura); el botón de pausar/activar habla de HOY.
test('togglePause y su botón usan serverToday, no la fecha que se está mirando', () => {
  const body = slice('function togglePause(c) {', 'function openRenew');
  assert.match(body, /dispatchStatus\(c, serverToday, dayInfoToday\)/, 'togglePause debe preguntar el estado del hoy operativo');
  assert.match(body, /pauseStart: current === 'Pausado' \? '' : serverToday/, 'togglePause debe escribir serverToday en pauseStart');
  assert.doesNotMatch(body, /currentDate/, 'togglePause volvió a usar currentDate (la fecha en pantalla, no el hoy)');
  assert.match(body, /\.then\(\(saved\) => \{\s*if \(!saved\) \{ showNotice\(t\('panel\.clients\.clientSaveFailed'\), true\); return; \}/,
    'togglePause debe avisar si el guardado devolvió false');
  assert.match(code, /const dayInfoToday = days\[serverToday\] \|\| \{ laborable: true \};/, 'dayInfoToday debe derivar de serverToday');
  assert.match(code, /const \{[^}]*serverToday[^}]*\} = useOperations\(\)/, 'ClientsPage debe traer serverToday del contexto');
  const start = nth(code, '<button className={`icon-btn ${dispatchStatus');
  assert.match(code.slice(start, start + 240), /dispatchStatus\(c, serverToday, dayInfoToday\)/,
    'la etiqueta del botón debe coincidir con lo que escribe togglePause');
});

// Nadie puede dejar claves i18n inventadas: toda clave t(...) del archivo existe en los tres idiomas
test('las claves i18n usadas por ClientsPage existen en es/en/pt', () => {
  const keys = [...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'esperaba al menos una clave t(...) en el archivo');
  // i18next resuelve los plurales con sufijo (_one/_other, en otros idiomas _zero/_few/_many)
  const SUFIJOS = ['', '_zero', '_one', '_two', '_few', '_many', '_other'];
  for (const lang of ['es', 'en', 'pt']) {
    const dict = JSON.parse(repoFile(`src/i18n/locales/${lang}.json`));
    for (const key of new Set(keys)) {
      const parts = key.split('.');
      const leaf = parts.pop();
      const parent = parts.reduce((o, k) => (o == null ? undefined : o[k]), dict);
      const existe = typeof parent?.[leaf] === 'string' || SUFIJOS.some((s) => typeof parent?.[`${leaf}${s}`] === 'string');
      assert.ok(existe, `la clave "${key}" no existe en i18n/${lang}.json`);
    }
  }
});

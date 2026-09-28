import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile } from './_helpers.js';

// OperationsContext no se puede instanciar sin React/DOM ni red, así que se vigila la deriva de
// código sobre el texto del archivo (el mismo truco de sql-invariants.test.js).
const src = repoFile('src/context/OperationsContext.jsx');
// Sin comentarios: las explicaciones citan los propios identificadores y falsearían los índices
const code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// Cuerpo de un `const NAME = useCallback(...)` hasta el cierre de sus deps
function callbackBody(name) {
  const start = code.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `no se encontró ${name} en OperationsContext.jsx`);
  const end = code.indexOf('\n  }, [', start);
  assert.notEqual(end, -1, `no se encontró el cierre de deps de ${name}`);
  return code.slice(start, end);
}

// Bug B: saveDays no puede tocar el estado local antes del guard de confirmación
test('saveDays: el guard de confirmación corre antes del primer setDays(', () => {
  const body = callbackBody('saveDays');
  const guard = body.indexOf('confirmed.current.days');
  const set = body.indexOf('setDays(');
  assert.notEqual(guard, -1, 'saveDays perdió el guard de confirmed.current.days');
  assert.notEqual(set, -1, 'saveDays perdió su setDays');
  assert.ok(guard < set, 'setDays corre antes del guard de confirmación: la pantalla puede mostrar días que la base no tiene');
});

// Bug B: si la escritura falla (db* devuelve false, no tira), lo mostrado se revierte
test('saveDays revierte con setDays(prev) cuando la escritura falla', () => {
  const body = callbackBody('saveDays');
  assert.match(body, /if \(!ok\) setDays\(prev\);/, 'saveDays debería revertir el estado local si la escritura devolvió false');
  assert.ok(body.indexOf('const prev = daysRef.current;') < body.indexOf('setDays(newDays)'), 'el snapshot previo tiene que capturarse antes del set');
});

test('saveInventory: guard antes del set y rollback con setInventory(prev)', () => {
  const body = callbackBody('saveInventory');
  const guard = body.indexOf('confirmed.current.inventory');
  const set = body.indexOf('setInventory(inv)');
  assert.notEqual(guard, -1, 'saveInventory perdió el guard de confirmed.current.inventory');
  assert.ok(guard < set, 'setInventory corre antes del guard de confirmación');
  assert.match(body, /if \(!ok\) setInventory\(prev\);/, 'saveInventory debería revertir si dbSet devolvió false');
});

// Los cuatro escritores de listas comparten la misma forma que saveDays/saveInventory: snapshot previo
// -> set local -> escritura -> rollback si db* devolvió false.
[['saveClients', 'setClients('], ['saveNotes', 'setNotes('], ['deleteNote', 'setNotes('], ['deleteClients', 'setClients(']].forEach(([name, setter]) => {
  test(`${name} captura el estado previo y revierte cuando la escritura falla`, () => {
    const body = callbackBody(name);
    assert.ok(body.includes(setter), `${name} no hace su set local con ${setter}`);
    const snapshot = body.indexOf('const prev =');
    assert.notEqual(snapshot, -1, `${name} no captura el estado previo (const prev = ...Ref.current)`);
    assert.ok(snapshot < body.indexOf(setter), `${name}: el snapshot previo debe capturarse antes del set local`);
    assert.ok(body.includes(`if (!ok) ${setter}prev);`), `${name} debería revertir con ${setter}prev) si la escritura devolvió false`);
    assert.match(body, /return Promise\.resolve\(/, `${name} debe normalizar la escritura a promesa (Promise.resolve)`);
  });
});

// Bug A: serverToday arranca con la fecha UTC del navegador; dateConfirmed es lo único que distingue
// "confirmada por el servidor" de "bulto de arranque". El default YYYY-MM-DD no se puede cambiar por
// '' ni null: PayrollPage corta currentDate con .slice(0, 7) y varias comparaciones esperan la fecha.
test('dateConfirmed: se marca al confirmar la fecha y el fallo de arranque la contempla', () => {
  assert.match(code, /const \[serverToday, setServerToday\] = useState\(new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\);/,
    'el estado inicial de serverToday debe seguir siendo YYYY-MM-DD (varias pantallas lo cortan con .slice)');
  assert.match(code, /if \(d\) \{ dateConfirmed\.current = true; setServerToday/,
    'syncToday (retry cada 60 s) debe marcar dateConfirmed cuando consigue la fecha');
  assert.match(code, /const anyFailed[^;]*!dateConfirmed\.current;/,
    'el aviso de fallo parcial del boot debe entrar si la fecha quedó sin confirmar');
  assert.match(code, /const anyFailed[^;]*!refreshedDate;/,
    'refreshAll debe contar la fecha sin traer como fallo');
});

// Nadie puede usar claves i18n inventadas acá (otro agente toca los locales): toda clave t(...) del
// archivo tiene que existir en los tres idiomas
test('las claves i18n usadas por OperationsContext existen en es/en/pt', () => {
  const keys = [...src.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'esperaba al menos una clave t(...) en el archivo');
  for (const lang of ['es', 'en', 'pt']) {
    const dict = JSON.parse(repoFile(`src/i18n/locales/${lang}.json`));
    for (const key of new Set(keys)) {
      const value = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
      assert.equal(typeof value, 'string', `la clave "${key}" no existe en i18n/${lang}.json`);
    }
  }
});

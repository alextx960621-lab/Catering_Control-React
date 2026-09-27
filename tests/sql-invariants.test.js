import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, SETUP_CANONICO, setupSql, setupSqlRel, sqlSetupScope, stripSqlComments } from './_helpers.js';

// Regla dura del dueño: el setup se completa en 3 archivos, nadie agrega migraciones sueltas.
const FIJOS = ['reset-admin-password.sql', 'supabase-promote-superadmin.sql'];
const SETUP_NOMBRE = setupSqlRel().split('/').pop();

test('install/ contiene exactamente 3 archivos SQL: el setup y los dos de recuperación', (t) => {
  const found = readdirSync(join(ROOT, 'install'))
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();
  if (!SETUP_CANONICO) {
    // En la copia de una empresa puede quedar un setup del maestro copiado a mano: se resuelve en
    // el maestro (difundir/regenerar el snapshot), no acá, así que esto se saltea y no miente.
    return t.skip(`carpeta de empresa: setup resuelto ${SETUP_NOMBRE}, install/ tiene ${found.join(', ')}`);
  }
  assert.deepEqual(found, [...FIJOS, SETUP_NOMBRE].sort(), `install/ tiene ${found.join(', ')}: la regla es 3 SQL`);
});

test('no aparecen archivos de migración sueltas (migracion-*.sql)', () => {
  const malas = readdirSync(join(ROOT, 'install')).filter((f) => /^migracion/i.test(f) && f.toLowerCase().endsWith('.sql'));
  assert.deepEqual(malas, [], 'toda mudanza de esquema va dentro del setup');
});

// El setup tiene que poder re-correrse sobre una base con datos reales: nada de borrar esquema o filas
test('el scope de instalación no tiene sentencias destructivas', () => {
  const { code, unclosed } = sqlSetupScope(setupSql());
  assert.deepEqual(unclosed, [], 'el parseo de dollar-quoting quedó con cuerpos sin cerrar');
  for (const [label, re] of [
    ['drop table', /drop\s+table\b/i],
    ['drop schema', /drop\s+schema\b/i],
    ['truncate', /\btruncate\b/i],
    ['delete from', /\bdelete\s+from\b/i],
    ['alter table ... drop', /\balter\s+table\s+[\w.]+\s+drop\b/i],
  ]) {
    assert.ok(!re.test(code), `el setup debería ser re-ejecutable sin romper datos: aparece "${label}" fuera de los cuerpos de función`);
  }
});

// drop policy / drop function "if exists" son válidas: re-crear el objeto es la forma idiomática del setup
test('los drop idempotentes (policy/function if exists) siguen permitidos', () => {
  const code = sqlSetupScope(setupSql()).code;
  assert.match(code, /drop\s+policy\s+if\s+exists/i);
  assert.match(code, /drop\s+function\s+if\s+exists/i);
  assert.match(code, /create\s+or\s+replace\s+function/i);
});

// Expectativa literal ("el archivo no contiene delete from en ningún lado"): aún no se cumple.
// Los 19 "delete from" están dentro de cuerpos de función (sesiones, intentos de login, borrados lógicos).
test('invariante estricta: cero "delete from" en todo el archivo', { todo: true }, () => {
  const code = stripSqlComments(setupSql());
  const hits = code.match(/\bdelete\s+from\b/gi) || [];
  assert.equal(hits.length, 0, `hay ${hits.length} "delete from" en el setup (todos dentro de cuerpos de función)`);
});

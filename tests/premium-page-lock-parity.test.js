import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile, sqlFunctionBody, sqlArrayLiterals, setupSqlRel, SETUP_CANONICO } from './_helpers.js';
import { PREMIUM_DEFAULT_LOCKED } from '../src/services/panelAuth.js';

const SQL = setupSqlRel();

// La lista de páginas bloqueables vive en dos archivos distintos: este test es el candado de esa paridad
test('las páginas bloqueables del SQL coinciden con PREMIUM_DEFAULT_LOCKED', (t) => {
  // En la copia de una empresa el SQL es un snapshot de lo que se corrió en su base: la paridad
  // JS↔SQL se decide en el maestro, que es donde hay que arreglarla.
  if (!SETUP_CANONICO) return t.skip(`carpeta de empresa: ${SQL} es el snapshot de su base, no la fuente de verdad`);
  const body = sqlFunctionBody(repoFile(SQL), '_premium_lockable_pages');
  assert.ok(body, `no se encontró _premium_lockable_pages en el setup (${SQL})`);
  const lockable = sqlArrayLiterals(body);
  assert.ok(lockable.length > 0, '_premium_lockable_pages() devolvió un array vacío o mal parseado');

  assert.deepEqual(
    [...lockable].sort(),
    [...Object.keys(PREMIUM_DEFAULT_LOCKED)].sort(),
    'SQL y JS discrepan en qué páginas se pueden bloquear por plan'
  );
});

test('_premium_default_locked coincide con los booleanos de PREMIUM_DEFAULT_LOCKED', (t) => {
  if (!SETUP_CANONICO) return t.skip(`carpeta de empresa: ${SQL} es el snapshot de su base, no la fuente de verdad`);
  const body = sqlFunctionBody(repoFile(SQL), '_premium_default_locked');
  assert.ok(body, `no se encontró _premium_default_locked en el setup (${SQL})`);
  // En el SQL las páginas nacen en un array = las que vienen bloqueadas de fábrica (true)
  const defaultLocked = sqlArrayLiterals(body);
  assert.ok(defaultLocked.length > 0, '_premium_default_locked() devolvió un array vacío o mal parseado');

  const lockable = sqlArrayLiterals(sqlFunctionBody(repoFile(SQL), '_premium_lockable_pages'));
  for (const page of defaultLocked) {
    assert.ok(lockable.includes(page), `${page} viene bloqueada por defecto pero no es bloqueable: configuración muerta`);
  }

  const esperado = Object.fromEntries(Object.entries(PREMIUM_DEFAULT_LOCKED).map(([k, v]) => [k, v]));
  const actual = Object.fromEntries(
    Object.keys(PREMIUM_DEFAULT_LOCKED).map((k) => [k, defaultLocked.includes(k)])
  );
  assert.deepEqual(actual, esperado, 'el valor default (bloqueado/libre) difiere entre SQL y JS');
});

test('son exactamente las 11 páginas esperadas, con returnDate ya eliminado', () => {
  const keys = Object.keys(PREMIUM_DEFAULT_LOCKED);
  assert.equal(keys.length, 11, 'PREMIUM_DEFAULT_LOCKED debe tener 11 páginas');
  assert.deepEqual([...keys].sort(), [
    'audit',
    'autoReminder',
    'clientPortal',
    'delivery',
    'inventory',
    'manualPush',
    'metrics',
    'notes',
    'payroll',
    'specialDietPrint',
    'weeklySchedule',
  ].sort());
  assert.ok(!('returnDate' in PREMIUM_DEFAULT_LOCKED), 'returnDate se eliminó: no puede volver como página bloqueable');
  assert.deepEqual(
    Object.entries(PREMIUM_DEFAULT_LOCKED).filter(([, v]) => !v).map(([k]) => k).sort(),
    ['audit', 'metrics'],
    'solo Métricas y Auditoría se regalan en el plan Básico'
  );
});

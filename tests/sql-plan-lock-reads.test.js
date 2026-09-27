import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile, setupSqlRel, sqlArrayLiterals, sqlFunctionBody, SETUP_CANONICO } from './_helpers.js';

// El candado de plan tiene que estar en las DOS puntas de cada página bloqueable: la escritura pasa
// por _require_permission (que consulta _plan_blocks) y la lectura tiene que consultarlo también.
// Si falta el segundo, el candado es decorativo: la pantalla se oculta en React pero la RPC
// respondida con el token del propio admin devuelve los datos igual.
// Este test recorre todas las lecturas con _staff_can_view y exige el _plan_blocks de la misma página.

// Exenciones nombradas, con el motivo escrito en el setup. Cada una es una decisión, no un olvido.
const EXCEPTO = {
  // La usa el respaldo completo de Configuración; bloquearla exportaría un respaldo sin historial
  // y restaurarlo borraría filas. La pantalla de Auditoría lee con staff_get_audit_log.
  staff_get_all_audit_log: 'audit',
};

const SQL = setupSqlRel();

test('toda lectura staff_* de una página bloqueable consulta _plan_blocks', (t) => {
  if (!SETUP_CANONICO) return t.skip(`${SQL} es el snapshot de la base de la empresa: se arregla en el maestro`);
  const sql = repoFile(SQL);
  const lockable = sqlArrayLiterals(sqlFunctionBody(sql, '_premium_lockable_pages'));
  assert.ok(lockable.length > 0, 'no se pudo leer _premium_lockable_pages()');

  const lectoras = [...sql.matchAll(/create or replace function public\.(staff_\w+)\s*\(/gi)].map((m) => m[1]);
  assert.ok(lectoras.length > 10, `se esperaban varias funciones staff_*, hay ${lectoras.length}: cambió la forma de declarar?`);

  const malas = [];
  let vistas = 0;
  for (const nombre of lectoras) {
    const body = sqlFunctionBody(sql, nombre) || '';
    for (const page of body.matchAll(/_staff_can_view\(\s*\w+\s*,\s*'([^']+)'/g)) {
      vistas += 1;
      const pagina = page[1];
      if (!lockable.includes(pagina)) continue;
      if (EXCEPTO[nombre] === pagina) continue;
      if (!new RegExp(`_plan_blocks\\(\\s*'${pagina}'`).test(body)) malas.push(`${nombre} (${pagina})`);
    }
  }
  assert.ok(vistas >= 4, `el patrón _staff_can_view apareció ${vistas} veces: el parseo de cuerpos se rompió`);
  assert.deepEqual(malas, [], `lecturas que respetan el rol pero no el plan: ${malas.join(', ')}`);
});

// El caso que motivó el test: los comprobantes son financieros y viven dentro de "notes"
test('staff_listar_comprobantes queda bloqueado en plan Básico', (t) => {
  if (!SETUP_CANONICO) return t.skip(`${SQL} es snapshot de la empresa`);
  const body = sqlFunctionBody(repoFile(SQL), 'staff_listar_comprobantes');
  assert.ok(body, 'no se encontró staff_listar_comprobantes');
  assert.match(body, /_plan_blocks\(\s*'notes'\s*\)/, 'sin este gate un admin de plan Básico lee todos los comprobantes por RPC directa');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile, setupSqlRel, sqlFunctionBody, sqlSetupScope, SETUP_CANONICO } from './_helpers.js';
import { NAV_PERMS } from '../src/services/panelAuth.js';

// El rol se validaba en dos lados con criterios distintos: React filtraba el menú por NAV_PERMS y
// el SQL solo preguntaba "¿es personal?". Así, un token de chofer leía por RPC directa el roster de
// clientes, los snapshots con sueldos y las calificaciones. Estos tests fijan que _staff_can_view()
// sea el espejo servidor de NAV_PERMS y que ninguna lectura se conforme con ser personal.

const SQL = setupSqlRel();
const paginas = Object.keys(NAV_PERMS);

// 'kitchen' y 'driver' declaran su lista de páginas; 'editor' declara las dos que NO ve.
function vistasPorRol(body, rol) {
  const inList = new RegExp(`if p_role = '${rol}' then return p_page in \\(([^)]*)\\)`, 'i').exec(body);
  if (inList) return [...inList[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const notIn = new RegExp(`if p_role = '${rol}' then return p_page not in \\(([^)]*)\\)`, 'i').exec(body);
  if (notIn) {
    const excluidas = [...notIn[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    return paginas.filter((p) => !excluidas.includes(p)).sort();
  }
  return null;
}

test('_staff_can_view() reproduce NAV_PERMS para los roles built-in', (t) => {
  if (!SETUP_CANONICO) return t.skip(`${SQL} es snapshot de la empresa: se arregla en el maestro`);
  const body = sqlFunctionBody(repoFile(SQL), '_staff_can_view');
  assert.ok(body, 'no se encontró el cuerpo de _staff_can_view()');

  for (const rol of ['editor', 'kitchen', 'driver']) {
    const delSql = vistasPorRol(body, rol);
    assert.ok(delSql, `_staff_can_view() ya no declara la lista de páginas de '${rol}' en la forma esperada`);
    const delCliente = paginas.filter((p) => NAV_PERMS[p].includes(rol)).sort();
    assert.deepEqual(delSql, delCliente, `'${rol}' ve páginas distintas en el SQL y en NAV_PERMS`);
  }
});

// Las lectoras de una sola pantalla se gatean por esa página; las que alimentan el arranque del
// Panel (roster, estado de entregas) entran por cualquier página que las necesite, vía
// _staff_can_view_any() o del helper _staff_reads_clients().
const LECTORAS = [
  'staff_get_client_rows', 'staff_get_client_row_ids', 'staff_get_client_rows_since', 'staff_get_client_row',
  'staff_get_snapshot', 'staff_list_snapshot_dates', 'staff_get_all_snapshots',
  'staff_get_delivery_rows', 'staff_get_all_delivery_status', 'staff_get_ratings',
];
const GATE = /_staff_can_view\w*\(|_staff_reads_clients\(/;

test('ninguna lectura de staff se conforma con "es personal"', (t) => {
  if (!SETUP_CANONICO) return t.skip(`${SQL} es snapshot de la empresa: se arregla en el maestro`);
  const sql = repoFile(SQL);
  const sinGate = LECTORAS.filter((fn) => {
    const body = sqlFunctionBody(sql, fn);
    assert.ok(body, `no se encontró el cuerpo de ${fn}()`);
    return !GATE.test(body);
  });
  assert.deepEqual(sinGate, [], `leen con solo ser personal: ${sinGate.join(', ')}`);
});

// _require_staff queda muerta: si alguien la revive, revive también el "cualquier rol ve todo".
test('_require_staff() está borrada del esquema, no solo sin uso', (t) => {
  if (!SETUP_CANONICO) return t.skip(`${SQL} es snapshot de la empresa: se arregla en el maestro`);
  // sqlSetupScope ya quita los comentarios: ahí se explica el drop, no cuenta como llamada.
  const code = sqlSetupScope(repoFile(SQL)).code;
  assert.match(code, /drop\s+function\s+if\s+exists\s+public\._require_staff\(text\)/i);
  assert.doesNotMatch(code, /perform\s+public\._require_staff\(/i, 'apareció una llamada nueva a _require_staff');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchStatus } from '../src/services/dispatchHelpers.js';
import { stateFor } from '../src/services/planHelpers.js';

const DATE = '2026-09-28'; // lunes
const LAB = { laborable: true };
const data = { days: { [DATE]: LAB } };

// Mismo cliente, mismo día: el panel (Día de trabajo) y el portal del cliente deberían decir lo mismo
const CLIENTES = [
  ['sin días cargados', { status: 'Activo' }],
  ['con días por consumir', { paidDays: 10, consumedDays: 2 }],
  ['días agotados', { paidDays: 5, consumedDays: 5, status: 'Activo' }],
  ['programado y sin días', { paidDays: 5, consumedDays: 5, startDate: '2026-10-10' }],
  ['pausado', { paidDays: 10, consumedDays: 2, pauseStart: '2026-09-20' }],
  ['solo lunes del horario', { paidDays: 10, consumedDays: 2, schedule: [{ days: [2, 4], addressId: 'a1' }] }],
];

test('dispatchStatus y stateFor coinciden para el mismo cliente y día', { todo: true }, () => {
  const diferencias = CLIENTES
    .map(([label, c]) => [label, dispatchStatus(c, DATE, LAB), stateFor(data, c, DATE)])
    .filter(([, panel, portal]) => panel !== portal);
  assert.deepEqual(diferencias, [], 'panel y portal muestran estados distintos para el mismo cliente');
});

test('divergencia medida hoy entre panel y portal (_actualizar al unificar las dos funciones)', () => {
  // dispatchStatus exige días pagados pendientes; stateFor solo avisa si paidDays > 0
  assert.equal(dispatchStatus({ status: 'Activo' }, DATE, LAB), 'Retorno pendiente');
  assert.equal(stateFor(data, { status: 'Activo' }, DATE), 'Activo');
  // dispatchStatus mira el horario semanal; stateFor lo ignora por completo
  assert.equal(dispatchStatus({ paidDays: 10, consumedDays: 2, schedule: [{ days: [2] }] }, DATE, LAB), 'Fuera de horario');
  assert.equal(stateFor(data, { paidDays: 10, consumedDays: 2, schedule: [{ days: [2] }] }, DATE), 'Activo');
  // El startDate futuro pierde contra el retorno pendiente en el panel, pero gana en el portal
  assert.equal(dispatchStatus({ paidDays: 5, consumedDays: 5, startDate: '2026-10-10' }, DATE, LAB), 'Retorno pendiente');
  assert.equal(stateFor(data, { paidDays: 5, consumedDays: 5, startDate: '2026-10-10' }, DATE), 'Programado');
});

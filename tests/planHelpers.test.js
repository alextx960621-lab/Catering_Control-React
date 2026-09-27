import { test } from 'node:test';
import assert from 'node:assert/strict';

import { n, fmt, workDate, dayInfo, addDays, nextWorkDay, planFor, stateFor, statusClass } from '../src/services/planHelpers.js';

const LAB = { laborable: true };

test('n: coerce cualquier valor guardado a número, NaN/undefined => 0', () => {
  assert.equal(n('5'), 5);
  assert.equal(n(5), 5);
  assert.equal(n(''), 0);
  assert.equal(n(null), 0);
  assert.equal(n(undefined), 0);
  assert.equal(n('abc'), 0);
  assert.equal(n(0), 0);
  // Ojo: n(false) es 0 porque Number(false) === 0
  assert.equal(n(false), 0);
});

test('fmt: ISO a dd/mm/aaaa y cadena vacía si no hay fecha', () => {
  assert.equal(fmt('2026-09-03'), '03/09/2026');
  assert.equal(fmt(''), '');
  assert.equal(fmt(undefined), '');
  assert.equal(fmt(null), '');
});

test('workDate: usa la fecha del día cargada y si no, la de hoy', () => {
  assert.equal(workDate({ currentDate: '2026-09-28' }), '2026-09-28');
  assert.match(workDate({}), /^\d{4}-\d{2}-\d{2}$/);
});

test('dayInfo: devuelve el día guardado o un default laborable', () => {
  const data = { days: { '2026-12-25': { laborable: false, label: 'Navidad' } } };
  assert.equal(dayInfo(data, '2026-12-25').laborable, false);
  assert.deepEqual(dayInfo(data, '2026-12-26'), { laborable: true });
  assert.deepEqual(dayInfo({}, '2026-12-26'), { laborable: true });
});

test('addDays: bordes de mes, de año y cuenta atrás', () => {
  assert.equal(addDays('2026-09-28', 1), '2026-09-29');
  assert.equal(addDays('2026-09-28', 0), '2026-09-28');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01'); // fin de mes corto (30 días)
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); // año nuevo
  assert.equal(addDays('2026-12-31', 40), '2027-02-09');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28'); // 2026 no es bisiesto
  assert.equal(addDays('2028-03-01', -1), '2028-02-29'); // 2028 sí lo es
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
});

test('nextWorkDay: salta el fin de semana y los feriados cargados', () => {
  const data = { days: { '2026-10-03': { laborable: false }, '2026-10-04': { laborable: false } } };
  assert.equal(nextWorkDay(data, '2026-10-02'), '2026-10-05'); // vie -> sáb off + dom off -> lun
  assert.equal(nextWorkDay({}, '2026-10-02'), '2026-10-03'); // sin feriados cargados, el otro día siempre sirve
});

test('nextWorkDay: borde de año con varios feriados seguidos', () => {
  const data = {
    days: {
      '2026-12-25': { laborable: false },
      '2026-12-26': { laborable: false },
      '2026-12-27': { laborable: false },
    },
  };
  assert.equal(nextWorkDay(data, '2026-12-24'), '2026-12-28');
  assert.equal(nextWorkDay(data, '2026-12-31'), '2027-01-01');
});

test('nextWorkDay: nunca devuelve la misma fecha, aunque ese día sea laborable', () => {
  assert.notEqual(nextWorkDay({ days: { '2026-09-28': LAB } }, '2026-09-28'), '2026-09-28');
});

test('planFor: busca el plan por id y devuelve undefined si no está', () => {
  const data = { plans: [{ id: 'p1', name: 'Básico' }, { id: 'p2', name: 'Premium' }] };
  assert.equal(planFor(data, { planId: 'p2' }).name, 'Premium');
  assert.equal(planFor(data, { planId: 'zz' }), undefined);
  assert.equal(planFor({}, { planId: 'p1' }), undefined);
});

test('stateFor: mismas ramas que el portal, en el orden que las evalúa', () => {
  assert.equal(stateFor({}, { status: 'Activo' }, '2026-09-28'), 'Activo');
  assert.equal(stateFor({ days: { '2026-09-28': { laborable: false } } }, { status: 'Activo' }, '2026-09-28'), 'No laborable');

  assert.equal(stateFor({}, { paidDays: 10, consumedDays: 2, returnDate: '2026-09-28' }, '2026-09-28'), 'Activo');
  assert.equal(stateFor({}, { paidDays: 10, consumedDays: 2, pauseStart: '2026-09-20' }, '2026-09-28'), 'Pausado');
  assert.equal(stateFor({}, { paidDays: 10, consumedDays: 2, pauseDates: ['2026-09-28'] }, '2026-09-28'), 'Pausado');
  assert.equal(stateFor({}, { paidDays: 10, consumedDays: 2, startDate: '2026-10-10' }, '2026-09-28'), 'Programado');
  assert.equal(stateFor({}, { paidDays: 5, consumedDays: 5, status: 'Activo' }, '2026-09-28'), 'Retorno pendiente');
  assert.equal(stateFor({}, { paidDays: 10, consumedDays: 2, status: 'Pausado' }, '2026-09-28'), 'Pausado');
});

test('stateFor: sin paidDays cargados NO avisa retorno pendiente (a diferencia de dispatchStatus)', () => {
  // paidDays = 0 hace que la condición se corte antes: el portal muestra el estado guardado
  assert.equal(stateFor({}, { status: 'Activo' }, '2026-09-28'), 'Activo');
  assert.equal(stateFor({}, { paidDays: 0, consumedDays: 3 }, '2026-09-28'), 'Activo');
});

test('statusClass: Activo success, Pausado warning, resto secondary', () => {
  assert.equal(statusClass('Activo'), 'success');
  assert.equal(statusClass('Pausado'), 'warning text-dark');
  assert.equal(statusClass('Retorno pendiente'), 'secondary');
  assert.equal(statusClass('No laborable'), 'secondary');
});

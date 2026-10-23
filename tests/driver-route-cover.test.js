import { test } from 'node:test';
import assert from 'node:assert/strict';

import { driverRouteIds, driverForRoute, coveringDriver, myRouteIds, effectiveDriverId } from '../src/services/dispatchHelpers.js';

// Ana lleva R1 y Beto lleva R2. Beto falta: Ana cubre R2 como adicional.
const ana = { id: 'a', routeId: 'R1', extraRouteIds: ['R2'] };
const beto = { id: 'b', routeId: 'R2', extraRouteIds: [] };
const normal = [{ ...ana, extraRouteIds: [] }, beto];
const cubriendo = [ana, beto];

test('sin reemplazo: cada driver tiene su ruta', () => {
  assert.deepEqual(driverRouteIds(normal[0], normal), ['R1']);
  assert.deepEqual(driverRouteIds(normal[1], normal), ['R2']);
  assert.equal(driverForRoute(normal, 'R2').id, 'b');
  assert.equal(coveringDriver(normal, normal[1]), null);
});

test('con reemplazo: la ruta marcada como adicional se le quita al dueño y pasa a quien la cubre', () => {
  assert.deepEqual(driverRouteIds(ana, cubriendo).sort(), ['R1', 'R2']);
  assert.deepEqual(driverRouteIds(beto, cubriendo), []);
  assert.equal(driverForRoute(cubriendo, 'R2').id, 'a');
  assert.equal(coveringDriver(cubriendo, beto).id, 'a');
});

test('al desmarcar, la ruta vuelve sola al dueño (nada se guardó en él)', () => {
  const despues = [{ ...ana, extraRouteIds: [] }, beto];
  assert.deepEqual(driverRouteIds(despues[1], despues), ['R2']);
  assert.equal(driverForRoute(despues, 'R2').id, 'b');
});

test('sin pasar la lista de drivers se comporta como antes (principal + adicionales)', () => {
  assert.deepEqual(driverRouteIds(beto), ['R2']);
  assert.deepEqual(driverRouteIds(ana).sort(), ['R1', 'R2']);
});

test('myRouteIds: el dueño cubierto queda sin ruta y no cae a la de su usuario', () => {
  assert.deepEqual(myRouteIds({ role: 'driver', driverId: 'b', routeId: 'R2' }, cubriendo), []);
  assert.deepEqual(myRouteIds({ role: 'driver', driverId: 'a', routeId: 'R1' }, cubriendo).sort(), ['R1', 'R2']);
  assert.deepEqual(myRouteIds({ role: 'driver', driverId: 'zz', routeId: 'R9' }, cubriendo), ['R9']);
});

test('effectiveDriverId: el cliente de la ruta cubierta cuenta para quien la cubre', () => {
  const c = { id: 'c1', routeId: 'R2', addresses: [{ id: 'x', routeId: 'R2' }], activeAddressId: 'x', driverId: 'b' };
  assert.equal(effectiveDriverId(c, '2026-09-28', cubriendo), 'a');
  assert.equal(effectiveDriverId(c, '2026-09-28', normal), 'b');
});

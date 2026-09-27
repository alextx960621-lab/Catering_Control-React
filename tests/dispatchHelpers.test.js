import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchStatus,
  resolvedAddress,
  activeAddress,
  effectiveRouteId,
  effectiveDriverId,
  shiftOrdersFrom,
  extractLatLngFromMapsField,
  googleMapsDirectLink,
  statusBadgeClass,
} from '../src/services/dispatchHelpers.js';

// Un día laborable "limpio": dispatchStatus recibe el dayInfo ya resuelto desde fuera
const LAB = { laborable: true };
const OFF = { laborable: false };
const D = '2026-09-28'; // lunes

// Cliente con días pagados sin consumir: es el único caso que llega al default de dispatchStatus
const ok = (extra = {}) => ({ paidDays: 10, consumedDays: 2, ...extra });

test('dispatchStatus: día no laborable gana por sobre cualquier otro estado', () => {
  assert.equal(dispatchStatus(ok(), D, OFF), 'No laborable');
  // Sin dayInfo (undefined) tampoco hay garantía de que sea feriado: el optional chaining corta antes
  assert.equal(dispatchStatus(ok(), D, undefined), 'No laborable');
  assert.equal(dispatchStatus(ok(), D, {}), 'No laborable');
});

test('dispatchStatus: returnDate alcanzado reactiva aunque siga pausado', () => {
  const c = ok({ pauseStart: '2026-09-01', returnDate: D });
  assert.equal(dispatchStatus(c, D, LAB), 'Activo');
  assert.equal(dispatchStatus(c, '2026-09-30', LAB), 'Activo');
});

test('dispatchStatus: pauseStart vigente sin returnDate deja el día pausado', () => {
  assert.equal(dispatchStatus(ok({ pauseStart: '2026-09-20' }), D, LAB), 'Pausado');
  // Con returnDate en el futuro la pausa sigue vigente hasta esa fecha
  assert.equal(dispatchStatus(ok({ pauseStart: '2026-09-20', returnDate: '2026-10-05' }), D, LAB), 'Pausado');
});

test('dispatchStatus: pauseDates que incluye la fecha pausa solo ese día', () => {
  assert.equal(dispatchStatus(ok({ pauseDates: [D, '2026-10-04'] }), D, LAB), 'Pausado');
  // Una pausa puntual de otro día no afecta la fecha consultada
  assert.equal(dispatchStatus(ok({ pauseDates: ['2026-10-04'] }), D, LAB), 'Activo');
});

test('dispatchStatus: días pagados consumidos => Retorno pendiente, aunque el estado guardado diga Activo', () => {
  // Esta es la trampa que documenta el código: el estado guardado en la tabla NO manda
  assert.equal(dispatchStatus({ paidDays: 5, consumedDays: 5, status: 'Activo' }, D, LAB), 'Retorno pendiente');
  assert.equal(dispatchStatus({ paidDays: 5, consumedDays: 7, status: 'Activo' }, D, LAB), 'Retorno pendiente');
  // Sin días cargados (0 >= 0) tampoco hay servicio que dar
  assert.equal(dispatchStatus({ status: 'Activo' }, D, LAB), 'Retorno pendiente');
  // La pausa tiene prioridad sobre el retorno pendiente
  assert.equal(dispatchStatus({ paidDays: 5, consumedDays: 5, pauseDates: [D] }, D, LAB), 'Pausado');
});

test('dispatchStatus: startDate en el futuro es Programado', () => {
  assert.equal(dispatchStatus(ok({ startDate: '2026-10-10' }), D, LAB), 'Programado');
  // Un startDate ya pasado no lo programa
  assert.equal(dispatchStatus(ok({ startDate: '2026-09-01' }), D, LAB), 'Activo');
});

test('dispatchStatus: horario semanal sin franja para el día => Fuera de horario', () => {
  const schedule = [{ days: [1, 3, 5], addressId: 'a1' }]; // lun/mié/vie
  assert.equal(dispatchStatus(ok({ schedule }), '2026-10-04', LAB), 'Fuera de horario'); // domingo
  assert.equal(dispatchStatus(ok({ schedule }), D, LAB), 'Activo'); // lunes sí cae
});

test('dispatchStatus: default = client.status o Activo', () => {
  assert.equal(dispatchStatus(ok({ status: 'Pausado' }), D, LAB), 'Pausado');
  assert.equal(dispatchStatus(ok(), D, LAB), 'Activo');
});

test('resolvedAddress / activeAddress: override > franja del schedule > activa > primera > null', () => {
  const addresses = [
    { id: 'a1', address: 'casa', routeId: 'r1' },
    { id: 'a2', address: 'oficina', routeId: 'r2' },
  ];
  const base = { addresses };
  assert.equal(activeAddress({ ...base, activeAddressId: 'a2' }).id, 'a2');
  // Sin activeAddressId válido toma la primera como fallback
  assert.equal(activeAddress({ ...base, activeAddressId: 'inexistente' }).id, 'a1');
  assert.equal(activeAddress({}), null);

  const schedule = [{ days: [1], addressId: 'a2' }]; // lunes
  const client = { ...base, activeAddressId: 'a1', schedule, addressOverrides: [{ date: D, addressId: 'a2' }] };
  assert.equal(resolvedAddress(client, D).id, 'a2'); // override manda
  assert.equal(resolvedAddress({ ...client, addressOverrides: [] }, D).id, 'a2'); // schedule en segundo lugar
  assert.equal(resolvedAddress({ ...client, addressOverrides: [], schedule: [] }, D).id, 'a1'); // activa
  assert.equal(resolvedAddress({ ...base, activeAddressId: 'a2' }, '2026-10-04').id, 'a2');
  assert.equal(resolvedAddress({ addresses: [] }, D), null);
});

test('effectiveRouteId: usa la ruta de la dirección resuelta y cae a la del cliente', () => {
  const client = {
    paidDays: 10,
    consumedDays: 2,
    routeId: 'rCliente',
    addresses: [{ id: 'a1', routeId: 'r1' }],
    activeAddressId: 'a1',
  };
  assert.equal(effectiveRouteId(client, D), 'r1');
  assert.equal(effectiveRouteId({ routeId: 'rCliente' }, D), 'rCliente');
  assert.equal(effectiveRouteId({ addresses: [{ id: 'a1' }] }, D), undefined);
});

test('effectiveDriverId: driver de la ruta > driver de la dirección > vacío > driver del cliente', () => {
  const drivers = [{ id: 'd1', routeId: 'r1' }, { id: 'd2', routeId: 'r2', extraRouteIds: ['r3'] }];
  const client = {
    addresses: [{ id: 'a1', routeId: 'r1', driverId: 'dX' }],
    driverId: 'dCliente',
  };
  assert.equal(effectiveDriverId(client, D, drivers), 'd1');
  // Dirección con ruta sin driver asignado: hereda el driver guardado en la dirección
  assert.equal(effectiveDriverId({ addresses: [{ id: 'a1', routeId: 'r9', driverId: 'd9' }] }, D, drivers), 'd9');
  assert.equal(effectiveDriverId({ addresses: [{ id: 'a1', routeId: 'r9' }] }, D, drivers), '');
  // Sin direcciones resueltas se conserva el driver del cliente
  assert.equal(effectiveDriverId({ driverId: 'dCliente' }, D, drivers), 'dCliente');
});

test('shiftOrdersFrom: corre solo los Activo de la misma ruta con orden >= fromValue', () => {
  const mk = (id, order, extra = {}) => ({ id, routeId: 'r1', paidDays: 10, consumedDays: 2, order, ...extra });
  const clients = [
    mk('c0', '1'),
    mk('c1', '3'),
    mk('c2', '5'),
    mk('c3', '2'), // por debajo del fromValue: no se mueve
    mk('c4', '9', { routeId: 'r2' }), // otra ruta
    mk('c5', '9', { pauseStart: '2026-09-01' }), // pausado: no se desplaza
    mk('c6', 'sin número'), // orden no numérico
    mk('c7', '3', { paidDays: 4, consumedDays: 4 }), // retorno pendiente
  ];
  const updated = shiftOrdersFrom(clients, 'r1', D, 3, 'c0', LAB);
  assert.deepEqual(updated.map((c) => c.id), ['c1', 'c2']);
  assert.equal(clients.find((c) => c.id === 'c1').order, '4');
  assert.equal(clients.find((c) => c.id === 'c2').order, '6');
  assert.equal(clients.find((c) => c.id === 'c3').order, '2');
  assert.equal(clients.find((c) => c.id === 'c4').order, '9');
  assert.equal(clients.find((c) => c.id === 'c6').order, 'sin número');
});

test('shiftOrdersFrom: cuando el cliente tiene dirección, el orden se escribe en la dirección', () => {
  const addr = { id: 'a1', routeId: 'r1', order: '4' };
  const clients = [{ id: 'c1', paidDays: 10, consumedDays: 2, order: '99', addresses: [addr], activeAddressId: 'a1' }];
  shiftOrdersFrom(clients, 'r1', D, 4, 'otro', LAB);
  assert.equal(addr.order, '5');
  assert.equal(clients[0].order, '99'); // el campo viejo del cliente no se toca
});

test('extractLatLngFromMapsField: los 4 patrones soportados', () => {
  assert.deepEqual(extractLatLngFromMapsField('https://maps.google.com/x/data=!3d-17.78331!4d-63.12345'), { lat: -17.78331, lng: -63.12345 });
  assert.deepEqual(extractLatLngFromMapsField('https://maps.google.com/maps?q=-17.78,-63.12'), { lat: -17.78, lng: -63.12 });
  assert.deepEqual(extractLatLngFromMapsField('https://maps.google.com/maps/@-17.783, -63.123,17z'), { lat: -17.783, lng: -63.123 });
  assert.deepEqual(extractLatLngFromMapsField('-17.783, -63.123'), { lat: -17.783, lng: -63.123 });
});

test('extractLatLngFromMapsField: texto sin coordenadas o fuera de rango devuelve null', () => {
  assert.equal(extractLatLngFromMapsField(''), null);
  assert.equal(extractLatLngFromMapsField(null), null);
  assert.equal(extractLatLngFromMapsField('Av. San Martin 123'), null);
  assert.equal(extractLatLngFromMapsField('17.78, 63.12'), null); // menos de 3 decimales: no es coordenada
  assert.equal(extractLatLngFromMapsField('200.123, 50.500'), null); // latitud imposible
  assert.equal(extractLatLngFromMapsField('@91.0000,30.0000'), null);
});

test('googleMapsDirectLink: URL intacta, coordenadas al link de direcciones, resto a búsqueda', () => {
  assert.equal(googleMapsDirectLink('https://maps.app.goo.gl/abc'), 'https://maps.app.goo.gl/abc');
  assert.equal(googleMapsDirectLink('http://maps.app.goo.gl/abc'), 'http://maps.app.goo.gl/abc');
  assert.equal(googleMapsDirectLink('-17.783, -63.123'), 'https://www.google.com/maps/dir/?api=1&destination=-17.783,-63.123');
  assert.equal(googleMapsDirectLink('Av. San Martin 123'), 'https://www.google.com/maps/search/?api=1&query=Av.%20San%20Martin%20123');
  assert.equal(googleMapsDirectLink(''), '');
  assert.equal(googleMapsDirectLink('   '), '');
  assert.equal(googleMapsDirectLink(undefined), '');
});

test('statusBadgeClass: cada estado tiene su badge y los desconocidos caen en done', () => {
  assert.equal(statusBadgeClass('Activo'), 'active');
  assert.equal(statusBadgeClass('Pausado'), 'paused');
  assert.equal(statusBadgeClass('Retorno pendiente'), 'pending');
  assert.equal(statusBadgeClass('Programado'), 'pending');
  assert.equal(statusBadgeClass('No laborable'), 'off');
  assert.equal(statusBadgeClass('Fuera de horario'), 'off');
  assert.equal(statusBadgeClass('Algo nuevo'), 'done');
});

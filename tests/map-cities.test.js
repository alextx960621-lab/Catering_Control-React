import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAP_CITIES, findCity, normalizeMapCity, cityBbox, slugify } from '../src/data/mapCities.js';

test('catálogo de ciudades: ids únicos, ya en formato de archivo y coordenadas válidas', () => {
  const ids = new Set();
  for (const c of MAP_CITIES) {
    assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
    ids.add(c.id);
    assert.equal(c.id, slugify(c.id), `el id no es un slug seguro: ${c.id}`);
    assert.match(c.country, /^[A-Z]{2}$/);
    assert.ok(Math.abs(c.lat) < 85 && Math.abs(c.lng) <= 180, `coordenadas inválidas: ${c.id}`);
    assert.ok(c.r >= 0.05 && c.r <= 2, `radio fuera de rango: ${c.id}`);
    // de Canadá (~60°N) a Argentina (~55°S), en el continente americano
    assert.ok(c.lat > -56 && c.lat < 62 && c.lng > -140 && c.lng < -30, `fuera de América: ${c.id}`);
  }
});

test('La Paz / El Alto está en el catálogo y su recuadro rodea al centro', () => {
  const c = findCity('la-paz-bo');
  assert.ok(c);
  const [w, s, e, n] = cityBbox(c);
  assert.ok(w < c.lng && c.lng < e && s < c.lat && c.lat < n);
});

test('normalizeMapCity: acepta lo válido y descarta lo dañado', () => {
  assert.equal(normalizeMapCity(null), null);
  assert.equal(normalizeMapCity({ id: '', lat: 1, lng: 1 }), null);
  assert.equal(normalizeMapCity({ id: 'x', lat: 'abc', lng: 1 }), null);
  assert.equal(normalizeMapCity({ id: 'x', lat: 95, lng: 1 }), null);
  // un id con caracteres raros no puede escaparse hacia otra ruta del bucket
  assert.equal(normalizeMapCity({ id: '../otro', lat: 1, lng: 1, r: 0.2 }).id, 'otro');
  assert.equal(normalizeMapCity({ id: 'ok', lat: -16.5, lng: -68.1, r: 99 }).r, 0.25);
});

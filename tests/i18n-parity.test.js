import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile } from './_helpers.js';
import { PREMIUM_DEFAULT_LOCKED } from '../src/services/panelAuth.js';

const LOCALES = ['es', 'en', 'pt'];
const json = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(repoFile(`src/i18n/locales/${l}.json`))]));

// Caminos de clave ("panel.clients.title"); los objetos anidados no cuentan como hoja
function keyPaths(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keyPaths(v, path));
    else out.push(path);
  }
  return out;
}

// El bloque de etiquetas de páginas puede estar anidado bajo panel.settings o bajo settings
function pagesBlock(localeJson) {
  return localeJson.panel?.settings?.pages ?? localeJson.settings?.pages ?? null;
}

for (const l of LOCALES) {
  test(`${l}.json se puede parsear y tiene bloque de páginas`, () => {
    assert.equal(typeof json[l], 'object');
    assert.ok(pagesBlock(json[l]), `${l}.json no trae el bloque settings.pages con las etiquetas de páginas`);
  });
}

test('es/en/pt tienen exactamente el mismo set de claves', () => {
  const sets = Object.fromEntries(LOCALES.map((l) => [l, new Set(keyPaths(json[l]))]));
  for (let i = 0; i < LOCALES.length; i++) {
    for (let j = i + 1; j < LOCALES.length; j++) {
      const a = LOCALES[i];
      const b = LOCALES[j];
      const faltan = [...sets[a]].filter((p) => !sets[b].has(p));
      const sobran = [...sets[b]].filter((p) => !sets[a].has(p));
      assert.deepEqual([faltan, sobran], [[], []], `i18n desincronizado entre ${a} y ${b}`);
    }
  }
});

test('settings.pages tiene exactamente las 11 claves de PREMIUM_DEFAULT_LOCKED', () => {
  const esperado = Object.keys(PREMIUM_DEFAULT_LOCKED).sort();
  for (const l of LOCALES) {
    const keys = Object.keys(pagesBlock(json[l])).sort();
    assert.deepEqual(keys, esperado, `${l}.json: el bloque de páginas no coincide con PREMIUM_DEFAULT_LOCKED`);
  }
});

test('no hay etiquetas vacías en el bloque de páginas', () => {
  for (const l of LOCALES) {
    for (const [k, v] of Object.entries(pagesBlock(json[l]))) {
      assert.equal(typeof v, 'string', `${l}: settings.pages.${k} no es texto`);
      assert.ok(v.trim().length > 0, `${l}: settings.pages.${k} está vacío`);
    }
  }
});

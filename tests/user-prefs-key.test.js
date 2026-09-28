import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ROOT, repoFile } from './_helpers.js';

// localStorage es por ORIGEN: dos carpetas (dos marcas) que se turnan el mismo puerto de…
// desarrollo comparten las claves sin prefijo. STORAGE_KEYS ya deriva el suyo de…
// config.storagePrefix; las preferencias de usuario deben hacer lo mismo.
const OLD_KEY = 'catering-user-prefs-v2';
const USER_PREFS = 'src/services/userPrefs.js';

test('userPrefs arma STORE_KEY a partir de config.storagePrefix', () => {
  const src = repoFile(USER_PREFS);
  const decl = /const STORE_KEY\s*=\s*([^;]+);/.exec(src);
  assert.ok(decl, `${USER_PREFS}: no se encontró la constante STORE_KEY`);
  assert.match(
    decl[1],
    /config\.storagePrefix/,
    `STORE_KEY quedó hardcodeada (${decl[1].trim()}): dos marcas en el mismo origen se pisarían las preferencias`,
  );
  assert.match(src, /import\s+config\s+from\s+'\.\/config';/, `${USER_PREFS}: falta importar ./config como hacen los otros servicios`);
});

// La cadena vieja sigue siendo necesaria: es la clave desde la que se migra. Lo que no puede…
// pasar es que otro archivo la lea o escriba por su cuenta (ahí el prefijo volvería a ser opcional).
function fuentes(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') fuentes(full, out);
    } else if (/\.[cm]?[jt]sx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

test('ninguna otra fuente usa la clave vieja sin prefijo', () => {
  const raiz = join(ROOT, 'src');
  const functions = join(ROOT, 'supabase', 'functions');
  const dirs = [raiz, functions].filter((d) => statSync(d).isDirectory());
  const culpables = dirs
    .flatMap((d) => fuentes(d))
    .filter((f) => readFileSync(f, 'utf8').includes(OLD_KEY))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    .filter((f) => f !== USER_PREFS);
  assert.deepEqual(culpables, [], `la clave vieja sin prefijo aparece fuera de la migración de ${USER_PREFS}`);
});

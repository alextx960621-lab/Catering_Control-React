import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeSettings } from '../src/services/normalize.js';
import { ROOT } from './_helpers.js';

// El selector de Configuración ofrece las 24 horas. Con el tope viejo en 12, un cierre puesto a
// las 18:00 volvía a mostrarse 04:00 al recargar, y el guardado siguiente escribía 4 en la base.
test('dayCutoffHour: conserva cualquier hora de 0 a 23', () => {
  for (let h = 0; h <= 23; h++) {
    assert.equal(normalizeSettings({ dayCutoffHour: h }).dayCutoffHour, h, `se perdió ${h}`);
  }
  assert.equal(normalizeSettings({ dayCutoffHour: '18' }).dayCutoffHour, 18);
});

test('dayCutoffHour: lo inválido vuelve a 4 y no arrastra otros campos', () => {
  // `[]` queda afuera a propósito: Number([]) es 0, o sea una hora válida.
  for (const v of [null, undefined, '', 24, -1, 1.5, 'x', {}, NaN]) {
    assert.equal(normalizeSettings({ dayCutoffHour: v }).dayCutoffHour, 4, `debería dar 4 con ${JSON.stringify(v)}`);
  }
  const s = normalizeSettings({ dayCutoffHour: 20, plan: 'premium', timezone: 'America/Lima' });
  assert.equal(s.plan, 'premium');
  assert.equal(s.timezone, 'America/Lima');
});

// El mismo archivo vive en dos lados: el panel y la Edge Function de cierre automático (que no
// puede importar de src/). El tope en 12 quedó corregido solo en el panel y tardó una ronda de
// pruebas en verse. Esta comparación es lo que evita repetir ese error.
test('el normalize.js de la Edge Function no se desincroniza del del panel', () => {
  const lee = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8').replace(/\r\n/g, '\n');
  const body = (txt) => /export function normalizeSettings\([\s\S]*?\n}/.exec(txt)?.[0] || null;
  const delPanel = body(lee('src/services/normalize.js'));
  const deLaEdge = body(lee('supabase/functions/cerrar-dia-automatico/shared/normalize.js'));
  assert.ok(delPanel && deLaEdge, 'no se pudo aislar normalizeSettings en alguno de los dos archivos');
  assert.equal(deLaEdge, delPanel, 'normalizeSettings dice cosas distintas según quién lo corra: el cierre automático del cron usaría otra hora de corte');
});

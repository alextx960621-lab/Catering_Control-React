// Copia la lógica compartida del Panel a la Edge Function cerrar-dia-automatico (Deno no lee src/).
// Se corre solo antes de cada build (prebuild). Con --check solo avisa si hay diferencias.
import fs from 'fs';
import path from 'path';

const FILES = ['planHelpers.js', 'dispatchHelpers.js', 'normalize.js', 'dayProcessing.js'];
const from = 'src/services';
const to = 'supabase/functions/cerrar-dia-automatico/shared';
const check = process.argv.includes('--check');

fs.mkdirSync(to, { recursive: true });
let differ = 0;
for (const f of FILES) {
  const src = fs.readFileSync(path.join(from, f), 'utf8');
  const dst = path.join(to, f);
  const same = fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === src;
  if (!same) { differ++; if (!check) fs.writeFileSync(dst, src); }
}
if (check && differ) { console.error(`Hay ${differ} archivo(s) desactualizados en ${to}. Corre: npm run sync-edge`); process.exit(1); }
console.log(check ? 'Edge Function al día.' : `Edge Function sincronizada (${differ} archivo(s) actualizados).`);

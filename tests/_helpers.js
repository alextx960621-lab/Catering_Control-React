import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raíz del repo: los tests viven en <raíz>/tests
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Lee un archivo del repo relativo a la raíz, sin depender del cwd de quien corre el test
export function repoFile(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// El setup se llama `supabase-setup-final.sql` en el maestro y `supabase-setup-<slug>.sql` en la
// copia de cada empresa (ese nombre lo genera nueva-empresa.mjs a partir del storagePrefix de
// public/config.js). En una carpeta de cliente puede quedar además un `supabase-setup-final.sql`
// viejo copiado a mano: ese NO es el setup de esa empresa (tiene <PROJECT_REF> sin resolver), así
// que se resuelve por slug primero.
export function setupSqlRel() {
  const dir = join(ROOT, 'install');
  const files = readdirSync(dir).filter((f) => /^supabase-setup-.*\.sql$/i.test(f));
  const prefijo = (readFileSync(join(ROOT, 'public', 'config.js'), 'utf8').match(/storagePrefix:\s*'([^']+)'/) || [])[1] || '';
  const slug = prefijo.replace(/^catering-app-?/, '');
  const propio = slug && files.includes(`supabase-setup-${slug}.sql`) ? `supabase-setup-${slug}.sql` : null;
  const elegido = propio || (files.includes('supabase-setup-final.sql') ? 'supabase-setup-final.sql' : null)
    || (files.length === 1 ? files[0] : null);
  if (!elegido) throw new Error(`No se cuál es EL setup de esta carpeta: install/ tiene ${files.length} (${files.join(', ')})`);
  return `install/${elegido}`;
}

export function setupSql() {
  return repoFile(setupSqlRel());
}

// true solo en el maestro. En la copia de una empresa el setup es un snapshot de lo que SE CORRÓ
// en su base, no la fuente de verdad: las invariantes de contenido del SQL se deciden en el
// maestro (ahí donde hay que arreglarlas), así que allá arriba se corren y acá se saltan.
export const SETUP_CANONICO = setupSqlRel() === 'install/supabase-setup-final.sql';

// Quita comentarios SQL (-- hasta fin de línea y bloques /* */), deja el resto intacto
export function stripSqlComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Devuelve solo el "scope de instalación": el SQL que corre al aplicar el setup, sin los cuerpos
// de función (dollar-quoted), que son DML de runtime y no borran datos al instalar
export function sqlSetupScope(sql) {
  const clean = stripSqlComments(sql);
  const parts = clean.split(/(\$[A-Za-z_0-9]*\$)/g);
  const stack = [];
  let out = '';
  for (const p of parts) {
    if (/^\$[A-Za-z_0-9]*\$$/.test(p)) {
      if (stack.at(-1) === p) stack.pop();
      else stack.push(p);
      continue;
    }
    if (stack.length === 0) out += p;
  }
  return { code: out, unclosed: stack };
}

// Cuerpo `as $$ ... $$` de una función SQL; null si la función no existe en el archivo
export function sqlFunctionBody(sql, name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
  if (start === -1) return null;
  const m = /as\s*(?:'[^']*'\s+)?\$\$([\s\S]*?)\$\$/i.exec(sql.slice(start));
  return m ? m[1] : null;
}

// Literales entre comillas simples dentro de un array SQL (`array[ 'a', 'b' ]`)
export function sqlArrayLiterals(body) {
  const m = /array\s*\[([\s\S]*?)\]/i.exec(body || '');
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

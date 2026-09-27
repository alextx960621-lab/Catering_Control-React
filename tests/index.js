import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Shim para que `node --test tests/` funcione también en Windows: esa forma resuelve el directorio
// como módulo (tests/index.js) en vez de expandir los *.test.js, así que acá se importan todos.
const dir = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
  await import(pathToFileURL(join(dir, f)).href);
}

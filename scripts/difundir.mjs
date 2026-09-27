// scripts/difundir.mjs  ·  Réplica del código del maestro hacia una empresa white-label.
//
//   node scripts/difundir.mjs --list
//   node scripts/difundir.mjs --empresa "In Shape Catering"            (dry-run: no escribe nada)
//   node scripts/difundir.mjs --empresa inshape --solo src/services --aplicar
//
// Una sola dirección: maestro -> empresa. El destino SIEMPRE sale del registro
// install/empresas.json (nunca de una ruta arbitraria), para no difundir jamás
// contra una copia abandonada como G:\intento de empresa\in shape catering.
//
// Reglas duras:
// - Sin --aplicar no se escribe UN solo byte (ni siquiera el estado .sincronizado.json).
// - Los archivos white-label de la empresa (config.js, manifest.json, icons, SQL, secretos)
//   nunca se tocan: están en PROTEGIDOS y se listan como "omitiría (protegido)".
// - Antes de pisar un archivo se consulta .sincronizado.json (raíz del MAESTRO, claveada
//   por storagePrefix): si la copia de la empresa cambió desde la última difusión, alguien
//   la editó a mano y eso es un CONFLICTO: no se pisa, se reporta.
// - Este script nunca corre git que escriba. Solo lee "git status --porcelain" de la
//   empresa para avisar si hay cambios sin commitear antes de aplicar.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// RAIZ es el maestro: la carpeta que contiene scripts/ e install/empresas.json.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRO = join(RAIZ, 'install', 'empresas.json');
// El estado vive en el maestro para no ensuciar el git de ninguna empresa.
const ESTADO_RUTA = join(RAIZ, '.sincronizado.json');

// ---------------------------------------------------------------------------
// Archivos que la difusión NUNCA escribe en la empresa.
// Derivados de lo que genera scripts/nueva-empresa.mjs (init): public/config.js,
// public/manifest.json, iconos, install/supabase-setup-*.sql, install/secretos-*.local.json
// y el registro install/empresas.json. Se suman los que pide la guía de despliegue
// (wrangler.jsonc por empresa, .env*, claves.txt) y las carpetas que ignora .gitignore.
// ---------------------------------------------------------------------------
const PROTEGIDOS_EXACTOS = new Set([
  'public/config.js', // branding + ref de Supabase + VAPID público: es LA identidad de la empresa
  'public/manifest.json', // nombre y rótulo del ícono PWA propios de la empresa
  'install/empresas.json', // el registro canónico solo vive (y solo se edita) en el maestro
  'wrangler.jsonc', // config de Cloudflare Workers por empresa (no existe hoy; si aparece, se protege)
  'wrangler.toml', // variante TOML del anterior
  'claves.txt', // secretos sueltos del dueño
  '.sincronizado.json', // estado del difusor (por las dudas: solo vive en el maestro)
  'CAMBIOS.md', // changelog de trabajo: solo tiene sentido en el maestro, decisión del dueño (2026-09-27)
]);
const PROTEGIDOS_PREFIJOS = [
  'public/icons/', // logos/íconos generados por la empresa, no por el código
  'tests/', // suite de tests: solo se corre en el maestro, decisión del dueño (2026-09-27)
];
const PROTEGIDOS_CONTIENE = [
  'node_modules', 'dist', '.git', '.vercel', // carpetas de build/dependencias/historial: fuera de la difusión
  '.temp', // estado del CLI de Supabase (cli-latest, linked-project.json): no es código del proyecto
];
const PROTEGIDOS_EXTENSIONES = ['.rar', '.zip'];

// Rutas que solo tienen sentido en el maestro, sin importar en qué subcarpeta estén escritas.
// `panel-catering.bat` necesita leer install/empresas.json, que es exclusivo del maestro:
// copiado a una carpeta de cliente daría error.
const PROTEGIDOS_NOMBRE = new Set(['panel-catering.bat']);

// Devuelve true si la ruta (relativa al árbol de la app, con barras) no debe tocarse.
// Cualquier ruta absoluta o que salga del árbol también se considera protegida: el
// script jamás escribe fuera de la carpeta de la empresa.
function estaProtegido(ruta) {
  const r = ruta.split(sep).join('/');
  if (!r || r.startsWith('/') || /^[a-zA-Z]:/.test(r) || r.split('/').includes('..')) return true;
  if (PROTEGIDOS_EXACTOS.has(r)) return true;
  if (PROTEGIDOS_PREFIJOS.some((p) => r.startsWith(p))) return true;
  if (PROTEGIDOS_CONTIENE.some((p) => r.split('/').includes(p))) return true;
  if (PROTEGIDOS_EXTENSIONES.some((e) => r.endsWith(e))) return true;
  if (PROTEGIDOS_NOMBRE.has(r.split('/').pop())) return true;
  if (r.startsWith('.env') || r.includes('/.env')) return true; // cualquier .env* es secreto
  // Todo install/*.sql y todo *.local.json (secretos VAPID de nueva-empresa.mjs) es de la empresa:
  // el SQL de una base ya instalada no se reemplaza por accidente, se regenera a conciencia.
  if (r.startsWith('install/') && (r.endsWith('.sql') || r.endsWith('.local.json'))) return true;
  return false;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const leerBytes = (p) => readFileSync(p);
const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clave = (s) => sinTildes(String(s)).toLowerCase().trim();

// Diferencia de líneas "maestro vs empresa" sin dependencias: compara cantidades por
// línea (multiset), suficiente para dimensionar el cambio en el informe; no es un diff real.
// mas = líneas que la empresa ganaría (están en el maestro), menos = las que perdería.
function contarDiferencias(txtMaestro, txtEmpresa) {
  const ca = new Map();
  const cb = new Map();
  for (const l of txtMaestro.split('\n')) ca.set(l, (ca.get(l) || 0) + 1);
  for (const l of txtEmpresa.split('\n')) cb.set(l, (cb.get(l) || 0) + 1);
  let mas = 0;
  let menos = 0;
  for (const [l, n] of ca) mas += Math.max(0, n - (cb.get(l) || 0)); // líneas nuevas para la empresa
  for (const [l, n] of cb) menos += Math.max(0, n - (ca.get(l) || 0)); // líneas que desaparecerían
  return { mas, menos };
}

// Recorre el maestro y devuelve las rutas relativas (con barras) que son código replicable.
function recorrerMaestro(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    const rel = relative(RAIZ, ruta).split(sep).join('/');
    if (e.isDirectory()) {
      // node_modules/dist/.git/.vercel no forman parte del paquete difundible.
      if (PROTEGIDOS_CONTIENE.includes(e.name)) continue;
      out.push(...recorrerMaestro(ruta));
    } else {
      if (estaProtegido(rel) && !existsSync(join(destinoActual, rel))) continue; // basura del maestro sin gemelo: ni se menciona
      out.push(rel);
    }
  }
  return out;
}

let destinoActual = RAIZ; // lo fija resolverEmpresa(); recorrerMaestro lo usa para el filtro anterior

function leerRegistro() {
  if (!existsSync(REGISTRO)) throw new Error(`Falta el registro ${REGISTRO}: difundir sin registro canónico está prohibido.`);
  return JSON.parse(readFileSync(REGISTRO, 'utf8')).empresas ?? [];
}

function leerEstado() {
  if (!existsSync(ESTADO_RUTA)) return {};
  try { return JSON.parse(readFileSync(ESTADO_RUTA, 'utf8')); }
  catch { throw new Error(`${ESTADO_RUTA} está dañado: reparalo a mano antes de difundir.`); }
}

// El destino sale del registro: nombre, storagePrefix o carpeta coinciden (sin tildes ni mayúsculas).
function resolverEmpresa(sel) {
  const registro = leerRegistro();
  const s = clave(sel);
  const found = registro.filter((e) => clave(e.empresa) === s || clave(e.storagePrefix) === s || clave(e.carpeta) === s);
  if (!found.length) {
    throw new Error(`"${sel}" no está en install/empresas.json. Las empresas registradas son:\n${registro.map((e) => `  - ${e.empresa} (${e.storagePrefix})`).join('\n')}`);
  }
  if (found.length > 1) throw new Error(`"${sel}" es ambiguo: coincide con ${found.map((e) => e.empresa).join(', ')}.`);
  const e = found[0];
  // "carpeta" es relativa al maestro; si alguien la pusiera absoluta, resolve la respeta igual.
  const dir = resolve(dirname(RAIZ), e.carpeta);
  if (dir === RAIZ) throw new Error(`"${e.empresa}" es el propio maestro (pruebas): no se difunde sobre sí mismo.`);
  // Barrera extra: el destino debe quedar hermanado al maestro, nunca dentro de él ni en otra ruta.
  if (!dir.startsWith(resolve(dirname(RAIZ)) + sep)) throw new Error(`La carpeta de "${e.empresa}" (${dir}) no está al lado del maestro: revisá install/empresas.json.`);
  if (!existsSync(dir)) throw new Error(`La carpeta ${dir} no existe: la empresa "${e.empresa}" está registrada pero su copia no está.`);
  return { empresa: e, dir };
}

function listarEmpresas() {
  const registro = leerRegistro();
  if (!registro.length) return console.log('Todavía no hay empresas registradas.');
  const ancho = Math.max(...registro.map((e) => e.empresa.length));
  for (const e of registro) {
    console.log(`${e.empresa.padEnd(ancho)}  ${e.pruebas ? 'PRUEBAS  ' : '         '}${(e.carpeta ?? '').padEnd(16)}  ${(e.projectRef ?? 'sin alta Supabase').padEnd(21)}${e.storagePrefix}  ${e.version ?? '—'}`);
  }
  console.log(`\n${registro.length} entrada(s). Elegí destino con --empresa <nombre|storagePrefix>.`);
}

function argumentos(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

// Lee el estado git de la empresa SOLO para avisar (nunca escribe el índice ni el historial).
function avisarGitSucio(dir) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) return; // sin git o sin repo: no es asunto de este script
  const lineas = r.stdout.trim().split('\n').filter(Boolean);
  if (lineas.length) {
    console.log(`\n\x07AVISO: la empresa tiene ${lineas.length} cambio(s) sin commitear (git status). Recomendado commitear antes de difundir.`);
    for (const l of lineas.slice(0, 5)) console.log(`   ${l}`);
    if (lineas.length > 5) console.log(`   ... y ${lineas.length - 5} más`);
  }
}

function main(opts) {
  if (opts.list || opts.lista) return listarEmpresas();
  if (!opts.empresa) {
    listarEmpresas();
    throw new Error('Falta --empresa <nombre|storagePrefix> (o usá --list). Con --aplicar es obligatorio escribir; sin ella es dry-run.');
  }

  const { empresa, dir } = resolverEmpresa(opts.empresa);
  destinoActual = dir;
  const solo = opts.solo ? String(opts.solo).split(sep).join('/').replace(/\/+$/, '') : null;
  const aplica = Boolean(opts.aplicar);
  const estado = leerEstado();
  const previo = estado[empresa.storagePrefix]?.archivos ?? {};

  console.log(`\n== difundir ${basename(RAIZ)} -> ${empresa.empresa} (${dir}) ${aplica ? '  [APLICANDO]' : '  [dry-run: no escribe nada]'} ==`);
  if (solo) console.log(`   filtrado a: ${solo}/`);

  const cambios = [];
  const nuevos = [];
  const protegidos = [];
  const iguales = [];
  const conflictos = [];
  const eliminar = [];

  for (const rel of recorrerMaestro(RAIZ).sort()) {
    if (solo && rel !== solo && !rel.startsWith(solo + '/')) continue; // --solo restringe TODAS las listas
    if (estaProtegido(rel)) { protegidos.push(rel); continue; }
    const destino = join(dir, rel);
    const bufMaestro = leerBytes(join(RAIZ, rel));
    if (!existsSync(destino)) { nuevos.push({ rel, lineas: contarDiferencias(bufMaestro.toString('utf8'), '').mas }); continue; }
    const bufEmpresa = leerBytes(destino);
    if (sha256(bufMaestro) === sha256(bufEmpresa)) { iguales.push(rel); continue; }
    const d = contarDiferencias(bufMaestro.toString('utf8'), bufEmpresa.toString('utf8'));
    const marca = `${rel}  (+${d.mas} / -${d.menos})`;
    const st = previo[rel];
    if (st) {
      // Si la copia de la empresa ya no coincide con lo que difundimos la última vez,
      // alguien la editó a mano: no la pisamos, es un conflicto a resolver por el dueño.
      if (sha256(bufEmpresa) !== st.empresaSha) conflictos.push({ rel, marca, cuando: st.difundidoEn });
      else cambios.push({ rel, marca });
    } else {
      cambios.push({ rel, marca, sinBaseline: true });
    }
  }

  // Reflejar deletados: algo que difundimos y ya no existe en el maestro puede irse de la empresa,
  // pero solo con --aplicar y nunca si quedó en una ruta protegida (config, icons, sql, secretos).
  for (const rel of Object.keys(previo)) {
    if (estaProtegido(rel)) continue;
    if (solo && rel !== solo && !rel.startsWith(solo + '/')) continue;
    if (!existsSync(join(RAIZ, rel)) && existsSync(join(dir, rel))) eliminar.push(rel);
  }

  const mostrar = (titulo, items) => {
    console.log(`\n-- ${titulo} (${items.length}) --`);
    for (const i of items) console.log(`   ${typeof i === 'string' ? i : i.marca ?? i.rel}`);
  };
  mostrar('cambiaría', cambios.map((c) => ({ ...c, marca: c.marca + (c.sinBaseline ? '  [sin baseline]' : '') })));
  mostrar('nuevos', nuevos.map((n) => ({ rel: n.rel, marca: `${n.rel}  (+${n.lineas} líneas)` })));
  mostrar('omitiría (protegido)', protegidos);
  mostrar('eliminaría', eliminar);
  console.log(`\n-- sin cambios (${iguales.length}) --`);
  if (opts.detallado) for (const r of iguales) console.log(`   ${r}`);

  if (conflictos.length) {
    console.log(`\n-- CONFLICTO: editados a mano en la empresa, NO se pisarán (${conflictos.length}) --`);
    for (const c of conflictos) {
      console.log(`   ${c.marca}  (difundido ${c.cuando ?? '?'})`);
      console.log(`     → compará "${c.rel}" contra el maestro y decidí: llevar el cambio del cliente al maestro,`);
      console.log(`       o borrar la clave "${c.rel}" de .sincronizado.json y volver a aplicar para pisar la copia local.`);
    }
  }

  console.log(`\n== Resumen: ${cambios.length} cambiaría / ${nuevos.length} nuevos / ${protegidos.length} protegidos omitidos / ${conflictos.length} conflictos / ${eliminar.length} eliminaría / ${iguales.length} sin cambios ==`);

  if (!aplica) {
    console.log('\nDry-run: no se escribió nada. Repetí con --aplicar para replicar lo seguro (conflictos y protegidos quedan intactos).');
    if (conflictos.length) { console.log('\x07Hay conflictos: la difusión NO será limpia hasta resolverlos.'); process.exitCode = 1; }
    return;
  }

  avisarGitSucio(dir);
  const ahora = new Date().toISOString().slice(0, 10);
  const archivos = { ...previo };
  let escritos = 0;
  let borrados = 0;
  // Se escribe lo seguro: cambios confirmados contra baseline + nuevos. Los conflictos no entran.
  for (const c of [...cambios, ...nuevos]) {
    const rel = c.rel;
    const buf = leerBytes(join(RAIZ, rel));
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), buf);
    const sha = sha256(buf);
    archivos[rel] = { maestroSha: sha, empresaSha: sha, difundidoEn: ahora };
    escritos++;
  }
  for (const rel of eliminar) {
    rmSync(join(dir, rel));
    delete archivos[rel];
    borrados++;
  }
  // El estado de "sin cambios" también se registra: la próxima corrida distingue
  // "nunca lo ví" de "estaba igual que el maestro" (baseline aunque no haya escritura).
  for (const rel of iguales) {
    if (!archivos[rel]) {
      const sha = sha256(leerBytes(join(dir, rel)));
      archivos[rel] = { maestroSha: sha, empresaSha: sha, difundidoEn: ahora };
    }
  }
  estado[empresa.storagePrefix] = { ...(estado[empresa.storagePrefix] ?? {}), archivos };
  writeFileSync(ESTADO_RUTA, JSON.stringify(estado, null, 2));
  console.log(`\nAplicado en ${dir}: ${escritos} archivo(s) escritos, ${borrados} eliminados, 0 conflictivos tocados.`);
  console.log(`Estado actualizado en ${ESTADO_RUTA} (clave ${empresa.storagePrefix}).`);
  if (conflictos.length) { console.log('\x07Quedan conflictos sin resolver: esta difusión NO fue limpia.'); process.exitCode = 1; }
}

const USO = `node scripts/difundir.mjs --list
node scripts/difundir.mjs --empresa <nombre|storagePrefix> [--solo <ruta>] [--detallado] [--aplicar]`;

const opts = argumentos(process.argv.slice(2));
if (opts.ayuda || opts.help) console.log(USO);
else {
  try { main(opts); }
  catch (err) { console.error(`\n\x07${err.message}\n\n${USO}`); process.exitCode = 1; }
}

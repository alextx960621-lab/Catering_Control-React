// scripts/panel.mjs · El menú del dueño: difundir, versiones, empresa nueva y git.
//
//   node scripts/panel.mjs
//
// Lo maneja install/panel-catering.bat, que es la única ventana que hay que abrir.
// El menú se arma leyendo install/empresas.json en cada corrida: una empresa nueva
// creada con la opción 4 aparece sola en las opciones de difusión y de git, sin
// generar ni editar ningún .bat.
//
// Lo que NUNCA hace este archivo:
// - Difundir por su cuenta: delega en scripts/difundir.mjs, que es el que tiene las
//   reglas de protegidos y de conflictos.
// - Git destructivo: solo corre pull --no-edit / add . / commit / push, y se detiene
//   antes de pushear si algún paso previo falló.
// - Crear repositorios sin permiso: el git de una carpeta nueva pasa por un S/N, copia el
//   .gitignore del maestro antes del add, y aborta si el add traería node_modules o secretos.

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRO = join(RAIZ, 'install', 'empresas.json');
const MSG_COMMIT = 'Descripción de los cambios';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pregunta = (p, def = '') => rl.question(p).then((r) => r.trim() || def);

function leerEmpresas() {
  if (!existsSync(REGISTRO)) throw new Error(`Falta ${REGISTRO}: sin registro no hay menú.`);
  return JSON.parse(readFileSync(REGISTRO, 'utf8')).empresas ?? [];
}

// "carpeta" del registro es relativa al maestro; el maestro mismo también está registrado
// (es la copia de pruebas), así que se resuelve y se compara contra RAIZ.
const dirDe = (e) => resolve(dirname(RAIZ), e.carpeta ?? e.empresa);

function nodoNode(args, cwd = RAIZ) {
  // stdin 'ignore': los hijos no le roban las respuestas al menú (medido: con stdin
  // heredado, readline se quedaba sin línea para la siguiente pregunta).
  const r = spawnSync(process.execPath, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  return r.status ?? 1;
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const salida = ((r.stdout || '') + (r.stderr || '')).trim();
  return { ok: r.status === 0, status: r.status ?? 1, salida };
}

async function pausa(msg) {
  console.log(`\n${msg}`);
  await pregunta(' ENTER para volver al menú.');
}

// ---------------------------------------------------------------- difundir
async function difundir(unas) {
  const empresas = leerEmpresas().filter((e) => dirDe(e) !== RAIZ);
  let destinos = unas ? null : empresas;
  if (unas) {
    empresas.forEach((e, i) => console.log(`   ${i + 1}. ${e.empresa}  (${e.storagePrefix})`));
    const n = Number(await pregunta(' Número de la empresa (0 para cancelar): ', '0'));
    if (!n) return;
    destinos = [empresas[n - 1]].filter(Boolean);
  }
  for (const e of destinos) {
    console.log(`\n---- simulación para ${e.empresa} (no escribe nada) ----`);
    if (nodoNode(['scripts/difundir.mjs', '--empresa', e.storagePrefix]) !== 0) {
      console.log('   Hay conflictos u otro problema: no se aplica nada en esta empresa.');
      continue;
    }
    if ((await pregunta(` ¿Aplicar estos cambios en ${e.empresa}? (S/N): `, 'N')).toUpperCase() !== 'S') {
      console.log('   Cancelado: no se aplicó nada.');
      continue;
    }
    nodoNode(['scripts/difundir.mjs', '--empresa', e.storagePrefix, '--aplicar']);
  }
  await pausa('Difusión terminada.');
}

// ---------------------------------------------------------------- git
function carpetasGit() {
  const out = [{ nombre: `${basename(RAIZ)} (maestro)`, dir: RAIZ }];
  for (const e of leerEmpresas()) {
    const d = dirDe(e);
    if (d === RAIZ || !existsSync(d)) continue;
    out.push({ nombre: e.empresa, dir: d });
  }
  return out;
}

// arma el repositorio de una carpeta que todavía no lo tiene (empresa nueva).
// Pregunta una por una las cuatro cosas que necesita y para antes de tocar la red.
async function crearRepo(dir, nombre) {
  console.log(`\n== Git de ${nombre} ==`);
  if (git(['rev-parse', '--is-inside-work-tree'], dir).ok) {
    console.log('   La carpeta ya es un repositorio git: usá la opción 5 o 6 para commitear.');
    return false;
  }

  // Sin .gitignore, "git add ." se llevaría node_modules/ y los secretos *.local.json al remoto.
  const destino = join(dir, '.gitignore');
  if (!existsSync(destino)) {
    const delMaestro = join(RAIZ, '.gitignore');
    if (!existsSync(delMaestro)) {
      console.log('   NO hay .gitignore en esta carpeta ni en el maestro: sin ese archivo el add');
      console.log('   subiría node_modules y los secretos. Cancelado.');
      return false;
    }
    writeFileSync(destino, readFileSync(delMaestro));
    console.log('   .gitignore copiado del maestro (node_modules, dist, *.local.json, .vercel).');
  }

  const inicial = readdirSync(dir).slice(0, 12).join('  ');
  console.log('   lo que hay en la carpeta ahora (nivel principal):');
  console.log('   ' + (inicial || '(vacía)'));
  if ((await pregunta(' ¿Iniciar el repo, commitear y pushear? (S/N): ', 'N')).toUpperCase() !== 'S') {
    console.log('   Cancelado: la carpeta queda sin git, se puede intentar de nuevo desde la opción 5 o 6.');
    return false;
  }

  const init = git(['init', '-b', 'main'], dir);
  if (!init.ok) { console.log('   git init falló: ' + init.salida); return false; }
  if (!git(['add', '.'], dir).ok) { console.log('   git add falló.'); return false; }
  const staged = git(['diff', '--cached', '--name-only'], dir).salida.split('\n').filter(Boolean);
  const peligroso = staged.filter((f) => /(^|\/)node_modules\/|(^|\/)dist\/|\.local\.json$|^claves\.txt$/.test(f));
  if (peligroso.length) {
    console.log(`   STOP: el add incluye ${peligroso.length} archivo(s) que no van al remoto (${peligroso[0]}...).`);
    console.log('   No commiteé nada. Revisá el .gitignore de la carpeta.');
    return false;
  }
  console.log(`   ${staged.length} archivo(s) para el commit.`);
  const commit = git(['commit', '-m', MSG_COMMIT], dir);
  if (!commit.ok) { console.log('   git commit falló: ' + commit.salida.split('\n').slice(0, 4).join(' | ')); return false; }
  console.log('   commit listo.');

  const url = await pregunta(' URL del repo vacío en GitHub (ej https://github.com/usuario/empresa.git — Enter para dejarlo solo local): ');
  if (!url) {
    console.log(`   Quedó local. Cuando lo creas en GitHub, desde ${dir}:`);
    console.log('     git remote add origin <URL>');
    console.log('     git push -u origin main');
    return true;
  }
  if (!git(['remote', 'add', 'origin', url], dir).ok) { console.log('   No se pudo agregar el remoto.'); return false; }
  const push = git(['push', '-u', 'origin', 'main'], dir);
  console.log('   ' + (push.salida || '(sin salida)').split('\n').slice(-3).join('\n   '));
  if (!push.ok) {
    console.log('   El push NO salió (¿el repo existe en GitHub, o faltan las credenciales?).');
    console.log('   El commit queda local: cuando lo arregles, la opción 5 o 6 termina de subirlo.');
    return false;
  }
  console.log('   Listo: la empresa ya se sube igual que las demas, desde la opción 5 o 6.');
  return true;
}

async function gitUna(t) {
  console.log(`\n================ ${t.nombre} ================`);
  console.log(`   carpeta: ${t.dir}`);
  if (!git(['rev-parse', '--is-inside-work-tree'], t.dir).ok) {
    console.log('   NO es (todavía) un repositorio git.');
    await crearRepo(t.dir, t.nombre);
    return false;
  }
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], t.dir).salida || '?';
  const remoto = git(['remote', 'get-url', 'origin'], t.dir);
  if (!remoto.ok) {
    console.log('   No tiene remoto "origin": se saltea (configuralo antes de poder pushear).');
    return false;
  }
  console.log(`   rama: ${rama}   origin: ${remoto.salida}`);
  console.log('   estado local antes de tocar nada:');
  const inicial = git(['status', '--short'], t.dir).salida;
  console.log(inicial ? '   ' + inicial.split('\n').join('\n   ') : '   (sin cambios)');

  if ((await pregunta(` ¿Pull, add, commit y push en ${t.nombre}? (S/N): `, 'N')).toUpperCase() !== 'S') {
    console.log('   Cancelado: no se tocó el historial.');
    return false;
  }

  const pull = git(['pull', 'origin', rama, '--no-edit'], t.dir);
  console.log(pull.salida ? '   ' + pull.salida.split('\n').join('\n   ') : '   (pull sin salida)');
  if (!pull.ok) {
    console.log('   SE DETUVO acá: el pull falló y no se commiteó ni se pusheó nada.');
    return false;
  }
  if (!git(['add', '.'], t.dir).ok) {
    console.log('   SE DETUVO: git add falló.');
    return false;
  }
  const staged = git(['diff', '--cached', '--name-status'], t.dir).salida;
  console.log('   lo que entra en el commit:');
  console.log(staged ? '   ' + staged.split('\n').join('\n   ') : '   (nada staged: no hay cambios)');
  const commit = git(['commit', '-m', MSG_COMMIT], t.dir);
  console.log('   ' + commit.salida.split('\n').slice(0, 3).join('\n   '));
  if (!commit.ok && !/nothing to commit|nada para commitear/i.test(commit.salida)) {
    console.log('   SE DETUVO: git commit falló y no se pusheó.');
    return false;
  }
  const push = git(['push', 'origin', rama], t.dir);
  console.log('   ' + (push.salida || '(sin salida)').split('\n').slice(-3).join('\n   '));
  if (!push.ok) {
    console.log('   El push NO salió: el commit queda local, revisá el mensaje de arriba.');
    return false;
  }
  console.log('   Listo: actualizado, commiteado y pusheado.');
  return true;
}

async function accionGit(unas) {
  const carpetas = carpetasGit();
  let destinos = carpetas;
  if (unas) {
    carpetas.forEach((c, i) => console.log(`   ${i + 1}. ${c.nombre}`));
    const n = Number(await pregunta(' Número de la carpeta (0 para cancelar): ', '0'));
    if (!n) return;
    destinos = [carpetas[n - 1]].filter(Boolean);
  }
  for (const c of destinos) await gitUna(c);
  await pausa('Git terminada.');
}

// ---------------------------------------------------------------- nueva empresa
async function nuevaEmpresa() {
  console.log('\nPara crear una empresa hacen falta el project ref y el nombre.');
  console.log('Lo demás (WhatsApp, Instagram, logo, moneda, idioma) se puede completar');
  console.log('después a mano en public/config.js del cliente o con más banderas.');
  const ref = await pregunta(' Project ref de Supabase (20 caracteres, de la URL del proyecto): ');
  if (!/^[A-Za-z0-9]{15,25}$/.test(ref)) {
    console.log('   Eso no parece un project ref (20 letras y números). Cancelado.');
    return pausa('Revisá el ref y volvé a intentar.');
  }
  const nombre = await pregunta(' Nombre de la empresa (como se va a ver en la app): ');
  if (!nombre) return pausa('Sin nombre no se crea nada.');
  const args = ['scripts/nueva-empresa.mjs', 'init', '--ref', ref, '--empresa', nombre, '--out', join(dirname(RAIZ), nombre)];
  const whatsapp = await pregunta(' WhatsApp con código de país (Enter para saltar): ');
  if (whatsapp) args.push('--whatsapp', whatsapp);
  const instagram = await pregunta(' Instagram (url o @usuario, Enter para saltar): ');
  if (instagram) args.push(instagram.startsWith('@') ? '--handle' : '--instagram', instagram);
  const moneda = await pregunta(' Moneda (BOB / PEN / USD, Enter para la del maestro): ');
  if (moneda) args.push('--moneda', moneda);
  const idioma = await pregunta(' Idioma por defecto (es / en / pt, Enter para es): ');
  if (idioma) args.push('--idioma', idioma);
  console.log(`\n   se crea en ..\\${nombre} (al lado del maestro)\n`);
  const creado = nodoNode(args) === 0;
  if (!creado) {
    console.log('\n El script de creación terminó con error: no se ofrece el git.');
    return pausa('Revisá el mensaje de arriba y volvé a intentar.');
  }

  const e = leerEmpresas().find((x) => dirDe(x) === join(dirname(RAIZ), nombre));
  if (!e) return pausa('\n La empresa no quedó en install/empresas.json: revisá el mensaje del script.');

  console.log('\n Ya aparece en las opciones 1, 2, 5 y 6 de este menú, sin generar ni editar ningún .bat.');
  if ((await pregunta(` ¿Difundir ahora el código del maestro a ${e.empresa}? (S/N): `, 'N')).toUpperCase() === 'S') {
    nodoNode(['scripts/difundir.mjs', '--empresa', e.storagePrefix, '--aplicar']);
  }
  // Una sola barrera: crearRepo pregunta S/N antes de commitear, así que acá no se pregunta dos veces.
  console.log('\n Si la carpeta todavía no es un repo git, se ofrece armarlo (init, commit, push).');
  await crearRepo(dirDe(e), e.empresa);
  await pausa('Fin de la creación.');
}

// ---------------------------------------------------------------- menú
const AYUDA = `
  1. Actualizar UNA empresa (difundir código del maestro)
  2. Actualizar TODAS las empresas
  3. Ver inventario de versiones
  4. Crear una empresa nueva
  5. Git de UNA carpeta (pull, add, commit, push)
  6. Git de TODAS las carpetas (maestro + empresas)
  0. Salir`;

const MENSAJES = { '1': () => difundir(true), '2': () => difundir(false), '3': async () => { nodoNode(['scripts/versiones.mjs']); await pausa('Inventario terminado.'); }, '4': nuevaEmpresa, '5': () => accionGit(true), '6': () => accionGit(false) };

while (true) {
  console.log('\n============================================');
  console.log(`  Catering Control - Panel de control  (${basename(RAIZ)})`);
  console.log('============================================' + AYUDA + '\n');
  const op = await pregunta(' Elegí una opción (0-6): ');
  if (op === '0') break;
  const accion = MENSAJES[op];
  if (!accion) console.log('   Opción inválida.');
  else await accion();
}
rl.close();

// scripts/nueva-empresa.mjs  ·  Alta de una empresa nueva sin pasos manuales.
//
//   node scripts/nueva-empresa.mjs init --ref abcdef0123456789abcde --empresa "Rápida Catering" \
//        --whatsapp 59170012345 --instagram https://www.instagram.com/rapida --moneda BOB
//   node scripts/nueva-empresa.mjs lista
//
// Escribe public/config.js y public/manifest.json, genera el SQL con el project ref ya reemplazado,
// crea el par VAPID, deja la empresa en install/empresas.json y muestra lo que queda hacer.
//
// Corré SIEMPRE este script desde la carpeta master (la de pruebas): install/empresas.json vive
// solo ahí y es el registro de todas las empresas; las carpetas de cada cliente no lo llevan.
// Con --out <dir> arma la empresa en otra carpeta sin tocar el config.js del master.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Hay que actualizarla cuando esta carpeta se reemplace por un ZIP de otra versión.
const VERSION_CODIGO = 'v71';
const GENERICA = new Set(['catering', 'comida', 'gourmet', 'food', 'y', '&', 'de', 'la', 'el', 'los', 'las']);
const MONEDAS = { BOB: 'es', Bs: 'es', PYG: 'es', Gs: 'es', ARS: 'es', CLP: 'es', COP: 'es', PEN: 'es', MXN: 'es', DOP: 'es', CRC: 'es', GTQ: 'es', UYU: 'es', USD: 'en', EUR: 'en' };

// resolve-maps-link la llama el portal antes de iniciar sesión, y send-push /
// cerrar-dia-automatico las llama pg_cron desde la base sin JWT: verify_jwt roto = 401 silencioso.
const FUNCIONES = [
  { slug: 'image-storage', verifyJwt: true },
  { slug: 'resolve-maps-link', verifyJwt: false },
  { slug: 'send-push', verifyJwt: false },
  { slug: 'cerrar-dia-automatico', verifyJwt: false },
  { slug: 'verificar-comprobante', verifyJwt: true },
];

const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const kebab = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// "In Shape Catering" -> "inshape": el prefijo se forma con las palabras no genéricas, juntas.
const prefijo = (nombre) => {
  const partes = sinTildes(nombre).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((p) => p && !GENERICA.has(p));
  const base = partes.length ? partes.join('') : kebab(nombre);
  return `catering-app-${base}`;
};

function vapid() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = (b64) => Buffer.from(b64, 'base64url');
  const pub = Buffer.concat([Buffer.from([0x04]), raw(jwk.x), raw(jwk.y)]);
  return { publica: pub.toString('base64url'), privada: privateKey.export({ format: 'jwk' }).d };
}

// Reemplaza solo el valor del campo para no tocar los comentarios que explican cada dato.
function campo(texto, clave, valor, ruta) {
  const re = new RegExp(`^(\\s*${clave}:\\s*)'(?:[^'\\\\]|\\\\.)*'`, 'm');
  if (!re.test(texto)) throw new Error(`No se encontró el campo "${clave}" en ${ruta}`);
  return texto.replace(re, `$1'${valor.replace(/'/g, "\\'")}'`);
}

function campoJson(texto, clave, valor, ruta) {
  const re = new RegExp(`^(\\s*"${clave}":\\s*)"((?:[^"\\\\]|\\\\.)*)"`, 'm');
  if (!re.test(texto)) throw new Error(`No se encontró el campo "${clave}" en ${ruta}`);
  return texto.replace(re, `$1${JSON.stringify(valor)}`);
}

// El rótulo del ícono que Android/iOS muestran al instalar la PWA sale de short_name y se lee
// ANTES de que cargue React: document.title con branding.companyName no lo alcanza a corregir.
const nombreCorto = (nombre) => {
  const partes = nombre.split(/\s+/).filter((p) => !GENERICA.has(sinTildes(p).toLowerCase().replace(/[^a-z0-9]/g, '')));
  return (partes.join(' ') || nombre).slice(0, 14).trim();
};

const DESCRIPCION = {
  es: (n) => `Gestión diaria y portal de clientes de ${n}`,
  en: (n) => `Daily operations and client portal for ${n}`,
  pt: (n) => `Gestão diária e portal de clientes de ${n}`,
};

// Devuelve el texto del manifiesto o null si ya estaba igual (no toca el archivo).
function escribirManifest(plantilla, destino, nombre, idioma, corto) {
  let manifiesto = plantilla;
  for (const [clave, valor] of [
    ['name', nombre], ['short_name', corto || nombreCorto(nombre)],
    ['description', (DESCRIPCION[idioma] || DESCRIPCION.es)(nombre)],
  ]) manifiesto = campoJson(manifiesto, clave, valor, destino);
  if (manifiesto === plantilla) return null;
  writeFileSync(destino, manifiesto);
  return { ruta: destino, corto: corto || nombreCorto(nombre) };
}

function argumentos(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else out._.push(a);
  }
  return out;
}

function exigir(valor, nombre, patron, ayuda) {
  if (!valor) throw new Error(`Falta --${nombre}`);
  if (patron && !patron.test(valor)) throw new Error(`--${nombre} no es válido ("${valor}"). ${ayuda}`);
  return valor;
}

const REGISTRO_NOMBRE = 'empresas.json';

function leerRegistro(archivo) {
  if (!existsSync(archivo)) return [];
  try { return JSON.parse(readFileSync(archivo, 'utf8')).empresas ?? []; }
  catch { throw new Error(`${archivo} está dañado; arreglalo a mano antes de dar de alta otra empresa.`); }
}

function init(opts) {
  const ref = exigir(opts.ref, 'ref', /^[a-z0-9]{20}$/, 'es el ID de 20 caracteres de la URL del proyecto en Supabase.');
  const nombre = exigir(opts.empresa, 'empresa', null, 'nombre tal como se mostrará en la app.');
  const salida = opts.out ? resolve(opts.out) : RAIZ;
  const destinoConfig = opts.out ? join(salida, 'config.js') : join(RAIZ, 'public', 'config.js');
  const destSqlDir = join(salida, 'install');
  mkdirSync(destSqlDir, { recursive: true });

  const prefix = opts['storage-prefix'] || prefijo(nombre);
  const registro = leerRegistro(join(RAIZ, 'install', REGISTRO_NOMBRE));
  // Re-escribir la misma empresa es un aggiornamento de config; otro nombre con el mismo
  // prefijo o ref significa que se está pisando la instancia de otra empresa.
  const conflicto = registro.find((e) => (e.storagePrefix === prefix || e.projectRef === ref) && e.empresa !== nombre);
  if (conflicto && !opts.force) {
    throw new Error(`El prefijo ${prefix} o el ref ${ref} ya son de "${conflicto.empresa}". Usá --force solo si sabés que es lo correcto.`);
  }
  const reutiliza = registro.some((e) => e.storagePrefix === prefix && e.empresa === nombre);

  const moneda = (opts.moneda || 'BOB').toUpperCase();
  const idioma = exigir(opts.idioma || MONEDAS[moneda] || 'es', 'idioma', /^(es|en|pt)$/, 'es, en o pt.');
  const whatsapp = exigir(opts.whatsapp, 'whatsapp', /^[0-9]{8,15}$/, 'sólo dígitos, con código de país.');
  const instagram = opts.instagram || '';
  // El link de la bio suele traer ?stkn=..., que no forma parte del @usuario.
  const handle = opts.handle || (instagram ? `@${instagram.split(/[?#]/)[0].split('/').filter(Boolean).pop()}` : '');
  const logo = opts.logo || 'icons/icon-512.png';
  const publishable = opts['publishable-key'] || '';

  let config = readFileSync(join(RAIZ, 'public', 'config.js'), 'utf8');
  for (const [clave, valor] of [
    ['companyName', nombre], ['logoUrl', logo], ['whatsappNumber', whatsapp],
    ['instagramUrl', instagram], ['instagramHandle', handle], ['storagePrefix', prefix],
    ['defaultLanguage', idioma], ['currency', moneda],
    ['supabaseUrl', `https://${ref}.supabase.co`], ['supabaseKey', publishable],
  ]) config = campo(config, clave, valor, 'public/config.js');

  let vap;
  if (opts['vapid-public'] && opts['vapid-private']) vap = { publica: opts['vapid-public'], privada: opts['vapid-private'], reutilizada: true };
  else vap = vapid();
  config = campo(config, 'vapidPublicKey', vap.publica, 'public/config.js');
  writeFileSync(destinoConfig, config);

  const plantillaManifest = join(RAIZ, 'public', 'manifest.json');
  const destinoManifest = opts.out ? join(salida, 'manifest.json') : plantillaManifest;
  const manifiesto = escribirManifest(readFileSync(plantillaManifest, 'utf8'), destinoManifest, nombre, idioma, opts.corto);

  const sqlOriginal = join(RAIZ, 'install', 'supabase-setup-final.sql');
  const crudo = readFileSync(sqlOriginal, 'utf8');
  const ocurrencias = crudo.split('<PROJECT_REF>').length - 1;
  if (!ocurrencias) throw new Error(`${sqlOriginal} no tiene <PROJECT_REF>: revisá el archivo antes de seguir.`);
  const resuelto = crudo.replaceAll('<PROJECT_REF>', ref);
  const sobrantes = resuelto.split('PROJECT_REF').length - 1;
  if (sobrantes) throw new Error(`Quedaron ${sobrantes} referencias a PROJECT_REF sin reemplazar en el SQL.`);
  const sqlSalida = join(destSqlDir, `supabase-setup-${prefix.replace('catering-app-', '')}.sql`);
  const previo = existsSync(sqlSalida) ? readFileSync(sqlSalida, 'utf8') : null;
  if (previo !== null && previo !== resuelto && !opts.force) {
    throw new Error(`${sqlSalida} ya existe con otro contenido. Usá --force para reemplazarlo.`);
  }
  if (previo !== resuelto) writeFileSync(sqlSalida, resuelto);

  if (!vap.reutilizada) {
    const secretos = join(destSqlDir, `secretos-${prefix.replace('catering-app-', '')}.local.json`);
    writeFileSync(secretos, JSON.stringify({ storagePrefix: prefix, VAPID_PUBLIC_KEY: vap.publica, VAPID_PRIVATE_KEY: vap.privada }, null, 2));
    vap.archivo = secretos;
  }

  // Re-generar una empresa ya registrada actualiza su config, pero no borra lo que el script
  // no conoce: la fecha de alta original y las migraciones que esa base ya tiene aplicadas.
  const previa = registro.find((e) => e.storagePrefix === prefix);
  const empresa = {
    ...previa,
    empresa: nombre, carpeta: basename(salida), storagePrefix: prefix, projectRef: ref,
    moneda: moneda, idioma, pruebas: previa?.pruebas ?? Boolean(opts.pruebas),
    version: VERSION_CODIGO, alta: previa?.alta ?? new Date().toISOString().slice(0, 10),
    sql: basename(sqlSalida), migraciones: previa?.migraciones ?? [],
  };
  const resto = registro.filter((e) => e.storagePrefix !== prefix);
  // El registro es uno solo y vive en el master, aunque la empresa se genere en otra carpeta.
  const destinoRegistro = join(RAIZ, 'install', REGISTRO_NOMBRE);
  writeFileSync(destinoRegistro, JSON.stringify({ empresas: [...resto, empresa].sort((a, b) => a.empresa.localeCompare(b.empresa)) }, null, 2));

  console.log(`\n== ${nombre} ==${reutiliza ? '  (ya estaba registrada: registro actualizado)' : ''}`);
  console.log(`  prefijo      ${prefix}`);
  console.log(`  config       ${destinoConfig}`);
  console.log(`  manifest     ${manifiesto ? `${manifiesto.ruta}  (rótulo del ícono PWA: "${manifiesto.corto}")` : `${destinoManifest}  (ya estaba al día)`}`);
  console.log(`  SQL          ${sqlSalida}  (${ocurrencias} URLs con el ref resuelto, 0 pendientes)`);
  if (vap.archivo) console.log(`  VAPID        ${vap.archivo}  (privada: no va al repo)`);
  console.log(`  registro     ${destinoRegistro}`);
  if (!publishable) console.log('  \x07AVISO: supabaseKey quedó vacío. Pasá --publishable-key del proyecto nuevo.');

  console.log(`
== Pasos que siguen siendo manuales ==
1. Ejecutá en el SQL Editor del proyecto ${ref}:
   ${sqlSalida}
2. Desplegá las funciones:
${FUNCIONES.map((f) => `   supabase functions deploy ${f.slug}${f.verifyJwt ? '' : ' --no-verify-jwt'}`).join('\n')}
   (deploy no cambia verify_jwt: corregilo desde Settings de cada función o con
    PATCH https://api.supabase.com/v1/projects/${ref}/functions/<slug> {"verify_jwt":false})
3. Secretos de Edge Functions: VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (están en el .local.json),
   GEMINI_API_KEY (Google AI Studio) y SUPABASE_SERVICE_ROLE_KEY si el proyecto no la trae.
4. Corré el alta del primer usuario (ver Guía-Nueva-Empresa-React.docx) y probá push + comprobante.
5. Despliegue: Workers para las empresas (Vercel para las pruebas), dominios según la guía.
   El fallback de rutas de React en Workers se configura con
   assets.not_found_handling = "single-page-application". NO agregues public/_redirects:
   Cloudflare rechaza el deploy con "Infinite loop detected in this rule". Las cabeceras
   de seguridad y de caché sí se leen de public/_headers.`);
}

// Lee un campo de public/config.js sin ejecutar el archivo.
function leerCampo(texto, clave) {
  const m = texto.match(new RegExp(`^\\s*${clave}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm'));
  if (!m) throw new Error(`No se encontró "${clave}" en public/config.js.`);
  return m[1].replace(/\\'/g, "'");
}

// Con el nombre ya editado a mano en public/config.js, alinea el manifest sin tocar nada más.
function manifest(corto) {
  const config = readFileSync(join(RAIZ, 'public', 'config.js'), 'utf8');
  const nombre = leerCampo(config, 'companyName');
  const idioma = leerCampo(config, 'defaultLanguage');
  const destino = join(RAIZ, 'public', 'manifest.json');
  const manifiesto = escribirManifest(readFileSync(destino, 'utf8'), destino, nombre, idioma, corto);
  console.log(manifiesto
    ? `manifest escrito: name="${nombre}"  short_name="${manifiesto.corto}"`
    : `manifest ya coincidía con "${nombre}" (no cambió nada).`);
}

function lista() {
  const registro = leerRegistro(join(RAIZ, 'install', REGISTRO_NOMBRE));
  if (!registro.length) return console.log('Todavía no hay empresas registradas.');
  const ancho = Math.max(...registro.map((e) => e.empresa.length));
  for (const e of registro) {
    console.log(`${e.empresa.padEnd(ancho)}  ${e.pruebas ? 'PRUEBAS  ' : '         '}${e.carpeta ?? ''}  ${e.projectRef}  ${e.storagePrefix}  ${e.moneda}  ${e.version}  alta ${e.alta}`);
  }
  console.log(`\n${registro.length} entrada(s).`);
}

const USO = `node scripts/nueva-empresa.mjs init --ref <project-ref> --empresa "Nombre" --whatsapp <dígitos con país> \\
     [--instagram <url>] [--handle @usuario] [--logo icons/icon-512.png] [--moneda BOB] [--idioma es] \\
     [--corto "Catering Control"] [--publishable-key sb_publishable_...] \\
     [--vapid-public K --vapid-private K] [--out <dir>] [--pruebas] [--force]
node scripts/nueva-empresa.mjs manifest [--corto "Rótulo del ícono PWA"]
node scripts/nueva-empresa.mjs lista`;

const opts = argumentos(process.argv.slice(2));
const comando = opts._[0] || 'init';
try {
  if (comando === 'init' && opts.help) console.log(USO);
  else if (comando === 'init') init(opts);
  else if (comando === 'manifest') manifest(opts.corto);
  else if (comando === 'lista') lista();
  else throw new Error(`Comando desconocido "${comando}". Usá init, manifest o lista.\n${USO}`);
} catch (err) {
  console.error(`\n\x07${err.message}\n`);
  process.exitCode = 1;
}

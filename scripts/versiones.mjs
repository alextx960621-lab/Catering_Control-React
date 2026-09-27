// scripts/versiones.mjs  ·  Inventario de versiones por empresa (SOLO LECTURA).
//
//   node scripts/versiones.mjs --local      lee los snapshots SQL de cada empresa (sin tocar la red)
//   node scripts/versiones.mjs --api        lee la versión real de cada base por la API de gestión
//                                           de Supabase (requiere SUPABASE_ACCESS_TOKEN; nunca se imprime)
//   node scripts/versiones.mjs --json       la misma información, en JSON para otros scripts
//
// Responde dos preguntas del dueño: en qué versión está cada cliente y qué le falta para quedar al día.
// Nunca escribe nada: ni en las bases, ni en el registro, ni en el disco.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PADRE = dirname(RAIZ); // las carpetas de cada empresa son hermanas del maestro
const SETUP_MAESTRO = join(RAIZ, 'install', 'supabase-setup-final.sql');
const REGISTRO = join(RAIZ, 'install', 'empresas.json');
const CAMBIOS = join(RAIZ, 'CAMBIOS.md');
const PLACEHOLDER = '<PROJECT_REF>';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const corto = (h) => (h ? h.slice(0, 8) : '—');

// "1.5" vs "1.24": compara por partes numéricas (1.24 es más nuevo que 1.5), no lexicográfico.
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Lee la versión de esquema declarada en un setup: el literal "-- version de esquema: X.Y".
function versionDeEsquema(texto) {
  const m = texto.match(/version de esquema:\s*([0-9]+(?:\.[0-9]+)*)/);
  return m ? m[1] : null;
}

function maestro() {
  const texto = readFileSync(SETUP_MAESTRO, 'utf8');
  const esquema = versionDeEsquema(texto);
  // El maestro guarda su hash sobre el archivo tal cual (con <PROJECT_REF> literal).
  return { texto, esquema, hash: sha256(texto), archivo: SETUP_MAESTRO };
}

// Snapshot de una empresa: su carpeta + install/<sql>. La empresa de pruebas es el propio maestro.
function rutaSnapshot(empresa) {
  const dir = join(PADRE, empresa.carpeta ?? '', 'install');
  if (empresa.sql) {
    const r = join(dir, empresa.sql);
    return existsSync(r) ? r : null;
  }
  const finalEnCarpeta = join(dir, 'supabase-setup-final.sql');
  return existsSync(finalEnCarpeta) ? finalEnCarpeta : null;
}

// Un snapshot ya no coincide byte-a-byte con el maestro si se lo generó de otra versión:
// se reemplaza el projectRef real por el placeholder para poder compararlo con el maestro.
// También se normaliza el nombre que el snapshot declara en db_app_version: nueva-empresa.mjs
// lo resuelve al nombre propio del snapshot, y esa diferencia es a propósito, no un desfase.
function leerSnapshot(empresa, m) {
  const ruta = rutaSnapshot(empresa);
  if (!ruta) return { ruta: null, coincide: null, esquema: null, hash: null, hashNorm: null };
  const texto = readFileSync(ruta, 'utf8');
  const conRef = empresa.projectRef ? texto.split(empresa.projectRef).join(PLACEHOLDER) : texto;
  const normalizado = conRef.replace(/'setup', 'supabase-setup-[^']*\.sql'/, `'setup', 'supabase-setup-final.sql'`);
  const hashNorm = sha256(normalizado);
  return {
    ruta,
    esquema: versionDeEsquema(texto),
    hash: sha256(texto),
    hashNorm,
    coincide: hashNorm === m.hash,
  };
}

// Parsea CAMBIOS.md: cada "## <título>" que traiga versión (código vX / esquema X.Y) o fecha.
// Además saca la tabla "Estado por base" (filas cuya primera celda trae el projectRef) por empresa.
function parsearCambios(texto) {
  const lineas = texto.split(/\r?\n/);
  const entradas = [];
  let actual = null;
  for (const ln of lineas) {
    const h = ln.match(/^##\s+(.+)$/);
    if (h) {
      const titulo = clean(h[1]);
      const codigo = (titulo.match(/\bv(\d+)\b/i) || [])[0] || null;
      const fecha = (titulo.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;
      const sinFecha = titulo.replace(/\d{4}-\d{2}-\d{2}/g, ' ');
      const esquema = (sinFecha.match(/esquema[:\s]*([0-9]+(?:\.[0-9]+)*)/i) || [])[1]
        || (sinFecha.match(/(^|[^\dv.])\b([0-9]+\.[0-9]+)\b/) || [])[2] || null;
      // Solo es una entrada de version si trae codigo, esquema o fecha. "## Reglas fijas" no cuenta.
      actual = (codigo || esquema || fecha)
        ? { titulo, codigo, esquema, fecha, estado: {}, _en: null }
        : null;
      if (actual) entradas.push(actual);
      continue;
    }
    if (!actual) continue;
    if (/^\s*\|/.test(ln)) {
      const celdas = ln.split('|').map(clean).filter((_, i, a) => i > 0 && i < a.length - 1);
      if (celdas.length < 3) continue;
      const ref = (celdas[0].match(/\b[a-z0-9]{20}\b/) || [])[0];
      if (!ref) continue;
      actual.estado[ref] = { sql: estado(celdas[1]), edge: estado(celdas[2]) };
    }
  }
  return entradas;
}

const estado = (celda) => (/✅/.test(celda) ? 'done' : (/⬜|pendiente/i.test(celda) ? 'pend' : ''));

// Una pasada de CAMBIOS.md para saber si la empresa tiene la fila marcada como pendiente.
function faltantes(entradas, empresa, instalada, codigo) {
  const out = [];
  for (const e of entradas) {
    let motivo = null;
    if (e.esquema && instalada && cmpVersion(e.esquema, instalada) > 0) motivo = `esquema ${e.esquema} > instalado ${instalada}`;
    const nE = e.codigo && Number(e.codigo.slice(1));
    const nC = codigo && Number(String(codigo).replace(/^v/i, ''));
    if (!motivo && nE && nC && nE > nC) motivo = `código ${e.codigo} > ${codigo}`;
    if (!motivo && e.estado[empresa.projectRef]?.sql === 'pend') motivo = 'pendiente en "Estado por base"';
    if (motivo) out.push({ titulo: e.titulo, motivo });
  }
  return out;
}

// Modo --api: lee public._app_version() de cada base por la API de gestión de Supabase.
// Solo corre si hay token; si falta, avisa y sigue (nunca crashea, nunca imprime el token).
async function versionPorApi(empresa, token) {
  const url = `https://api.supabase.com/v1/projects/${empresa.projectRef}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select public._app_version() as payload' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${empresa.projectRef}`);
  const data = await res.json();
  const fila = Array.isArray(data) ? data[0] : (data?.result?.[0] ?? data);
  const payload = fila?.payload ?? fila?.app_version ?? fila;
  const esquema = payload && typeof payload === 'object' ? (payload.esquema ?? null) : null;
  return { esquema, payload };
}

function argumentos(argv) {
  const a = { _: [] };
  for (const x of argv) { if (x.startsWith('--')) a[x.slice(2)] = true; else a._.push(x); }
  return a;
}

async function main() {
  const args = argumentos(process.argv.slice(2));
  const modo = args.api ? 'api' : 'local';
  const registro = JSON.parse(readFileSync(REGISTRO, 'utf8'));
  const m = maestro();
  const entradas = parsearCambios(existsSync(CAMBIOS) ? readFileSync(CAMBIOS, 'utf8') : '');
  const empresas = registro.empresas ?? [];

  const token = process.env.SUPABASE_ACCESS_TOKEN || '';
  const avisoApi = modo === 'api' && !token
    ? 'SUPABASE_ACCESS_TOKEN no está definido: no se puede leer la base. Se muestran solo los datos locales/registro.'
    : null;

  const filas = [];
  for (const e of empresas) {
    const snap = modo === 'local' ? leerSnapshot(e, m) : { ruta: rutaSnapshot(e), coincide: null, esquema: null };
    let instalada = e.schemaVersion ?? snap.esquema ?? null;
    let codigo = e.version ?? null;
    let fuente = snap.esquema ? 'snapshot' : (e.schemaVersion ? 'registro' : null);
    let error = null;
    if (modo === 'api' && token && e.projectRef) {
      try {
        const api = await versionPorApi(e, token);
        if (api.esquema) { instalada = api.esquema; fuente = 'api'; }
      } catch (err) { error = clean(err.message); }
    }
    const falt = faltantes(entradas, e, instalada, codigo);
    const estadoRef = entradas.reduce((acc, en) => (en.estado[e.projectRef] ? en.estado[e.projectRef] : acc), null);
    filas.push({
      empresa: e.empresa, carpeta: e.carpeta, projectRef: e.projectRef, codigo,
      esquemaInstalada: instalada, fuente, coincide: snap.coincide,
      snapshotArchivo: snap.ruta, hashSnapshot: snap.hash, hashNormalizado: snap.hashNorm,
      estadoSql: estadoRef?.sql ?? '', estadoEdge: estadoRef?.edge ?? '',
      faltan: falt, error,
    });
  }

  // Aviso: versión de esquema del maestro que todavía no tiene entrada documentada en CAMBIOS.md.
  const avisos = [];
  if (m.esquema && !entradas.some((e) => e.esquema === m.esquema))
    avisos.push(`La versión de esquema ${m.esquema} del maestro no aparece documentada en CAMBIOS.md.`);

  if (args.json) {
    console.log(JSON.stringify({
      modo, maestro: { esquemaVersion: m.esquema, sqlHash: m.hash, archivo: SETUP_MAESTRO },
      avisoApi, empresas: filas, avisos,
    }, null, 2));
    return;
  }

  const titulo = (t) => t.length > 46 ? `${t.slice(0, 45)}…` : t;
  console.log(`\n== Inventario de versiones ==  esquema maestro ${m.esquema ?? '?'}  ·  setup sha256 ${corto(m.hash)}`);
  console.log(`   modo: ${modo}${avisoApi ? `  (${avisoApi})` : ''}\n`);
  const w = Math.max(7, ...empresas.map((e) => e.empresa.length));
  console.log(`${'EMPRESA'.padEnd(w)}  ${'CÓDIGO'.padEnd(6)}  ${'ESQUEMA'.padEnd(16)}  ${'SNAPSHOT'.padEnd(11)}  LE FALTA (CAMBIOS.md)`);
  for (const f of filas) {
    const esc = f.esquemaInstalada ? `${f.esquemaInstalada} (${f.fuente})` : '—';
    const snap = f.coincide === true ? 'coincide' : f.coincide === false ? 'no coincide' : 'sin dato';
    const falt = f.faltan.length ? `${f.faltan.length} · ${titulo(f.faltan[0].titulo)}` : 'al día';
    console.log(`${f.empresa.padEnd(w)}  ${(f.codigo ?? '—').padEnd(6)}  ${esc.padEnd(16)}  ${snap.padEnd(11)}  ${falt}`);
    const notas = [];
    if (!f.projectRef) notas.push('sin projectRef: todavía no tiene base Supabase dada de alta (--api la omite)');
    if (!f.esquemaInstalada) notas.push('versión de esquema desconocida (snapshot previo a la marca, o --api sin token)');
    if (f.esquemaInstalada && f.esquemaInstalada !== m.esquema) notas.push(`detrás del maestro (${m.esquema})`);
    if (f.coincide === false) notas.push(`snapshot ${corto(f.hashNormalizado)} ≠ maestro ${corto(m.hash)}`);
    if (f.estadoSql === 'pend' || f.estadoEdge === 'pend') notas.push(`Estado por base: SQL ${f.estadoSql || '-'} · Edge ${f.estadoEdge || '-'}`);
    if (f.error) notas.push(`api: ${f.error}`);
    for (const n of notas) console.log(`${' '.repeat(w)}    · ${n}`);
    for (const x of f.faltan.slice(1)) console.log(`${' '.repeat(w)}    · falta: ${titulo(x.titulo)} (${x.motivo})`);
    if (f.snapshotArchivo) console.log(`${' '.repeat(w)}    · ${f.snapshotArchivo}`);
  }
  for (const a of avisos) console.log(`\n  AVISO: ${a}`);
  console.log(`\n${empresas.length} empresa(s). ${modo === 'local' ? 'Sin acceso a la red: leer una base real requiere --api con token.' : 'Modo API sobre las bases reales.'}`);
}

main().catch((err) => { console.error(`\n${err.message}\n`); process.exitCode = 1; });

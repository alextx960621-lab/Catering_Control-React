#!/usr/bin/env node
// Mapa propio por ciudad · imprime el comando exacto para generar el archivo .pmtiles de una ciudad.
//
//   npm run mapa-ciudad                      → lista las ciudades del catálogo
//   npm run mapa-ciudad -- la-paz-bo         → comando para La Paz / El Alto
//   npm run mapa-ciudad -- --id puerto-montt --lat -41.47 --lng -72.94 --km 25   → ciudad fuera del catálogo
//
// Este script NO descarga nada: solo arma el comando del CLI `pmtiles` (Protomaps) con la zona ya
// calculada. Ver la guía completa en CAMBIOS.md (entrada "Mapa propio por ciudad").
import { MAP_CITIES, findCity, cityBbox, slugify } from '../src/data/mapCities.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

function lista() {
  console.log('Ciudades del catálogo (usa el id):\n');
  let pais = '';
  for (const c of MAP_CITIES) {
    if (c.country !== pais) { pais = c.country; console.log(`\n[${pais}]`); }
    console.log(`  ${c.id.padEnd(32)} ${c.name}`);
  }
  console.log('\nPara una ciudad fuera del catálogo: --id <nombre> --lat <n> --lng <n> --km <radio>');
}

let ciudad = null;
if (positional) {
  ciudad = findCity(positional);
  if (!ciudad) { console.error(`No existe "${positional}" en el catálogo. Corre "npm run mapa-ciudad" para ver los ids.`); process.exit(1); }
} else if (flag('id')) {
  const lat = Number(flag('lat'));
  const lng = Number(flag('lng'));
  const km = Number(flag('km') || 25);
  const id = slugify(flag('id'));
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng) || !(km >= 5 && km <= 200)) {
    console.error('Para una ciudad propia hacen falta --id, --lat, --lng y --km (entre 5 y 200).');
    process.exit(1);
  }
  ciudad = { id, name: flag('id'), lat, lng, r: km / 111 };
} else {
  lista();
  process.exit(0);
}

const bbox = cityBbox(ciudad).join(',');
const maxzoom = flag('maxzoom') || 15;
const build = flag('build') || '<BUILD>';

console.log(`Ciudad: ${ciudad.name}  (archivo: ${ciudad.id}.pmtiles)`);
console.log(`Zona:   ${bbox}   (oeste,sur,este,norte)\n`);
console.log('1) Instala el CLI de Protomaps (una sola vez): https://github.com/protomaps/go-pmtiles/releases');
console.log('2) Mira cuál es la compilación más reciente en https://maps.protomaps.com/builds/ (ej.: 20260901.pmtiles)');
console.log('   y reemplaza <BUILD> por su URL, o pásala con --build <url>.');
console.log('3) Extrae solo esta ciudad (descarga solo las partes necesarias, no el planeta entero):\n');
console.log(`   pmtiles extract ${build.startsWith('http') ? build : 'https://build.protomaps.com/<BUILD>.pmtiles'} ${ciudad.id}.pmtiles --bbox=${bbox} --maxzoom=${maxzoom}\n`);
console.log('4) En Supabase → Storage crea el bucket PÚBLICO "maps" (una vez por proyecto) y sube ahí');
console.log(`   ${ciudad.id}.pmtiles. Después, en Panel → Configuración → Ciudad del mapa de Reparto, elige la ciudad.`);

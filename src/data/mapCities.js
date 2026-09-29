// Catálogo de ciudades para el mapa de Reparto (de Canadá a Argentina).
// Lo usa Configuración (selector del Super Admin), el mapa (centro y zona de la ciudad) y
// `scripts/mapa-ciudad.mjs` (comando para generar el archivo de mapa de esa ciudad).
// Es solo datos: sin JSX ni imports, para poder leerlo también desde Node.
//
// Cada fila: [id, nombre, país (ISO-2), latitud, longitud, radio en grados]. El radio marca
// hasta dónde se extrae mapa alrededor del centro (0.25° ≈ 27 km). Si a una empresa le hace
// falta más zona, en Configuración puede usar "Otra ciudad" y poner su propio radio.
// Las coordenadas son del centro de cada ciudad, con precisión de sobra para este uso.
const ROWS = [
  // Canadá
  ['toronto-ca', 'Toronto', 'CA', 43.70, -79.40, 0.30],
  ['montreal-ca', 'Montréal', 'CA', 45.50, -73.57, 0.30],
  ['vancouver-ca', 'Vancouver', 'CA', 49.28, -123.12, 0.30],
  ['calgary-ca', 'Calgary', 'CA', 51.05, -114.07, 0.25],
  ['edmonton-ca', 'Edmonton', 'CA', 53.55, -113.49, 0.25],
  ['ottawa-ca', 'Ottawa', 'CA', 45.42, -75.70, 0.25],
  ['winnipeg-ca', 'Winnipeg', 'CA', 49.90, -97.14, 0.20],
  ['quebec-ca', 'Québec', 'CA', 46.81, -71.21, 0.20],
  ['halifax-ca', 'Halifax', 'CA', 44.65, -63.58, 0.20],
  ['victoria-ca', 'Victoria', 'CA', 48.43, -123.37, 0.15],
  // Estados Unidos
  ['new-york-us', 'New York', 'US', 40.71, -74.00, 0.40],
  ['los-angeles-us', 'Los Angeles', 'US', 34.05, -118.24, 0.40],
  ['chicago-us', 'Chicago', 'US', 41.88, -87.63, 0.30],
  ['houston-us', 'Houston', 'US', 29.76, -95.37, 0.35],
  ['phoenix-us', 'Phoenix', 'US', 33.45, -112.07, 0.30],
  ['philadelphia-us', 'Philadelphia', 'US', 39.95, -75.17, 0.25],
  ['san-antonio-us', 'San Antonio', 'US', 29.42, -98.49, 0.25],
  ['san-diego-us', 'San Diego', 'US', 32.72, -117.16, 0.25],
  ['dallas-us', 'Dallas', 'US', 32.78, -96.80, 0.35],
  ['san-francisco-us', 'San Francisco', 'US', 37.77, -122.42, 0.30],
  ['austin-us', 'Austin', 'US', 30.27, -97.74, 0.25],
  ['miami-us', 'Miami', 'US', 25.76, -80.19, 0.30],
  ['orlando-us', 'Orlando', 'US', 28.54, -81.38, 0.25],
  ['tampa-us', 'Tampa', 'US', 27.95, -82.46, 0.25],
  ['jacksonville-us', 'Jacksonville', 'US', 30.33, -81.66, 0.25],
  ['atlanta-us', 'Atlanta', 'US', 33.75, -84.39, 0.30],
  ['seattle-us', 'Seattle', 'US', 47.61, -122.33, 0.25],
  ['denver-us', 'Denver', 'US', 39.74, -104.99, 0.25],
  ['boston-us', 'Boston', 'US', 42.36, -71.06, 0.25],
  ['washington-us', 'Washington D. C.', 'US', 38.91, -77.04, 0.25],
  ['las-vegas-us', 'Las Vegas', 'US', 36.17, -115.14, 0.25],
  // México
  ['ciudad-de-mexico-mx', 'Ciudad de México', 'MX', 19.43, -99.13, 0.40],
  ['guadalajara-mx', 'Guadalajara', 'MX', 20.67, -103.35, 0.30],
  ['monterrey-mx', 'Monterrey', 'MX', 25.69, -100.32, 0.30],
  ['puebla-mx', 'Puebla', 'MX', 19.04, -98.21, 0.20],
  ['tijuana-mx', 'Tijuana', 'MX', 32.51, -117.04, 0.20],
  ['leon-mx', 'León', 'MX', 21.12, -101.68, 0.20],
  ['merida-mx', 'Mérida', 'MX', 20.97, -89.62, 0.20],
  ['cancun-mx', 'Cancún', 'MX', 21.16, -86.85, 0.20],
  ['queretaro-mx', 'Querétaro', 'MX', 20.59, -100.39, 0.20],
  ['chihuahua-mx', 'Chihuahua', 'MX', 28.63, -106.07, 0.20],
  // Centroamérica
  ['guatemala-gt', 'Ciudad de Guatemala', 'GT', 14.63, -90.51, 0.25],
  ['belize-bz', 'Belice', 'BZ', 17.50, -88.20, 0.15],
  ['san-salvador-sv', 'San Salvador', 'SV', 13.69, -89.19, 0.20],
  ['tegucigalpa-hn', 'Tegucigalpa', 'HN', 14.07, -87.19, 0.20],
  ['san-pedro-sula-hn', 'San Pedro Sula', 'HN', 15.50, -88.03, 0.20],
  ['managua-ni', 'Managua', 'NI', 12.11, -86.24, 0.20],
  ['san-jose-cr', 'San José', 'CR', 9.93, -84.08, 0.20],
  ['panama-pa', 'Ciudad de Panamá', 'PA', 8.98, -79.52, 0.25],
  // Caribe
  ['la-habana-cu', 'La Habana', 'CU', 23.11, -82.37, 0.25],
  ['puerto-principe-ht', 'Puerto Príncipe', 'HT', 18.54, -72.34, 0.15],
  ['santo-domingo-do', 'Santo Domingo', 'DO', 18.49, -69.93, 0.25],
  ['santiago-de-los-caballeros-do', 'Santiago de los Caballeros', 'DO', 19.45, -70.70, 0.15],
  ['kingston-jm', 'Kingston', 'JM', 17.97, -76.79, 0.15],
  ['san-juan-pr', 'San Juan', 'PR', 18.47, -66.11, 0.20],
  ['puerto-espana-tt', 'Puerto España', 'TT', 10.66, -61.51, 0.15],
  ['nassau-bs', 'Nassau', 'BS', 25.05, -77.35, 0.15],
  // Colombia, Venezuela, Guayanas
  ['bogota-co', 'Bogotá', 'CO', 4.71, -74.07, 0.30],
  ['medellin-co', 'Medellín', 'CO', 6.25, -75.57, 0.20],
  ['cali-co', 'Cali', 'CO', 3.45, -76.53, 0.20],
  ['barranquilla-co', 'Barranquilla', 'CO', 10.96, -74.80, 0.20],
  ['cartagena-co', 'Cartagena', 'CO', 10.39, -75.48, 0.15],
  ['bucaramanga-co', 'Bucaramanga', 'CO', 7.12, -73.12, 0.15],
  ['caracas-ve', 'Caracas', 'VE', 10.48, -66.90, 0.25],
  ['maracaibo-ve', 'Maracaibo', 'VE', 10.65, -71.61, 0.20],
  ['valencia-ve', 'Valencia', 'VE', 10.16, -68.00, 0.20],
  ['georgetown-gy', 'Georgetown', 'GY', 6.80, -58.16, 0.15],
  ['paramaribo-sr', 'Paramaribo', 'SR', 5.85, -55.20, 0.15],
  // Ecuador y Perú
  ['quito-ec', 'Quito', 'EC', -0.18, -78.47, 0.25],
  ['guayaquil-ec', 'Guayaquil', 'EC', -2.17, -79.92, 0.25],
  ['cuenca-ec', 'Cuenca', 'EC', -2.90, -79.00, 0.15],
  ['lima-pe', 'Lima', 'PE', -12.05, -77.04, 0.35],
  ['arequipa-pe', 'Arequipa', 'PE', -16.41, -71.54, 0.20],
  ['trujillo-pe', 'Trujillo', 'PE', -8.11, -79.03, 0.15],
  ['cusco-pe', 'Cusco', 'PE', -13.53, -71.97, 0.15],
  // Bolivia (La Paz y El Alto son una sola mancha urbana)
  ['la-paz-bo', 'La Paz / El Alto', 'BO', -16.50, -68.16, 0.22],
  ['santa-cruz-bo', 'Santa Cruz de la Sierra', 'BO', -17.78, -63.18, 0.25],
  ['cochabamba-bo', 'Cochabamba', 'BO', -17.39, -66.16, 0.25],
  ['sucre-bo', 'Sucre', 'BO', -19.03, -65.26, 0.15],
  ['oruro-bo', 'Oruro', 'BO', -17.97, -67.11, 0.15],
  ['tarija-bo', 'Tarija', 'BO', -21.53, -64.73, 0.15],
  ['potosi-bo', 'Potosí', 'BO', -19.58, -65.75, 0.15],
  // Brasil
  ['sao-paulo-br', 'São Paulo', 'BR', -23.55, -46.63, 0.40],
  ['rio-de-janeiro-br', 'Rio de Janeiro', 'BR', -22.91, -43.17, 0.35],
  ['brasilia-br', 'Brasília', 'BR', -15.79, -47.88, 0.25],
  ['salvador-br', 'Salvador', 'BR', -12.97, -38.51, 0.25],
  ['fortaleza-br', 'Fortaleza', 'BR', -3.73, -38.53, 0.25],
  ['belo-horizonte-br', 'Belo Horizonte', 'BR', -19.92, -43.94, 0.25],
  ['manaus-br', 'Manaus', 'BR', -3.12, -60.02, 0.25],
  ['curitiba-br', 'Curitiba', 'BR', -25.43, -49.27, 0.25],
  ['recife-br', 'Recife', 'BR', -8.05, -34.88, 0.25],
  ['porto-alegre-br', 'Porto Alegre', 'BR', -30.03, -51.23, 0.25],
  ['belem-br', 'Belém', 'BR', -1.46, -48.50, 0.20],
  ['goiania-br', 'Goiânia', 'BR', -16.69, -49.26, 0.20],
  // Paraguay, Chile, Uruguay, Argentina
  ['asuncion-py', 'Asunción', 'PY', -25.26, -57.58, 0.25],
  ['santiago-cl', 'Santiago', 'CL', -33.45, -70.67, 0.35],
  ['valparaiso-cl', 'Valparaíso / Viña del Mar', 'CL', -33.04, -71.58, 0.20],
  ['concepcion-cl', 'Concepción', 'CL', -36.83, -73.05, 0.20],
  ['antofagasta-cl', 'Antofagasta', 'CL', -23.65, -70.40, 0.15],
  ['montevideo-uy', 'Montevideo', 'UY', -34.90, -56.16, 0.25],
  ['buenos-aires-ar', 'Buenos Aires', 'AR', -34.60, -58.38, 0.40],
  ['cordoba-ar', 'Córdoba', 'AR', -31.42, -64.18, 0.25],
  ['rosario-ar', 'Rosario', 'AR', -32.95, -60.65, 0.20],
  ['mendoza-ar', 'Mendoza', 'AR', -32.89, -68.84, 0.20],
  ['la-plata-ar', 'La Plata', 'AR', -34.92, -57.95, 0.15],
  ['tucuman-ar', 'San Miguel de Tucumán', 'AR', -26.82, -65.22, 0.15],
  ['mar-del-plata-ar', 'Mar del Plata', 'AR', -38.00, -57.55, 0.15],
  ['salta-ar', 'Salta', 'AR', -24.79, -65.41, 0.15],
];

export const MAP_CITIES = ROWS.map(([id, name, country, lat, lng, r]) => ({ id, name, country, lat, lng, r }));

export const CUSTOM_CITY_ID = 'custom';

export function findCity(id) {
  return MAP_CITIES.find((c) => c.id === id) || null;
}

// Convierte cualquier texto en un id de archivo seguro ("Puerto Montt" → "puerto-montt").
export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Valida lo que vino guardado en los ajustes de la empresa y lo deja listo para usar.
// Devuelve null si no hay una ciudad válida (en ese caso el mapa sigue como antes).
export function normalizeMapCity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const r = Number(raw.r);
  const id = slugify(raw.id);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { id, name: String(raw.name || id).slice(0, 80), country: String(raw.country || '').slice(0, 2).toUpperCase(), lat, lng, r: Number.isFinite(r) && r >= 0.05 && r <= 2 ? r : 0.25 };
}

// Zona rectangular [oeste, sur, este, norte] que rodea a la ciudad. Al este/oeste se abre un
// poco más lejos de los polos para que el recuadro no quede angosto (un grado de longitud
// mide menos cuanto más lejos del ecuador).
export function cityBbox(city) {
  const lonR = city.r / Math.max(0.2, Math.cos((city.lat * Math.PI) / 180));
  const f = (v) => Math.round(v * 1000) / 1000;
  return [f(city.lng - lonR), f(city.lat - city.r), f(city.lng + lonR), f(city.lat + city.r)];
}

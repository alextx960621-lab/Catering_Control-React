// ============================================================================
// Puente entre public/config.js (variable global window.APP_CONFIG) y el
// código de React. Se hace así, en vez de un simple "import", a propósito:
// public/config.js se carga como un <script> normal en index.html, así que
// se puede editar el archivo DESPUÉS de compilar la app (sin volver a
// "buildear" nada) — eso es lo que permite reusar el mismo build de React
// para varias empresas, cambiando solo este archivo.
// ============================================================================

const config = window.APP_CONFIG;

if (!config) {
  // Si esto aparece, casi seguro falta el <script src="/config.js"> en
  // index.html, o el archivo no llegó a subirse al servidor.
  throw new Error('No se encontró window.APP_CONFIG. Revisa que /config.js esté cargado en index.html.');
}

export default config;

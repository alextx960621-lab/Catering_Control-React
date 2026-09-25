// Puente entre public/config.js (variable global window.APP_CONFIG) y el código de React

const config = window.APP_CONFIG;

if (!config) {
  // Si esto aparece, casi seguro falta el <script src="/config.js"> en index.html, o el…
  throw new Error('No se encontró window.APP_CONFIG. Revisa que /config.js esté cargado en index.html.');
}

export default config;

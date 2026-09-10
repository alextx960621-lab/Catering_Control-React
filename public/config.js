// ============================================================================
// Catering Control · Datos de ESTA empresa
// ----------------------------------------------------------------------------
// Este archivo NO es parte del código de React: es el único lugar que hay
// que editar cuando se instala la app para una empresa nueva. Vive en
// /public para que quede tal cual (sin "compilar") y cualquiera lo pueda
// abrir con el Bloc de notas y cambiar estos valores, sin saber programar.
// ============================================================================
window.APP_CONFIG = {
  // Nombre que se muestra en toda la app (título, menú, etc.)
  companyName: 'Catering Control',

  // Ruta o URL del logo. Puede ser un archivo en /public (ej. './logo.jpg')
  // o un link externo.
  logoUrl: './logo.jpg',

  // Número de WhatsApp para el botón de contacto. Formato: código de país +
  // número, sin el "+" (ej. 59170000000). Déjalo vacío ('') para ocultar
  // el botón.
  whatsappNumber: '',

  // Instagram de la empresa. Déjalos vacíos para ocultar la tarjeta.
  instagramUrl: '',
  instagramHandle: '',

  // Prefijo usado para guardar datos locales en el navegador (no lo repitas
  // entre empresas distintas si comparten el mismo dominio).
  storagePrefix: 'catering-app',

  // Datos del proyecto de Supabase de ESTA empresa (Project Settings → API).
  supabaseUrl: 'https://sucygrskajrcnwizrfpd.supabase.co',
  supabaseKey: 'sb_publishable_yiChv91nKsuQVEPMd0t3Ng_hjpiurFD',
};

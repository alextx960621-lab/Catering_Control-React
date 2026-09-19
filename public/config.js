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
  logoUrl: 'icon-512.png',

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
  supabaseUrl: 'https://kkqcaiunetlikfyaldab.supabase.co',
  supabaseKey: 'sb_publishable_9EH5FSbrI0ZAV04LSJeeBg_d1X_b-Nj',

  // Clave PÚBLICA de notificaciones push (VAPID). Es pública a propósito
  // (por eso viaja acá, junto al resto de la config) -- la privada NUNCA
  // va en el navegador, vive como secreto de la Edge Function `send-push`
  // en Supabase. Si algún día cambias el par de claves, actualizá acá Y
  // en esa función a la vez, o las suscripciones viejas dejan de andar.
  vapidPublicKey: 'BGQc0vWty6x1rKDSS-QE8-5DBt0LgAAi8XuycojIHoIlDISZY5XghJtT3WkazDfD6exVTxnGXMLL1ptEuqNmkfg',
};

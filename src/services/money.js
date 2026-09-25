// Formato de dinero por moneda de la empresa. SOLO formato: no convierte montos.
// La moneda se elige en Configuración (super admin) y se guarda en el bloque `settings`.

export const CURRENCIES = [
  { code: 'USD', locale: 'en-US', label: 'Dólar estadounidense (USD)' },
  { code: 'BOB', locale: 'es-BO', label: 'Boliviano (Bs)' },
  { code: 'MXN', locale: 'es-MX', label: 'Peso mexicano (MXN)' },
  { code: 'CLP', locale: 'es-CL', label: 'Peso chileno (CLP)' },
  { code: 'COP', locale: 'es-CO', label: 'Peso colombiano (COP)' },
  { code: 'ARS', locale: 'es-AR', label: 'Peso argentino (ARS)' },
  { code: 'PEN', locale: 'es-PE', label: 'Sol peruano (PEN)' },
  { code: 'UYU', locale: 'es-UY', label: 'Peso uruguayo (UYU)' },
  { code: 'PYG', locale: 'es-PY', label: 'Guaraní paraguayo (PYG)' },
  { code: 'BRL', locale: 'pt-BR', label: 'Real brasileño (BRL)' },
  { code: 'EUR', locale: 'es-ES', label: 'Euro (EUR)' },
  { code: 'CRC', locale: 'es-CR', label: 'Colón costarricense (CRC)' },
  { code: 'DOP', locale: 'es-DO', label: 'Peso dominicano (DOP)' },
  { code: 'GTQ', locale: 'es-GT', label: 'Quetzal guatemalteco (GTQ)' },
  { code: 'HNL', locale: 'es-HN', label: 'Lempira hondureño (HNL)' },
  { code: 'NIO', locale: 'es-NI', label: 'Córdoba nicaragüense (NIO)' },
  { code: 'PAB', locale: 'es-PA', label: 'Balboa panameño (PAB)' },
  { code: 'VES', locale: 'es-VE', label: 'Bolívar venezolano (VES)' },
  { code: 'CAD', locale: 'en-CA', label: 'Dólar canadiense (CAD)' },
];

export const DEFAULT_CURRENCY = 'BOB';

export function currencyInfo(code) {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES.find((c) => c.code === DEFAULT_CURRENCY);
}

export function currencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat(currencyInfo(code).locale, { style: 'currency', currency: currencyInfo(code).code }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

// `decimals`: 0 fuerza entero, 2 fuerza centavos; sin él, se muestran centavos solo si hacen falta.
export function formatMoney(value, code = DEFAULT_CURRENCY, { decimals } = {}) {
  const num = Number(value);
  if (!isFinite(num)) return '';
  const info = currencyInfo(code);
  const withCents = decimals != null ? decimals > 0 : Math.abs(num % 1) > 1e-9;
  try {
    return new Intl.NumberFormat(info.locale, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: withCents ? 2 : 0,
      maximumFractionDigits: withCents ? 2 : 0,
    }).format(num);
  } catch {
    return `${currencySymbol(info.code)} ${num.toFixed(withCents ? 2 : 0)}`;
  }
}

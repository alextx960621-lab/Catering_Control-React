// Funciones puras sobre fechas y planes, usadas por el portal de cliente.
// No dependen de React ni de Supabase: son solo cálculos, fáciles de
// testear o de reusar después en el Panel.

export const DEFAULT_MENU_ITEMS = [
  ['shots', 'Shots'],
  ['proteins', 'Proteínas'],
  ['juices', 'Jugos'],
  ['breakfast', 'Desayuno'],
  ['snack1', 'Merienda 1'],
  ['lunch', 'Almuerzo'],
  ['snack2', 'Merienda 2'],
  ['dinner', 'Cena'],
];

// Number(v) || 0 : convierte a número, y si es NaN/undefined devuelve 0.
export const n = (v) => Number(v) || 0;

// "2026-09-03" -> "03/09/2026"
export const fmt = (d) => (d ? d.split('-').reverse().join('/') : '');

export function workDate(data) {
  return data.currentDate || new Date().toISOString().slice(0, 10);
}

export function dayInfo(data, date) {
  return data.days?.[date] || { laborable: true };
}

export function addDays(date, count) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + count);
  return d.toISOString().slice(0, 10);
}

// Avanza día por día hasta encontrar el próximo día laborable (salta
// domingos, feriados, etc. según el calendario cargado en `data.days`).
export function nextWorkDay(data, date) {
  let result = addDays(date, 1);
  let guard = 0;
  while (!dayInfo(data, result).laborable && guard++ < 370) {
    result = addDays(result, 1);
  }
  return result;
}

export function planFor(data, client) {
  return data.plans?.find((p) => p.id === client.planId);
}

// Calcula el estado actual del cliente para la fecha dada: no es un campo
// guardado, se deriva de pausas/reactivaciones/días consumidos cada vez.
export function stateFor(data, client, date) {
  if (!dayInfo(data, date).laborable) return 'No laborable';
  if (client.returnDate && date >= client.returnDate) return 'Activo';
  if (client.pauseStart && date >= client.pauseStart && (!client.returnDate || date < client.returnDate)) return 'Pausado';
  if (client.pauseDates?.includes(date)) return 'Pausado';
  if (client.startDate && client.startDate > date) return 'Programado';
  if (n(client.paidDays) && n(client.consumedDays) >= n(client.paidDays)) return 'Retorno pendiente';
  return client.status || 'Activo';
}

export function statusClass(state) {
  return state === 'Activo' ? 'success' : state === 'Pausado' ? 'warning text-dark' : 'secondary';
}

export function whatsappNumber(branding, appConfig) {
  return branding.whatsappNumber || appConfig.whatsappNumber;
}

export function waLink(branding, appConfig, text) {
  const num = whatsappNumber(branding, appConfig);
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '#';
}

export function renewalWarningDays(branding) {
  return Number.isFinite(branding.renewalWarningDays) ? branding.renewalWarningDays : 3;
}

export function menuItemsList(branding) {
  return branding.menuItems && branding.menuItems.length ? branding.menuItems : DEFAULT_MENU_ITEMS;
}

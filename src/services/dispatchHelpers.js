import { n } from './planHelpers';

// Funciones puras de "Día de trabajo" (dispatch). Resuelven, para una
// fecha dada, qué dirección/ruta/driver/orden/notas le corresponden a un
// cliente — un cliente puede tener varias direcciones guardadas, una
// activa por defecto, un horario semanal (qué dirección le toca según el
// día), y "excepciones" puntuales para un día específico. La prioridad,
// de mayor a menor, es: excepción del día > horario semanal > dirección
// activa.

export function weekdayOf(date) {
  return new Date(date + 'T00:00:00').getDay();
}

export function scheduleEntryFor(client, date) {
  const wd = weekdayOf(date);
  return (client.schedule || []).find((e) => (e.days || []).includes(wd)) || null;
}

export function activeAddress(client) {
  return client.addresses?.find((a) => a.id === client.activeAddressId) || client.addresses?.[0] || null;
}

function overrideAddressFor(client, date) {
  const ov = (client.addressOverrides || []).find((o) => o.date === date);
  return ov ? client.addresses?.find((a) => a.id === ov.addressId) || null : null;
}

function scheduleAddressFor(client, date) {
  const entry = scheduleEntryFor(client, date);
  return entry?.addressId ? client.addresses?.find((a) => a.id === entry.addressId) || null : null;
}

export function resolvedAddress(client, date) {
  return overrideAddressFor(client, date) || scheduleAddressFor(client, date) || activeAddress(client);
}

export function effectiveRouteId(client, date) {
  return resolvedAddress(client, date)?.routeId || client.routeId;
}

export function effectiveAddress(client, date) {
  return resolvedAddress(client, date)?.address || client.address1 || '';
}

export function effectiveOrder(client, date) {
  const a = resolvedAddress(client, date);
  return a && a.order !== undefined && a.order !== '' ? a.order : (client.order ?? '');
}

export function effectiveNotes(client, date) {
  const a = resolvedAddress(client, date);
  return a && a.notes ? a.notes : client.notes || '';
}

// Extrae lat/lng de un link de Google Maps o de un texto "lat,lng" suelto.
export function extractLatLngFromMapsField(text) {
  if (!text) return null;
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

// Convierte lo que sea que haya en el campo "maps" (una URL completa, una
// coordenada suelta, o una dirección escrita a mano) en un link que
// siempre abre Google Maps correctamente.
export function googleMapsDirectLink(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const coords = extractLatLngFromMapsField(v);
  if (coords) return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}

export function effectiveMaps(client, date) {
  const addr = resolvedAddress(client, date);
  if (addr) {
    const coords = String(addr.coords || '').trim();
    const m = coords.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return `https://www.google.com/maps/dir/?api=1&destination=${m[1]},${m[2]}`;
    if (addr.maps) return googleMapsDirectLink(addr.maps);
  }
  return client.maps ? googleMapsDirectLink(client.maps) : '';
}

// Guarda el número de orden respetando la misma prioridad que
// effectiveOrder: si hay una dirección para ese día, se guarda ahí.
export function writeOrderValue(client, date, val) {
  const addr = resolvedAddress(client, date);
  if (addr) addr.order = val;
  else client.order = val;
  return client;
}

// Cuando alguien elige "correr los siguientes un número" ante un
// conflicto de orden: a todos los clientes activos de esa ruta con un
// número igual o mayor al que se acaba de usar, les suma 1 -- para no
// tener que reacomodar el resto a mano.
export function shiftOrdersFrom(clients, routeId, date, fromValue, excludeId, dayInfo) {
  const updated = [];
  clients
    .filter((x) => x.id !== excludeId && dispatchStatus(x, date, dayInfo, false) === 'Activo' && effectiveRouteId(x, date) === routeId)
    .forEach((x) => {
      const val = Number(effectiveOrder(x, date));
      if (!isNaN(val) && val >= fromValue) {
        writeOrderValue(x, date, String(val + 1));
        updated.push(x);
      }
    });
  return updated;
}

export function driverRouteIds(driver) {
  return driver ? [driver.routeId, ...(driver.extraRouteIds || [])].filter(Boolean) : [];
}

export function driverForRoute(drivers, routeId) {
  return drivers.find((d) => d.routeId === routeId || (d.extraRouteIds || []).includes(routeId));
}

export function effectiveDriverId(client, date, drivers) {
  const addr = resolvedAddress(client, date);
  if (addr?.routeId) return driverForRoute(drivers, addr.routeId)?.id || addr.driverId || '';
  return client.driverId;
}

// Estado del pedido para ESE día. `premiumReturnDateLocked` refleja si la
// reactivación automática por fecha de retorno es una función Premium que
// esta empresa no tiene activada (en ese caso se ignora returnDate).
export function dispatchStatus(client, date, dayInfo, premiumReturnDateLocked) {
  if (!dayInfo?.laborable) return 'No laborable';
  if (client.returnDate && date >= client.returnDate && !premiumReturnDateLocked) return 'Activo';
  if (client.pauseStart && date >= client.pauseStart && (!client.returnDate || date < client.returnDate)) return 'Pausado';
  if (client.pauseDates?.includes(date)) return 'Pausado';
  if (client.startDate && client.startDate > date) return 'Programado';
  if (n(client.paidDays) && n(client.consumedDays) >= n(client.paidDays)) return 'Retorno pendiente';
  // Cliente con horario semanal configurado, en un día que no cae en
  // ninguna de sus franjas (ej: solo pide lunes/miércoles/viernes, y hoy
  // es martes) — no es lo mismo que "Pausado": simplemente hoy no le
  // toca, sin que nadie tenga que pausarlo/reactivarlo a mano cada vez.
  if (client.schedule?.length && !scheduleEntryFor(client, date)) return 'Fuera de horario';
  return client.status || 'Activo';
}

export function statusBadgeClass(s) {
  return { Activo: 'active', Pausado: 'paused', 'Retorno pendiente': 'pending', Programado: 'pending', 'No laborable': 'off', 'Fuera de horario': 'off' }[s] || 'done';
}

// Un driver puede tener asignada más de una ruta (ej. cubriendo un
// reemplazo). Se lee del registro del driver, no solo de la sesión, para
// que un cambio hecho por un admin se refleje sin volver a iniciar sesión.
export function myRouteIds(user, drivers) {
  if (user?.role !== 'driver') return [];
  const found = driverRouteIds(drivers.find((d) => d.id === user.driverId));
  return found.length ? found : [user.routeId].filter(Boolean);
}

// La fecha más reciente que ya quedó "cerrada" (procesada). Se usa para
// no dejar saltar la fecha de trabajo dejando días sin cerrar en el
// medio, y para el cierre automático retroactivo de días salteados.
export function lastProcessedDate(days) {
  const dates = Object.keys(days).filter((d) => days[d]?.processed);
  return dates.length ? dates.sort().at(-1) : null;
}

// Link de WhatsApp para escribirle a un cliente (a diferencia de
// planHelpers.waLink, que arma el link hacia el número de LA EMPRESA). Si
// el número tiene 8 dígitos o menos se asume Bolivia y se le antepone 591.
export function clientWaLink(phone, text = '') {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length <= 8 ? '591' + digits : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function canEditDispatchField(client, field, date, { role, isDriver, myRoutes, realToday, canEditDispatch }) {
  if (field === 'returnDate' && client.status !== 'Programado') return false;
  if (canEditDispatch) return true;
  // Los drivers solo editan mientras ven el día actual EN VIVO. Si están
  // mirando un día pasado, no se puede: de lo contrario "corregir algo"
  // de un día ya cerrado terminaría modificando el dato actual del
  // cliente sin que el driver se dé cuenta.
  if (isDriver) return date === realToday && ['maps', 'phone1', 'phone2', 'order'].includes(field) && myRoutes.includes(effectiveRouteId(client, date));
  return false;
}

// Ajustes que se le aplican a lo que viene de la base antes de usarlo (Panel y cierre automático)
import { DEFAULT_MENU_ITEMS } from './planHelpers.js';

export function normalizeClient(c) {
  c.items ||= {};
  c.order ??= '';
  c.status ||= 'Activo';
  c.paidDays ??= 0;
  c.consumedDays ??= 0;
  if (c.status !== 'Programado' && c.returnDate) c.returnDate = '';
  if (!Array.isArray(c.addresses) || !c.addresses.length) {
    c.addresses = c.address1
      ? [{ id: 'a_' + c.id, address: c.address1, maps: c.maps || '', routeId: c.routeId || '', driverId: c.driverId || '', order: c.order ?? '' }]
      : [];
    c.activeAddressId = c.addresses[0]?.id || '';
  }
  c.addressOverrides ||= [];
  c.schedule ||= [];
  return c;
}

export function normalizeSettings(settings) {
  const s = settings || {};
  s.theme ||= 'light';
  s.menuItems = Array.isArray(s.menuItems) && s.menuItems.length ? s.menuItems : DEFAULT_MENU_ITEMS.map(([key, label]) => ({ key, label }));
  s.customRoles = Array.isArray(s.customRoles) ? s.customRoles : [];
  s.plan = s.plan === 'premium' ? 'premium' : 'basico';
  s.premiumLockedPages ||= {};
  s.hiddenColumns ||= [];
  s.dispatchColumnOrder ||= [];
  s.premiumWhatsapp ||= '';
  s.paymentQrUrl ||= '';
  const cutoff = Number(s.dayCutoffHour);
  s.dayCutoffHour = s.dayCutoffHour !== '' && s.dayCutoffHour != null && Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 12 ? cutoff : 4;
  return s;
}

// Ruta por defecto cuando no hay ninguna guardada
export const openRoutes = () => [{ id: 'r_open', name: 'Ruta abierta', description: 'Drivers disponibles sin ruta de trabajo', open: true, order: 0 }];

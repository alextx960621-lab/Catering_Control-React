// Lógica pura de "procesar un día". La usan el botón del Panel y la Edge Function cerrar-dia-automatico.
import { n } from './planHelpers.js';
import { dispatchStatus, effectiveRouteId, effectiveAddress, effectiveOrder, effectiveNotes, effectiveDriverId } from './dispatchHelpers.js';

const planOf = (plans, id) => plans.find((p) => p.id === id);
const routeNameOf = (routes, id) => routes.find((r) => r.id === id)?.name || 'Sin ruta';
const driverNameOf = (drivers, id) => {
  const d = drivers.find((x) => x.id === id);
  return d ? `${d.firstName} ${d.lastName}` : 'Sin asignar';
};
const menuItemsList = (settings) => (settings.menuItems || []).map((m) => [m.key, m.label]);

function itemValueOf(client, key, plans) {
  const ownItems = client.items && Object.keys(client.items).length ? client.items : planOf(plans, client.planId)?.items || {};
  return n(ownItems[key]);
}

// "Foto" de cómo quedó el día (se guarda en db_dispatch_snapshots)
export function buildDaySnapshot({ date, dayInfo, clients, clientIds, drivers, routes, plans, settings }) {
  const activeClients = clientIds ? clients.filter((c) => clientIds.includes(c.id)) : clients.filter((c) => dispatchStatus(c, date, dayInfo) === 'Activo');
  const menuCols = menuItemsList(settings);
  const rows = activeClients.map((c) => {
    const rid = effectiveRouteId(c, date);
    const items = {};
    menuCols.forEach(([key, label]) => { items[label] = itemValueOf(c, key, plans); });
    return {
      orden: n(effectiveOrder(c, date)), nombre: c.name, ruta: rid ? routeNameOf(routes, rid) : 'Sin ruta',
      driver: driverNameOf(drivers, effectiveDriverId(c, date, drivers)), plan: planOf(plans, c.planId)?.name || 'Sin plan',
      direccion: effectiveAddress(c, date) || '', telefono1: c.phone1 || '', telefono2: c.phone2 || '',
      bolsas: n(c.bags), items, dietaEspecial: c.specialDiet || '', observaciones: effectiveNotes(c, date) || '',
      carreras: n(c.career || 1), estado: c.status,
      serviciosRestantes: n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : 0,
    };
  });
  rows.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.orden - b.orden);
  return { fecha: date, empresa: settings.companyName, totalClientes: rows.length, clientes: rows };
}

// Qué cambia al procesar `date`. No guarda nada: quien llama aplica el resultado.
// `deliveryRows` (estado de las entregas del día) decide quién PAGA el día: un pedido "no
// entregado" por culpa del personal no consume servicio ni descuento de inventario, pero el
// chofer igual cobra la carrera porque hizo el viaje. Sin clasificar (marcas antiguas) se cobra.
export function planDayClose({ date, days, clients, drivers, routes, plans, settings, inventory, deliveryRows }) {
  const dayInfo = days[date] || { laborable: true };
  const base = { date, dayInfo, clients, drivers, routes, plans, settings };

  if (!dayInfo.laborable) {
    return {
      nonWorking: true, processedIds: [], chargedIds: [], updatedClients: [], newInventory: null,
      newDays: { ...days, [date]: { ...dayInfo, processed: true, processedClientIds: [], chargedClientIds: [], payrollSnapshot: [] } },
      snapshot: buildDaySnapshot({ ...base, clientIds: [] }),
    };
  }

  const marksById = Object.fromEntries((deliveryRows || []).map((r) => [r.clientId, r]));
  const isStaffFault = (c) => {
    const m = marksById[c.id];
    return m?.status === 'no_entregado' && m?.fault === 'personal';
  };

  const activeClients = clients.filter((c) => dispatchStatus(c, date, dayInfo) === 'Activo');
  const processedIds = activeClients.map((c) => c.id);
  const chargedClients = activeClients.filter((c) => !isStaffFault(c));
  const chargedIds = chargedClients.map((c) => c.id);
  // Congela las carreras de cada cliente (y su driver) tal como están en este momento
  const payrollSnapshot = activeClients.map((c) => ({ id: c.id, career: n(c.career || 1), driverId: effectiveDriverId(c, date, drivers) }));
  const updatedClients = chargedClients.map((c) => ({ ...c, consumedDays: n(c.consumedDays) + 1 }));
  const newDays = { ...days, [date]: { ...dayInfo, processed: true, processedClientIds: processedIds, chargedClientIds: chargedIds, payrollSnapshot } };

  // Descuenta del inventario de cocina lo entregado, según los vínculos artículo → inventario
  let newInventory = null;
  if (inventory?.links?.length) {
    const labelOf = (key) => menuItemsList(settings).find(([k]) => k === key)?.[1] || key;
    const newMovements = [];
    const updatedItems = inventory.items.map((item) => {
      const links = inventory.links.filter((l) => l.inventoryId === item.id);
      if (!links.length) return item;
      let usedTotal = 0;
      links.forEach((link) => {
        const delivered = chargedClients.reduce((sum, c) => sum + itemValueOf(c, link.clientItemKey, plans), 0);
        const used = delivered * n(link.quantity);
        if (!used) return;
        usedTotal += used;
        newMovements.push({ id: `mov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, inventoryId: item.id, type: 'delivery', quantity: -used, note: `Descuento automático: ${delivered} ${labelOf(link.clientItemKey)}` });
      });
      return usedTotal ? { ...item, stock: n(item.stock) - usedTotal } : item;
    });
    if (newMovements.length) newInventory = { ...inventory, items: updatedItems, movements: [...newMovements, ...inventory.movements] };
  }

  return { nonWorking: false, processedIds, chargedIds, updatedClients, newDays, newInventory, snapshot: buildDaySnapshot({ ...base, clientIds: processedIds }) };
}

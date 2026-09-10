import { useEffect, useMemo, useRef, useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbGetSnapshot, dbUpsertSnapshot } from '../../../services/db';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n, addDays } from '../../../services/planHelpers';
import { getColumnPrefs, saveHiddenColumns, saveColumnOrder, saveColumnWidths, arrangeColumns } from '../../../services/columnPrefs';
import ColumnsModal from '../ColumnsModal';
import { getDriverViewDate, setDriverViewDate } from '../../../services/driverViewDate';
import {
  effectiveRouteId, effectiveAddress, effectiveOrder, effectiveNotes, effectiveMaps,
  effectiveDriverId, resolvedAddress, writeOrderValue, shiftOrdersFrom, dispatchStatus, statusBadgeClass,
  myRouteIds, canEditDispatchField, lastProcessedDate,
} from '../../../services/dispatchHelpers';
import { canManage, isPagePremiumLocked } from '../../../services/panelAuth';
import './DispatchPage.css';

export default function DispatchPage({ user }) {
  const { loading, clients, routes, drivers, plans, days, currentDate, settings, serverToday, setCurrentDate, saveDays, saveClients, showNotice, inventory, saveInventory } = useOperations();

  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [forceLive, setForceLive] = useState(false);
  const [historial, setHistorial] = useState(undefined); // undefined=no consultado, null=no hay, objeto=snapshot
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [colPrefs, setColPrefs] = useState(() => getColumnPrefs(user?.id, 'dispatch'));
  const [orderConflict, setOrderConflict] = useState(null);
  const [, setRerenderTick] = useState(0);
  const forceRerender = () => setRerenderTick((v) => v + 1);

  const isDriver = user?.role === 'driver';
  const canEdit = canManage(user?.role, settings.customRoles, 'dispatch');
  const dietsLocked = isPagePremiumLocked('specialDietPrint', settings.premiumLockedPages) && settings.plan !== 'premium';
  const date = isDriver ? (getDriverViewDate(user.id, serverToday) || currentDate) : currentDate;
  const dayInfo = days[date] || { laborable: true };
  const myRoutes = myRouteIds(user, drivers);
  const isPastProcessedDay = dayInfo.processed && date !== serverToday && !forceLive;

  useEffect(() => {
    setForceLive(false);
    setHistorial(undefined);
  }, [date]);

  useEffect(() => {
    if (!isPastProcessedDay || historial !== undefined) return;
    setLoadingHistorial(true);
    dbGetSnapshot(date).then((snap) => {
      setHistorial(snap || null);
      setLoadingHistorial(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPastProcessedDay, date]);

  function planOf(id) {
    return plans.find((p) => p.id === id);
  }
  function routeName(id) {
    return routes.find((r) => r.id === id)?.name || 'Sin ruta';
  }
  function driverNameOf(id) {
    const d = drivers.find((x) => x.id === id);
    return d ? `${d.firstName} ${d.lastName}` : 'Sin asignar';
  }
  function menuItemsList() {
    return (settings.menuItems || []).map((m) => [m.key, m.label]);
  }
  function itemValue(c, key) {
    const ownItems = c.items && Object.keys(c.items).length ? c.items : planOf(c.planId)?.items || {};
    return n(ownItems[key]);
  }

  const routeScoped = isDriver ? clients.filter((c) => myRoutes.includes(effectiveRouteId(c, date))) : clients;

  const q = search.toLowerCase();
  const rf = isDriver ? '' : routeFilter;
  const list = routeScoped
    .filter((c) => (!rf || effectiveRouteId(c, date) === rf) && (!q || [c.name, c.carnet, effectiveAddress(c, date), c.phone1, c.phone2, c.specialDiet, effectiveNotes(c, date)].join(' ').toLowerCase().includes(q)))
    .filter((c) => statusFilter === 'all' || dispatchStatus(c, date, dayInfo, false) === statusFilter)
    .sort((a, b) => {
      const oa = Number(effectiveOrder(a, date));
      const ob = Number(effectiveOrder(b, date));
      if (isNaN(oa) && isNaN(ob)) return 0;
      if (isNaN(oa)) return 1;
      if (isNaN(ob)) return -1;
      return oa - ob;
    });

  const activeOrders = useMemo(() => routeScoped.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo'), [routeScoped, date, dayInfo]);
  const filteredActive = list.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo');

  function updateClient(id, mutate) {
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    const updated = { ...client };
    mutate(updated);
    saveClients([updated]);
  }

  function handleFieldBlur(client, field, value, inputEl) {
    if (!canEditDispatchField(client, field, date, { role: user?.role, isDriver, myRoutes, realToday: serverToday, canEditDispatch: canEdit })) return;

    if (field === 'order') {
      const trimmed = value.trim();
      if (trimmed !== '') {
        const routeId = effectiveRouteId(client, date);
        const conflicts = clients.filter((x) => x.id !== client.id && dispatchStatus(x, date, dayInfo, false) === 'Activo' && effectiveRouteId(x, date) === routeId && String(effectiveOrder(x, date)) === trimmed);
        if (conflicts.length) {
          setOrderConflict({ client, value: trimmed, routeId, inputEl, prevValue: String(effectiveOrder(client, date) ?? '') });
          return;
        }
      }
      updateClient(client.id, (c) => writeOrderValue(c, date, trimmed));
      return;
    }

    updateClient(client.id, (c) => {
      if (field === 'notes' || field === 'maps') {
        const addr = resolvedAddress(c, date);
        if (addr) addr[field] = value;
        else c[field] = value;
      } else if (field === 'returnDate') {
        c.returnDate = value;
        if (value) {
          c.status = 'Programado';
          c.pauseStart ||= date;
        } else if (c.status === 'Programado') {
          c.status = 'Pausado';
        }
      } else {
        c[field] = value;
      }
    });
  }

  function resolveOrderConflict(choice) {
    const { client, value, routeId, inputEl, prevValue } = orderConflict;
    if (choice === 'cancel') {
      if (inputEl) inputEl.value = prevValue;
      setOrderConflict(null);
      return;
    }
    const client2 = { ...client };
    writeOrderValue(client2, date, value);
    const toSave = [client2];
    if (choice === 'shift') toSave.push(...shiftOrdersFrom(clients, routeId, date, Number(value), client.id, dayInfo));
    saveClients(toSave);
    setOrderConflict(null);
  }

  function toggleDayPause(client) {
    if (!canEdit) return;
    const pausedToday = client.pauseDates?.includes(date);
    updateClient(client.id, (c) => {
      c.pauseDates = pausedToday ? (c.pauseDates || []).filter((d) => d !== date) : [...(c.pauseDates || []), date];
    });
  }

  function handleWorkDateChange(newDate) {
    if (isDriver) {
      setDriverViewDate(user.id, newDate, serverToday);
      setForceLive(false);
      forceRerender();
      return;
    }
    if (!canEdit) return;
    const last = lastProcessedDate(days);
    const maxAllowed = last ? addDays(last, 1) : null;
    if (maxAllowed && newDate > maxAllowed) {
      showNotice(`Primero hay que procesar ${last.split('-').reverse().join('/')} — no se puede saltar a ${newDate.split('-').reverse().join('/')} dejando días sin cerrar entre medio.`, true);
      return;
    }
    setForceLive(false);
    setCurrentDate(newDate);
  }

  function resetDriverViewToToday() {
    setDriverViewDate(user.id, '', serverToday);
    setForceLive(false);
    forceRerender();
  }

  function toggleDayLaborable(laborable) {
    if (!canEdit) return;
    saveDays({ ...days, [date]: { ...dayInfo, laborable } });
  }

  // Guarda una "foto" de cómo quedó el día: sirve para poder mirar ese
  // día más adelante tal como estaba, aunque los clientes hayan cambiado
  // de dirección/plan/ruta después.
  function buildSnapshotPayload(clientIds) {
    const activeClients = clientIds ? clients.filter((c) => clientIds.includes(c.id)) : clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo');
    const menuCols = menuItemsList();
    const rows = activeClients.map((c) => {
      const rid = effectiveRouteId(c, date);
      const items = {};
      menuCols.forEach(([key, label]) => { items[label] = itemValue(c, key); });
      return {
        orden: n(effectiveOrder(c, date)), nombre: c.name, ruta: rid ? routeName(rid) : 'Sin ruta',
        driver: driverNameOf(effectiveDriverId(c, date, drivers)), plan: planOf(c.planId)?.name || 'Sin plan',
        direccion: effectiveAddress(c, date) || '', telefono1: c.phone1 || '', telefono2: c.phone2 || '',
        bolsas: n(c.bags), items, dietaEspecial: c.specialDiet || '', observaciones: effectiveNotes(c, date) || '',
        carreras: n(c.career || 1), estado: c.status,
        serviciosRestantes: n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : 0,
      };
    });
    rows.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.orden - b.orden);
    return { fecha: date, empresa: settings.companyName, totalClientes: rows.length, clientes: rows };
  }

  function downloadJsonBackup(payload, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function processDay() {
    if (!canEdit) { showNotice('No tienes permiso para procesar el día.', true); return; }
    if (dayInfo.processed) { showNotice('Este día ya fue procesado.', true); return; }

    if (!dayInfo.laborable) {
      if (!confirm(`¿Cerrar el día ${date.split('-').reverse().join('/')} como no laborable? No se procesan pedidos.`)) return;
      const newDays = { ...days, [date]: { ...dayInfo, processed: true, processedClientIds: [] } };
      saveDays(newDays);
      await dbUpsertSnapshot(date, buildSnapshotPayload([]));
      showNotice('Día no laborable cerrado.');
      dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Día cerrado (no laborable)', entity_type: 'day', entity_label: date, entity_id: date, details: {} });
      setCurrentDate(addDays(date, 1));
      return;
    }

    if (!confirm(`¿Procesar el día ${date.split('-').reverse().join('/')}?`)) return;
    const activeClients = clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo');
    const processedIds = activeClients.map((c) => c.id);
    saveClients(activeClients.map((c) => ({ ...c, consumedDays: n(c.consumedDays) + 1 })));
    const newDays = { ...days, [date]: { ...dayInfo, processed: true, processedClientIds: processedIds } };
    saveDays(newDays);

    // Descuenta del inventario de cocina lo que corresponda a los
    // artículos entregados hoy, según los vínculos de consumo definidos
    // en Inventario.
    if (inventory.links.length) {
      const menuLabelOf = (key) => menuItemsList().find(([k]) => k === key)?.[1] || key;
      const newMovements = [];
      const updatedItems = inventory.items.map((item) => {
        const links = inventory.links.filter((l) => l.inventoryId === item.id);
        if (!links.length) return item;
        let usedTotal = 0;
        links.forEach((link) => {
          const delivered = activeClients.reduce((sum, c) => sum + itemValue(c, link.clientItemKey), 0);
          const used = delivered * n(link.quantity);
          if (!used) return;
          usedTotal += used;
          newMovements.push({ id: `mov_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, inventoryId: item.id, type: 'delivery', quantity: -used, note: `Descuento automático: ${delivered} ${menuLabelOf(link.clientItemKey)}` });
        });
        return usedTotal ? { ...item, stock: n(item.stock) - usedTotal } : item;
      });
      if (newMovements.length) saveInventory({ ...inventory, items: updatedItems, movements: [...newMovements, ...inventory.movements] });
    }
    const payload = buildSnapshotPayload(processedIds);
    await dbUpsertSnapshot(date, payload);
    showNotice('Día procesado. Descargando constancia (Excel y JSON)…');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Día procesado', entity_type: 'day', entity_label: date, entity_id: date, details: { clientesAtendidos: processedIds.length } });
    downloadJsonBackup(payload, `dia-procesado-${date}.json`);
    exportProcessedDaySnapshot(payload).catch(() => {});
    setCurrentDate(addDays(date, 1));
  }

  async function exportProcessedDaySnapshot(payload) {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet('Día procesado', { views: [{ state: 'frozen', ySplit: 1 }] });
    const itemLabels = [...new Set(payload.clientes.flatMap((c) => Object.keys(c.items || {})))];
    ws.columns = [
      { header: 'Orden', key: 'orden', width: 8 }, { header: 'Cliente', key: 'nombre', width: 26 },
      { header: 'Ruta', key: 'ruta', width: 16 }, { header: 'Driver', key: 'driver', width: 20 },
      { header: 'Plan', key: 'plan', width: 16 }, ...itemLabels.map((l) => ({ header: l, key: l, width: 10 })),
      { header: 'Dirección', key: 'direccion', width: 30 }, { header: 'Teléfono 1', key: 'telefono1', width: 14 },
      { header: 'Dieta especial', key: 'dietaEspecial', width: 22 }, { header: 'Observaciones', key: 'observaciones', width: 26 },
      { header: 'Carreras', key: 'carreras', width: 10 }, { header: 'Bolsas', key: 'bolsas', width: 10 },
    ];
    styleHeader(ws.getRow(1), 'FF0D6EFD');
    payload.clientes.forEach((c, i) => {
      const row = ws.addRow({ ...c, ...Object.fromEntries(itemLabels.map((l) => [l, n(c.items?.[l])])) });
      styleRow(row, i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF');
    });
    await downloadWorkbook(wb, `dia-procesado-${payload.fecha}.xlsx`);
  }

  async function unprocessDay() {
    if (!canEdit) { showNotice('No tienes permiso para desprocesar el día.', true); return; }
    if (!dayInfo.processed) { showNotice('Este día no está procesado.', true); return; }
    if (!confirm(`¿Desprocesar el día ${date.split('-').reverse().join('/')}? Se revertirá el conteo de días consumidos.`)) return;
    const ids = dayInfo.processedClientIds || clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo').map((c) => c.id);
    saveClients(clients.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, consumedDays: Math.max(0, n(c.consumedDays) - 1) })));
    saveDays({ ...days, [date]: { ...dayInfo, processed: false, processedClientIds: [] } });
    // Repone el inventario descontado automáticamente al procesar (quantity
    // ya quedó guardado en negativo, así que restarlo lo repone).
    const kept = [];
    const updatedItems = [...inventory.items];
    inventory.movements.forEach((m) => {
      if (m.type === 'delivery' && m.date === date) {
        const idx = updatedItems.findIndex((i) => i.id === m.inventoryId);
        if (idx >= 0) updatedItems[idx] = { ...updatedItems[idx], stock: n(updatedItems[idx].stock) - n(m.quantity) };
      } else kept.push(m);
    });
    if (kept.length !== inventory.movements.length) saveInventory({ ...inventory, items: updatedItems, movements: kept });
    showNotice('Día desprocesado. Los días consumidos fueron restaurados.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Día desprocesado', entity_type: 'day', entity_label: date, entity_id: date, details: {} });
  }

  const numericKeys = new Set([...menuItemsList().map(([key]) => key), 'career', 'bags', 'remaining']);

  const THIN = { style: 'thin', color: { argb: 'FFD9DEE7' } };
  function styleHeader(row, color) {
    row.height = 22;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    });
  }
  function styleRow(row, fillColor) {
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    });
  }
  async function downloadWorkbook(wb, filename) {
    const buffer = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function exportDiets() {
    if (dietsLocked) { showNotice('Exportar dietas especiales es una función Premium. Actívala en Configuración.', true); return; }
    const activeClients = clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo');
    if (!activeClients.length) { showNotice('No hay clientes activos para exportar hoy.', true); return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet('Dietas especiales', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Ruta', key: 'ruta', width: 16 }, { header: 'Cliente', key: 'cliente', width: 26 },
      { header: 'Plan', key: 'plan', width: 18 }, { header: 'Artículos incluidos', key: 'items', width: 46 },
      { header: 'Observaciones / dieta especial', key: 'notes', width: 38 },
    ];
    styleHeader(ws.getRow(1), 'FF0D6EFD');
    const groupsById = new Map();
    activeClients.forEach((c) => {
      const rid = effectiveRouteId(c, date) || '__none__';
      if (!groupsById.has(rid)) groupsById.set(rid, { name: rid === '__none__' ? 'Sin ruta' : routeName(rid), clients: [] });
      groupsById.get(rid).clients.push(c);
    });
    const orderedIds = [...routes.map((r) => r.id), '__none__'].filter((id) => groupsById.has(id));
    const groups = orderedIds.map((id) => groupsById.get(id));
    groups.forEach((g) => g.clients.sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999)));
    let i = 0;
    groups.forEach((g) => {
      g.clients.forEach((c) => {
        const pitems = c.items && Object.keys(c.items).length ? c.items : planOf(c.planId)?.items || {};
        const row = ws.addRow({ ruta: g.name, cliente: c.name, plan: planOf(c.planId)?.name || 'Sin plan', items: menuItemsList().filter(([k]) => n(pitems[k]) > 0).map(([k, l]) => `${l}: ${n(pitems[k])}`).join(' | ') || '—', notes: [effectiveNotes(c, date), c.specialDiet].filter(Boolean).join(' — ') || '—' });
        styleRow(row, i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF');
        i++;
      });
      const totalRow = ws.addRow({ ruta: '', cliente: `Total ${g.name}: ${g.clients.length} clientes`, plan: '', items: '', notes: '' });
      totalRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E7EE' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    });
    const grand = ws.addRow({ ruta: '', cliente: `TOTAL GENERAL: ${activeClients.length} clientes`, plan: '', items: '', notes: '' });
    grand.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    await downloadWorkbook(wb, `dietas-especiales-${date}.xlsx`);
    showNotice('Archivo Excel generado.');
  }

  async function exportRouteOrder() {
    const routeIds = isDriver ? myRoutes : [routeFilter].filter(Boolean);
    if (!routeIds.length) { showNotice('Selecciona una ruta en el filtro "Ruta" antes de exportar el orden de ruta.', true); return; }
    let activeClients = clients.filter((c) => routeIds.includes(effectiveRouteId(c, date)) && dispatchStatus(c, date, dayInfo, false) === 'Activo');
    activeClients = [...activeClients].sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999));
    if (!activeClients.length) { showNotice('No hay clientes activos en esa ruta para exportar hoy.', true); return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet('Orden de ruta', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Orden', key: 'order', width: 8 }, { header: 'Cliente', key: 'cliente', width: 26 },
      { header: 'Dirección', key: 'address', width: 34 }, { header: 'Teléfono', key: 'phone', width: 16 },
      { header: 'Google Maps', key: 'maps', width: 16 }, { header: 'Bolsas', key: 'bags', width: 10 },
      { header: 'Carreras', key: 'career', width: 12 }, { header: 'Observaciones', key: 'notes', width: 30 },
    ];
    styleHeader(ws.getRow(1), 'FF198754');
    activeClients.forEach((c, i) => {
      const mapsLink = effectiveMaps(c, date);
      const row = ws.addRow({ order: n(effectiveOrder(c, date)) || '', cliente: c.name, address: effectiveAddress(c, date) || '—', phone: [c.phone1, c.phone2].filter(Boolean).join(' / ') || '—', maps: mapsLink ? 'Abrir mapa' : '—', bags: n(c.bags), career: n(c.career || 1), notes: effectiveNotes(c, date) || '—' });
      if (mapsLink) row.getCell('maps').value = { text: 'Abrir mapa', hyperlink: mapsLink };
      styleRow(row, i % 2 === 0 ? 'FFF0FBF4' : 'FFFFFFFF');
      row.getCell('maps').font = { color: { argb: 'FF0D6EFD' }, underline: true };
    });
    const total = ws.addRow({ order: '', cliente: `Total: ${activeClients.length} clientes`, address: '', phone: '', maps: '', bags: activeClients.reduce((a, c) => a + n(c.bags), 0), career: activeClients.reduce((a, c) => a + n(c.career || 1), 0), notes: '' });
    total.eachCell((cell) => { cell.font = { bold: true }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    await downloadWorkbook(wb, `orden-de-ruta-${date}.xlsx`);
    showNotice('Archivo Excel generado.');
  }

  const allColumns = [
    { key: 'order', label: 'Orden', render: (c) => (
      <input className="day-edit" type="number" defaultValue={effectiveOrder(c, date)}
        disabled={!canEditDispatchField(c, 'order', date, { role: user?.role, isDriver, myRoutes, realToday: serverToday, canEditDispatch: canEdit })}
        onBlur={(e) => handleFieldBlur(c, 'order', e.target.value, e.target)} />
    ) },
    { key: 'name', label: 'Cliente', render: (c) => (<><b>{c.name}</b><br /><small className="muted">{c.carnet || 'Sin carnet'}</small></>) },
    { key: 'route', label: 'Ruta', render: (c) => routeName(effectiveRouteId(c, date)) },
    { key: 'driver', label: 'Driver', render: (c) => driverNameOf(effectiveDriverId(c, date, drivers)) },
    { key: 'plan', label: 'Plan', render: (c) => planOf(c.planId)?.name || 'Sin plan' },
    ...menuItemsList().map(([key, label]) => ({ key, label, render: (c) => itemValue(c, key) })),
    { key: 'address1', label: 'Dirección', render: (c) => effectiveAddress(c, date) || '—' },
    { key: 'maps', label: 'Google Maps', render: (c) => {
      const link = effectiveMaps(c, date);
      return (
        <div className="maps-cell">
          <input className="day-edit" defaultValue={resolvedAddress(c, date)?.maps || c.maps || ''} onBlur={(e) => handleFieldBlur(c, 'maps', e.target.value)} />
          {link && <a href={link} target="_blank" rel="noopener" className="maps-cell-link">Abrir mapa</a>}
        </div>
      );
    } },
    { key: 'phone1', label: 'Teléfono 1', render: (c) => (
      <input className="day-edit" defaultValue={c.phone1 || ''} onBlur={(e) => handleFieldBlur(c, 'phone1', e.target.value)} />
    ) },
    { key: 'phone2', label: 'Teléfono 2', render: (c) => (
      <input className="day-edit" defaultValue={c.phone2 || ''} onBlur={(e) => handleFieldBlur(c, 'phone2', e.target.value)} />
    ) },
    { key: 'notes', label: 'Observaciones', render: (c) => (
      <input className="day-edit" defaultValue={effectiveNotes(c, date)} onBlur={(e) => handleFieldBlur(c, 'notes', e.target.value)} />
    ) },
    { key: 'specialDiet', label: 'Dieta especial', render: (c) => c.specialDiet || '—' },
    { key: 'career', label: 'Carreras / entrega', render: (c) => n(c.career || 1) },
    { key: 'bags', label: 'Bolsas', render: (c) => n(c.bags) },
    { key: 'status', label: 'Estado', render: (c) => {
      const current = dispatchStatus(c, date, dayInfo, false);
      const pausedToday = c.pauseDates?.includes(date);
      const canToggle = current === 'Activo' || pausedToday;
      return (
        <>
          <span className={`badge ${statusBadgeClass(current)}`}>{current}</span>
          {canEdit && canToggle && (
            <button className="outline pause-day-btn" onClick={() => toggleDayPause(c)}>
              {pausedToday ? 'Reanudar hoy' : 'Pausar hoy'}
            </button>
          )}
        </>
      );
    } },
    { key: 'remaining', label: 'Servicios restantes', render: (c) => (n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : '—') },
    { key: 'returnDate', label: 'Fecha de retorno', render: (c) => (
      <input className="day-edit" type="date" defaultValue={c.returnDate || ''}
        disabled={!canEditDispatchField(c, 'returnDate', date, { role: user?.role, isDriver, myRoutes, realToday: serverToday, canEditDispatch: canEdit })}
        onBlur={(e) => handleFieldBlur(c, 'returnDate', e.target.value)} />
    ) },
  ];
  const columns = arrangeColumns(allColumns, colPrefs);

  const resizeRef = useRef(null);
  function startResize(e, key) {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    resizeRef.current = { key, startX, startWidth };
    function onMove(ev) {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const newWidth = Math.max(70, resizeRef.current.startWidth + delta);
      th.style.width = `${newWidth}px`;
    }
    function onUp() {
      if (resizeRef.current) {
        const finalWidth = Math.max(70, th.offsetWidth);
        const widths = { ...colPrefs.widths, [resizeRef.current.key]: finalWidth };
        setColPrefs((p) => ({ ...p, widths }));
        saveColumnWidths(user?.id, 'dispatch', widths);
      }
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleSaveColumns(order, hiddenList) {
    setColPrefs({ order, hidden: hiddenList });
    saveColumnOrder(user?.id, 'dispatch', order);
    saveHiddenColumns(user?.id, 'dispatch', hiddenList);
    setColumnsOpen(false);
    showNotice('Columnas actualizadas.');
  }

  function totalsRow(label, orders, variant) {
    let labelled = false;
    return (
      <tr className={`table-totals ${variant}`}>
        {columns.map((col) => {
          if (numericKeys.has(col.key)) {
            const sum = orders.reduce((s, c) => s + (col.key === 'career' ? n(c.career || 1) : col.key === 'bags' ? n(c.bags) : col.key === 'remaining' ? (n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : 0) : itemValue(c, col.key)), 0);
            return <td key={col.key}>{sum}</td>;
          }
          if (!labelled) { labelled = true; return <td key={col.key}>{label}</td>; }
          return <td key={col.key}>—</td>;
        })}
      </tr>
    );
  }

  if (loading) return <p className="muted">Cargando los pedidos de hoy…</p>;

  if (isPastProcessedDay) {
    return (
      <section className="page active">
        <div className="page-head">
          <div><h1>Día de trabajo</h1><p>Historial del {date.split('-').reverse().join('/')} — este día ya fue procesado.</p></div>
          {canEdit && (
            <div className="head-actions">
              <button className="info" onClick={() => setForceLive(true)}>Ver edición en vivo</button>
              <button className="warning" onClick={unprocessDay}>Desprocesar día</button>
            </div>
          )}
        </div>
        {loadingHistorial ? <p className="muted">Cargando historial de este día…</p> : historial ? (
          <HistorialTable snap={historial} />
        ) : <p className="muted">No se encontró un respaldo guardado para este día.</p>}
      </section>
    );
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>Día de trabajo</h1>
          <p>{isDriver ? 'Puedes elegir qué día ver: el actual (en vivo) o uno pasado.' : 'La fecha seleccionada define la base operativa y los clientes activos del día.'}</p>
        </div>
        <div className="head-actions">
          {canEdit && (dayInfo.processed ? <button className="warning" onClick={unprocessDay}>Desprocesar día</button> : <button className="primary" onClick={processDay}>Procesar día</button>)}
          <button className="excel" onClick={exportDiets} title={dietsLocked ? 'Función Premium' : ''}>Exportar dietas{dietsLocked ? ' 🔒' : ''}</button>
          <button className="excel" onClick={exportRouteOrder}>Exportar orden de ruta</button>
          <button className="info" onClick={() => setColumnsOpen(true)}>Columnas</button>
        </div>
      </div>

      {dietsLocked && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
          Esta empresa está en plan Básico: exportar las dietas especiales es una función Premium. Actívala desde Configuración.
        </p>
      )}

      <div className="toolbar">
        <label className="field">Día de trabajo
          <div className="date-input-wrap">
            <input type="date" value={date} onChange={(e) => handleWorkDateChange(e.target.value)} disabled={!canEdit && !isDriver} />
            {isDriver && date !== serverToday && <button type="button" className="outline" onClick={resetDriverViewToToday} style={{ marginLeft: 6 }}>Hoy</button>}
          </div>
        </label>
        {!isDriver && (
          <label className="field">Ruta
            <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
              <option value="">Todas las rutas</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">Estado del pedido
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos</option>
            {['Activo', 'Pausado', 'Programado', 'Retorno pendiente', 'No laborable'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">Estado del día
          <select value={dayInfo.laborable ? 'work' : 'off'} onChange={(e) => toggleDayLaborable(e.target.value === 'work')} disabled={!canEdit}>
            <option value="work">Laborable</option>
            <option value="off">No laborable</option>
          </select>
        </label>
        <input className="search" placeholder="Buscar cliente, teléfono o dieta…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{list.length} pedidos visibles</span>
      </div>

      <div className="sheet">
        <table id="dispatch-table">
          <thead><tr>{columns.map((c) => (
            <th key={c.key} style={colPrefs.widths?.[c.key] ? { width: colPrefs.widths[c.key] } : undefined}>
              {c.label}
              <span className="col-resize-handle" onMouseDown={(e) => startResize(e, c.key)} title="Arrastrar para cambiar el ancho" />
            </th>
          ))}</tr></thead>
          <tbody>
            {list.length ? list.map((c) => (
              <tr key={c.id}>{columns.map((col) => <td key={col.key}>{col.render(c)}</td>)}</tr>
            )) : (
              <tr><td colSpan={columns.length} className="empty">No hay pedidos para los filtros seleccionados.</td></tr>
            )}
          </tbody>
          <tfoot>
            {totalsRow(`Totales filtrados (${filteredActive.length} clientes activos)`, filteredActive, 'filtered')}
            {totalsRow(`Totales generales (${activeOrders.length} clientes activos)`, activeOrders, 'general')}
          </tfoot>
        </table>
      </div>
      <ColumnsModal
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        allColumns={allColumns}
        hidden={colPrefs.hidden}
        order={colPrefs.order}
        onSave={handleSaveColumns}
      />
      {orderConflict && (
        <dialog className="panel-modal" open onClose={() => resolveOrderConflict('cancel')}>
          <div className="modal-head"><h2>Número de orden repetido</h2></div>
          <div className="modal-body">
            <p style={{ marginTop: 0 }}>Ya hay otro cliente activo con el número <b>{orderConflict.value}</b> en esta ruta. ¿Qué hacés?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="primary" onClick={() => resolveOrderConflict('shift')}>Correr los siguientes un número (mantener la secuencia)</button>
              <button className="outline" onClick={() => resolveOrderConflict('duplicate')}>Dejar los dos con el número {orderConflict.value}</button>
              <button className="outline" onClick={() => resolveOrderConflict('cancel')}>Cancelar</button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}

// Tabla de solo lectura para un día ya procesado: muestra la "foto" que
// quedó guardada en su momento (buildSnapshotPayload), no los datos
// actuales del cliente — por eso no tiene inputs editables.
function HistorialTable({ snap }) {
  const rows = snap.payload?.clientes || [];
  const itemLabels = [...new Set(rows.flatMap((c) => Object.keys(c.items || {})))];
  const savedAt = snap.created_at ? new Date(snap.created_at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const headers = ['Orden', 'Cliente', 'Ruta', 'Driver', 'Plan', ...itemLabels, 'Dirección', 'Teléfono 1', 'Teléfono 2', 'Dieta especial', 'Observaciones', 'Carreras', 'Bolsas', 'Estado', 'Servicios restantes'];
  const numericCols = new Set([...itemLabels, 'Carreras', 'Bolsas', 'Servicios restantes']);

  return (
    <>
      {savedAt && <p className="muted" style={{ marginTop: -6 }}>Guardado el {savedAt}.</p>}
      <div className="sheet">
        <table>
          <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((c, i) => (
              <tr key={i}>
                <td>{n(c.orden)}</td><td><b>{c.nombre}</b></td><td>{c.ruta}</td><td>{c.driver}</td><td>{c.plan}</td>
                {itemLabels.map((l) => <td key={l}>{n(c.items?.[l])}</td>)}
                <td>{c.direccion || '—'}</td><td>{c.telefono1 || '—'}</td><td>{c.telefono2 || '—'}</td>
                <td>{c.dietaEspecial || '—'}</td><td>{c.observaciones || '—'}</td><td>{n(c.carreras)}</td>
                <td>{n(c.bolsas)}</td><td><span className={`badge ${statusBadgeClass(c.estado)}`}>{c.estado}</span></td>
                <td>{c.serviciosRestantes ?? '—'}</td>
              </tr>
            )) : <tr><td colSpan={headers.length} className="empty">Sin clientes registrados ese día.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="table-totals">
                {headers.map((h, i) => {
                  if (numericCols.has(h)) {
                    const sum = rows.reduce((s, c) => s + (h === 'Carreras' ? n(c.carreras) : h === 'Bolsas' ? n(c.bolsas) : h === 'Servicios restantes' ? n(c.serviciosRestantes) : n(c.items?.[h])), 0);
                    return <td key={h}>{sum}</td>;
                  }
                  return <td key={h}>{i === 0 ? `Totales (${rows.length} clientes)` : '—'}</td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbGetDeliveryRows, dbGetFields, dbGetSnapshot, dbUpsertSnapshot } from '../../../services/db';
import { planDayClose } from '../../../services/dayProcessing';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n, addDays } from '../../../services/planHelpers';
import { getColumnPrefs, saveHiddenColumns, saveColumnOrder, saveColumnWidths, arrangeColumns, startColumnResize, resizeEndedRecently } from '../../../services/columnPrefs';
import ColumnsModal from '../ColumnsModal';
import Modal from '../Modal';
import { getDriverViewDate, setDriverViewDate } from '../../../services/driverViewDate';
import {
  effectiveRouteId, effectiveAddress, effectiveOrder, effectiveNotes, effectiveMaps,
  effectiveDriverId, resolvedAddress, writeOrderValue, shiftOrdersFrom, dispatchStatus, statusBadgeClass,
  myRouteIds, canEditDispatchField, lastProcessedDate,
} from '../../../services/dispatchHelpers';
import { canManage, isPagePremiumLocked } from '../../../services/panelAuth';
import { isShortMapsLink, resolveShortMapsLinkIfNeeded } from '../../../services/resolveMapsLink';
import { fmtDate } from '../panelUtils';
import './DispatchPage.css';

// Referencia fija para los días sin registro: si fuera un objeto nuevo en cada render, los…
const DEFAULT_DAY_INFO = { laborable: true };

export default function DispatchPage({ user, onGoToClient }) {
  const { t } = useTranslation();
  const { loading, clients, routes, drivers, plans, days, currentDate, settings, serverToday, pendingDays, setCurrentDate, saveDays, saveClients, showNotice, inventory, saveInventory } = useOperations();

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
  const dayInfo = days[date] || DEFAULT_DAY_INFO;
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
    return routes.find((r) => r.id === id)?.name || t('panel.dispatch.noRoute');
  }
  function driverNameOf(id) {
    const d = drivers.find((x) => x.id === id);
    return d ? `${d.firstName} ${d.lastName}` : t('panel.dispatch.unassigned');
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
    .filter((c) => (!rf || effectiveRouteId(c, date) === rf) && (!q || [c.name, c.carnet, effectiveAddress(c, date), c.phone1, c.phone2, c.specialDiet, c.specialDietSnacks, effectiveNotes(c, date)].join(' ').toLowerCase().includes(q)))
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
    if (!client) return null;
    const updated = { ...client };
    mutate(updated);
    saveClients([updated]);
    return updated;
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

    const updated = updateClient(client.id, (c) => {
      if (field === 'notes' || field === 'maps') {
        const addr = resolvedAddress(c, date);
        if (addr) {
          addr[field] = value;
          // Mismo bug que en ClientsPage.jsx: si se borra el link acá y las coordenadas actuales…
          if (field === 'maps' && !value && addr.mapsResolvedFrom) {
            addr.lat = null; addr.lng = null; addr.mapsResolvedFrom = null;
          }
        } else c[field] = value;
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

    // Si el link de Maps que se acaba de pegar ACÁ (no desde el formulario completo de…
    if (field === 'maps' && updated && isShortMapsLink(value)) {
      resolveShortMapsLinkIfNeeded({ maps: value }).then((resolved) => {
        if (resolved.lat == null) return; // no se pudo resolver, se deja como está
        const patched = { ...updated };
        const target = resolvedAddress(patched, date) || patched;
        if (target.maps !== value) return; // el campo cambió de nuevo mientras tanto, no pisar lo nuevo
        target.lat = resolved.lat;
        target.lng = resolved.lng;
        // Guarda mapsResolvedFrom para que, si después se abre el mismo cliente desde Clientes sin…
        target.mapsResolvedFrom = resolved.mapsResolvedFrom;
        saveClients([patched]);
      });
    }
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
    if (!canEdit || !newDate) return;
    const maxAllowed = addDays(serverToday, 1);
    if (newDate > maxAllowed) {
      showNotice(t('panel.dispatch.maxFutureDate', { date: fmtDate(maxAllowed) }), true);
      return;
    }
    setForceLive(false);
    setCurrentDate(newDate);
  }

  function goToPendingDay(d) {
    setForceLive(false);
    setCurrentDate(d);
  }

  // Cierra los días pendientes como "sin actividad": no descuenta días de plan, no toca el…
  function closePendingWithoutActivity() {
    if (!canEdit || !pendingDays.length) return;
    const first = pendingDays[0];
    const last = pendingDays[pendingDays.length - 1];
    const rango = first === last ? fmtDate(first) : `del ${fmtDate(first)} al ${fmtDate(last)}`;
    const rangeText = first === last ? fmtDate(first) : t('panel.dispatch.rangeFromTo', { from: fmtDate(first), to: fmtDate(last) });
    if (!confirm(t('panel.dispatch.closePendingConfirm', { days: t('panel.dispatch.daysCount', { count: pendingDays.length }), range: rangeText }))) return;
    const newDays = { ...days };
    pendingDays.forEach((d) => { newDays[d] = { ...(newDays[d] || { laborable: true }), processed: true, processedClientIds: [], payrollSnapshot: [] }; });
    saveDays(newDays);
    showNotice(t('panel.dispatch.closedDaysCount', { count: pendingDays.length }));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Días cerrados sin actividad', entity_type: 'day', entity_label: rango, entity_id: first, details: { dias: pendingDays } });
    if (pendingDays.includes(date)) setCurrentDate(serverToday);
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

  function downloadJsonBackup(payload, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function processDay() {
    if (!canEdit) { showNotice(t('panel.dispatch.noPermissionProcess'), true); return; }
    if (dayInfo.processed) { showNotice(t('panel.dispatch.alreadyProcessed'), true); return; }
    if (date > serverToday) { showNotice(t('panel.dispatch.futureDayCannotProcess'), true); return; }
    const lastDone = lastProcessedDate(days);
    if (lastDone && date > addDays(lastDone, 1)) {
      showNotice(t('panel.dispatch.mustProcessFirst', { date: fmtDate(addDays(lastDone, 1)) }), true);
      return;
    }
    // Con el panel desactualizado el día pudo cerrarse solo: procesarlo otra vez descontaría dos veces
    const fresh = await dbGetFields('clientes', ['days']);
    if (fresh?.days?.[date]?.processed) {
      showNotice(t('panel.dispatch.alreadyProcessedElsewhere'), true);
      return;
    }

    // Las marcas de entrega deciden quién paga el día (un "no entregado" por culpa del personal no descuenta)
    const deliveryRows = (await dbGetDeliveryRows(date)) || [];
    const plan = planDayClose({ date, days, clients, drivers, routes, plans, settings, inventory, deliveryRows });
    const dateLabel = fmtDate(date);

    if (plan.nonWorking) {
      if (!confirm(t('panel.dispatch.confirmCloseNonWorking', { date: dateLabel }))) return;
      saveDays(plan.newDays);
      await dbUpsertSnapshot(date, plan.snapshot);
      showNotice(t('panel.dispatch.nonWorkingDayClosed'));
      dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Día cerrado (no laborable)', entity_type: 'day', entity_label: date, entity_id: date, details: {} });
      setCurrentDate(addDays(date, 1));
      return;
    }

    const sinDescuento = plan.processedIds.length - plan.chargedIds.length;
    // Nadie clasificó la falla en Avisos: se cobra como si el culpable fuera el cliente
    const sinClasificar = deliveryRows.filter((r) => r.status === 'no_entregado' && !r.fault).length;
    const confirmMsg = t('panel.dispatch.confirmProcessDay', { date: dateLabel })
      + (sinDescuento ? `\n\n${t('panel.dispatch.confirmStaffFaultNote', { count: sinDescuento })}` : '')
      + (sinClasificar ? `\n\n${t('panel.dispatch.confirmUnsetFaultNote', { count: sinClasificar })}` : '');
    if (!confirm(confirmMsg)) return;
    saveClients(plan.updatedClients);
    saveDays(plan.newDays);
    if (plan.newInventory) saveInventory(plan.newInventory);
    await dbUpsertSnapshot(date, plan.snapshot);
    showNotice(t('panel.dispatch.dayProcessedDownloading'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Día procesado', entity_type: 'day', entity_label: date, entity_id: date, details: { clientesAtendidos: plan.processedIds.length, sinDescuentoServicio: sinDescuento || undefined } });
    downloadJsonBackup(plan.snapshot, `dia-procesado-${date}.json`);
    exportProcessedDaySnapshot(plan.snapshot).catch(() => {});
    setCurrentDate(addDays(date, 1));
  }

  async function exportProcessedDaySnapshot(payload) {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet(t('panel.dispatch.sheetProcessedDay'), { views: [{ state: 'frozen', ySplit: 1 }] });
    const itemLabels = [...new Set(payload.clientes.flatMap((c) => Object.keys(c.items || {})))];
    ws.columns = [
      { header: t('panel.dispatch.colOrder'), key: 'orden', width: 8 }, { header: t('panel.common.client'), key: 'nombre', width: 26 },
      { header: t('panel.common.route'), key: 'ruta', width: 16 }, { header: t('panel.common.driver'), key: 'driver', width: 20 },
      { header: t('panel.common.plan'), key: 'plan', width: 16 }, ...itemLabels.map((l) => ({ header: l, key: l, width: 10 })),
      { header: t('panel.common.address'), key: 'direccion', width: 30 }, { header: t('panel.dispatch.colPhone1'), key: 'telefono1', width: 14 },
      { header: t('panel.dispatch.colSpecialDiet'), key: 'dietaEspecial', width: 22 }, { header: t('panel.common.notes'), key: 'observaciones', width: 26 },
      { header: t('panel.dispatch.colCareers'), key: 'carreras', width: 10 }, { header: t('panel.dispatch.colBags'), key: 'bolsas', width: 10 },
    ];
    styleHeader(ws.getRow(1), 'FF0D6EFD');
    payload.clientes.forEach((c, i) => {
      const row = ws.addRow({ ...c, ...Object.fromEntries(itemLabels.map((l) => [l, n(c.items?.[l])])) });
      styleRow(row, i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF');
    });
    await downloadWorkbook(wb, `dia-procesado-${payload.fecha}.xlsx`);
  }

  async function unprocessDay() {
    if (!canEdit) { showNotice(t('panel.dispatch.noPermissionUnprocess'), true); return; }
    if (!dayInfo.processed) { showNotice(t('panel.dispatch.dayNotProcessed'), true); return; }
    if (!confirm(t('panel.dispatch.unprocessDayConfirm', { date: fmtDate(date) }))) return;
    // Se revierte solo lo que se llegó a descontar: los "no entregados" por falla del personal nunca consumieron
    const ids = dayInfo.chargedClientIds ?? dayInfo.processedClientIds ?? clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo').map((c) => c.id);
    saveClients(clients.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, consumedDays: Math.max(0, n(c.consumedDays) - 1) })));
    saveDays({ ...days, [date]: { ...dayInfo, processed: false, processedClientIds: [], chargedClientIds: [], payrollSnapshot: [] } });
    // Repone el inventario descontado automáticamente al procesar (quantity ya quedó guardado…
    const kept = [];
    const updatedItems = [...inventory.items];
    inventory.movements.forEach((m) => {
      if (m.type === 'delivery' && m.date === date) {
        const idx = updatedItems.findIndex((i) => i.id === m.inventoryId);
        if (idx >= 0) updatedItems[idx] = { ...updatedItems[idx], stock: n(updatedItems[idx].stock) - n(m.quantity) };
      } else kept.push(m);
    });
    if (kept.length !== inventory.movements.length) saveInventory({ ...inventory, items: updatedItems, movements: kept });
    showNotice(t('panel.dispatch.dayUnprocessed'));
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
    if (dietsLocked) { showNotice(t('panel.dispatch.dietsPremiumNotice'), true); return; }
    const activeClients = clients.filter((c) => dispatchStatus(c, date, dayInfo, false) === 'Activo');
    if (!activeClients.length) { showNotice(t('panel.dispatch.noActiveClientsToday'), true); return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet(t('panel.dispatch.sheetSpecialDiets'), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: t('panel.common.route'), key: 'ruta', width: 16 }, { header: t('panel.common.client'), key: 'cliente', width: 26 },
      { header: t('panel.common.plan'), key: 'plan', width: 18 }, { header: t('panel.dispatch.colIncludedItems'), key: 'items', width: 46 },
      { header: t('panel.dispatch.colSpecialDietSnacks'), key: 'dietaMeriendas', width: 26 },
      { header: t('panel.dispatch.colNotesOrSpecialDiet'), key: 'notes', width: 38 },
    ];
    styleHeader(ws.getRow(1), 'FF0D6EFD');
    const groupsById = new Map();
    activeClients.forEach((c) => {
      const rid = effectiveRouteId(c, date) || '__none__';
      if (!groupsById.has(rid)) groupsById.set(rid, { name: rid === '__none__' ? t('panel.dispatch.noRoute') : routeName(rid), clients: [] });
      groupsById.get(rid).clients.push(c);
    });
    const orderedIds = [...routes.map((r) => r.id), '__none__'].filter((id) => groupsById.has(id));
    const groups = orderedIds.map((id) => groupsById.get(id));
    groups.forEach((g) => g.clients.sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999)));
    let i = 0;
    groups.forEach((g) => {
      g.clients.forEach((c) => {
        const pitems = c.items && Object.keys(c.items).length ? c.items : planOf(c.planId)?.items || {};
        const row = ws.addRow({ ruta: g.name, cliente: c.name, plan: planOf(c.planId)?.name || t('panel.dispatch.noPlan'), items: menuItemsList().filter(([k]) => n(pitems[k]) > 0).map(([k, l]) => `${l}: ${n(pitems[k])}`).join(' | ') || '—', dietaMeriendas: c.specialDietSnacks || '—', notes: [effectiveNotes(c, date), c.specialDiet].filter(Boolean).join(' — ') || '—' });
        styleRow(row, i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF');
        i++;
      });
      const totalRow = ws.addRow({ ruta: '', cliente: t('panel.dispatch.routeTotalClients', { name: g.name, total: g.clients.length }), plan: '', items: '', notes: '' });
      totalRow.eachCell((cell) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E7EE' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    });
    const grand = ws.addRow({ ruta: '', cliente: t('panel.dispatch.grandTotalClients', { total: activeClients.length }), plan: '', items: '', notes: '' });
    grand.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    await downloadWorkbook(wb, `dietas-especiales-${date}.xlsx`);
    showNotice(t('panel.dispatch.excelGenerated'));
  }

  async function exportRouteOrder() {
    const routeIds = isDriver ? myRoutes : [routeFilter].filter(Boolean);
    if (!routeIds.length) { showNotice(t('panel.dispatch.selectRouteFirst'), true); return; }
    let activeClients = clients.filter((c) => routeIds.includes(effectiveRouteId(c, date)) && dispatchStatus(c, date, dayInfo, false) === 'Activo');
    activeClients = [...activeClients].sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999));
    if (!activeClients.length) { showNotice(t('panel.dispatch.noActiveClientsInRoute'), true); return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const ws = wb.addWorksheet(t('panel.dispatch.sheetRouteOrder'), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: t('panel.dispatch.colOrder'), key: 'order', width: 8 }, { header: t('panel.common.client'), key: 'cliente', width: 26 },
      { header: t('panel.common.address'), key: 'address', width: 34 }, { header: t('panel.common.phone'), key: 'phone', width: 16 },
      { header: 'Google Maps', key: 'maps', width: 16 }, { header: t('panel.dispatch.colBags'), key: 'bags', width: 10 },
      { header: t('panel.dispatch.colCareers'), key: 'career', width: 12 }, { header: t('panel.common.notes'), key: 'notes', width: 30 },
    ];
    styleHeader(ws.getRow(1), 'FF198754');
    activeClients.forEach((c, i) => {
      const mapsLink = effectiveMaps(c, date);
      const row = ws.addRow({ order: n(effectiveOrder(c, date)) || '', cliente: c.name, address: effectiveAddress(c, date) || '—', phone: [c.phone1, c.phone2].filter(Boolean).join(' / ') || '—', maps: mapsLink ? t('panel.dispatch.openMap') : '—', bags: n(c.bags), career: n(c.career || 1), notes: effectiveNotes(c, date) || '—' });
      if (mapsLink) row.getCell('maps').value = { text: t('panel.dispatch.openMap'), hyperlink: mapsLink };
      styleRow(row, i % 2 === 0 ? 'FFF0FBF4' : 'FFFFFFFF');
      row.getCell('maps').font = { color: { argb: 'FF0D6EFD' }, underline: true };
    });
    const total = ws.addRow({ order: '', cliente: t('panel.dispatch.totalClients', { total: activeClients.length }), address: '', phone: '', maps: '', bags: activeClients.reduce((a, c) => a + n(c.bags), 0), career: activeClients.reduce((a, c) => a + n(c.career || 1), 0), notes: '' });
    total.eachCell((cell) => { cell.font = { bold: true }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    await downloadWorkbook(wb, `orden-de-ruta-${date}.xlsx`);
    showNotice(t('panel.dispatch.excelGenerated'));
  }

  const allColumns = [
    { key: 'order', label: t('panel.dispatch.colOrder'), sortValue: (c) => n(effectiveOrder(c, date)), render: (c) => (
      <input className="day-edit" type="number" id={`order-${c.id}`} name={`order-${c.id}`} defaultValue={effectiveOrder(c, date)}
        disabled={!canEditDispatchField(c, 'order', date, { role: user?.role, isDriver, myRoutes, realToday: serverToday, canEditDispatch: canEdit })}
        onBlur={(e) => handleFieldBlur(c, 'order', e.target.value, e.target)} />
    ) },
    { key: 'name', label: t('panel.common.client'), sortValue: (c) => c.name || '', render: (c) => (<><b>{c.name}</b><br /><small className="muted">{c.carnet || t('panel.dispatch.noCarnet')}</small></>) },
    { key: 'route', label: t('panel.common.route'), sortValue: (c) => routeName(effectiveRouteId(c, date)) || '', render: (c) => routeName(effectiveRouteId(c, date)) },
    { key: 'driver', label: t('panel.common.driver'), sortValue: (c) => driverNameOf(effectiveDriverId(c, date, drivers)) || '', render: (c) => driverNameOf(effectiveDriverId(c, date, drivers)) },
    { key: 'plan', label: t('panel.common.plan'), sortValue: (c) => planOf(c.planId)?.name || '', render: (c) => planOf(c.planId)?.name || t('panel.dispatch.noPlan') },
    ...menuItemsList().map(([key, label]) => ({ key, label, sortValue: (c) => n(itemValue(c, key)), render: (c) => itemValue(c, key) })),
    { key: 'address1', label: t('panel.common.address'), sortValue: (c) => effectiveAddress(c, date) || '', render: (c) => effectiveAddress(c, date) || '—' },
    { key: 'maps', label: 'Google Maps', render: (c) => {
      const link = effectiveMaps(c, date);
      return (
        <div className="maps-cell">
          <input className="day-edit" id={`maps-${c.id}`} name={`maps-${c.id}`} autoComplete="off" defaultValue={resolvedAddress(c, date)?.maps || c.maps || ''} onBlur={(e) => handleFieldBlur(c, 'maps', e.target.value)} />
          {link && <a href={link} target="_blank" rel="noopener" className="maps-cell-link">{t('panel.dispatch.openMap')}</a>}
        </div>
      );
    } },
    { key: 'phone1', label: t('panel.dispatch.colPhone1'), sortValue: (c) => c.phone1 || '', render: (c) => (
      <input className="day-edit" id={`dispatch-phone1-${c.id}`} name={`dispatch-phone1-${c.id}`} autoComplete="tel" defaultValue={c.phone1 || ''} onBlur={(e) => handleFieldBlur(c, 'phone1', e.target.value)} />
    ) },
    { key: 'phone2', label: t('panel.dispatch.colPhone2'), sortValue: (c) => c.phone2 || '', render: (c) => (
      <input className="day-edit" id={`dispatch-phone2-${c.id}`} name={`dispatch-phone2-${c.id}`} autoComplete="tel" defaultValue={c.phone2 || ''} onBlur={(e) => handleFieldBlur(c, 'phone2', e.target.value)} />
    ) },
    { key: 'notes', label: t('panel.common.notes'), sortValue: (c) => effectiveNotes(c, date) || '', render: (c) => (
      <input className="day-edit" id={`notes-${c.id}`} name={`notes-${c.id}`} autoComplete="off" defaultValue={effectiveNotes(c, date)} onBlur={(e) => handleFieldBlur(c, 'notes', e.target.value)} />
    ) },
    { key: 'specialDiet', label: t('panel.dispatch.colSpecialDiet'), sortValue: (c) => c.specialDiet || '', render: (c) => c.specialDiet || '—' },
    { key: 'specialDietSnacks', label: t('panel.dispatch.colSpecialDietSnacks'), sortValue: (c) => c.specialDietSnacks || '', render: (c) => c.specialDietSnacks || '—' },
    { key: 'career', label: t('panel.dispatch.colCareersDelivery'), sortValue: (c) => n(c.career || 1), render: (c) => n(c.career || 1) },
    { key: 'bags', label: t('panel.dispatch.colBags'), sortValue: (c) => n(c.bags), render: (c) => n(c.bags) },
    { key: 'status', label: t('panel.common.status'), sortValue: (c) => dispatchStatus(c, date, dayInfo, false) || '', render: (c) => {
      const current = dispatchStatus(c, date, dayInfo, false);
      const pausedToday = c.pauseDates?.includes(date);
      const canToggle = current === 'Activo' || pausedToday;
      return (
        <>
          <span className={`badge ${statusBadgeClass(current)}`}>{current}</span>
          {canEdit && canToggle && (
            <button className={`pause-day-btn ${pausedToday ? 'success' : 'orange'}`} onClick={() => toggleDayPause(c)}>
              {pausedToday ? t('panel.dispatch.resumeToday') : t('panel.dispatch.pauseToday')}
            </button>
          )}
        </>
      );
    } },
    { key: 'remaining', label: t('panel.dispatch.colRemainingServices'), sortValue: (c) => (n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : -1), render: (c) => (n(c.paidDays) ? Math.max(0, n(c.paidDays) - n(c.consumedDays)) : '—') },
    { key: 'returnDate', label: t('panel.dispatch.colReturnDate'), sortValue: (c) => c.returnDate || '', render: (c) => {
      const editable = canEditDispatchField(c, 'returnDate', date, { role: user?.role, isDriver, myRoutes, realToday: serverToday, canEditDispatch: canEdit });
      return (
        // El ✕ existe porque en iPhone/iPad el selector de fecha no trae forma de borrarla.
        <div className="date-clear-wrap">
          <input className="day-edit" type="date" key={c.returnDate || ''} id={`returnDate-${c.id}`} name={`returnDate-${c.id}`} defaultValue={c.returnDate || ''}
            disabled={!editable}
            onBlur={(e) => handleFieldBlur(c, 'returnDate', e.target.value)} />
          {c.returnDate && editable && (
            <button type="button" className="icon-btn delete" title={t('panel.dispatch.removeReturnDate')} aria-label={t('panel.dispatch.removeReturnDate')} onClick={() => handleFieldBlur(c, 'returnDate', '')}>✕</button>
          )}
        </div>
      );
    } },
    // Columna nueva: antes, para editar los datos completos de un cliente (no solo los campos…
    { key: 'edit', label: t('panel.common.edit'), render: (c) => (
      canEdit ? <button className="icon-btn info" onClick={() => onGoToClient?.(c.id, 'edit')}>{t('panel.common.edit')}</button> : '—'
    ) },
  ];
  const columns = arrangeColumns(allColumns, colPrefs);

  const [sort, setSort] = useState(null);
  function toggleSort(key) {
    if (resizeEndedRecently()) return; // clic suelto al terminar de ajustar el ancho de una columna
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // tercer clic: vuelve al orden original
    });
  }
  function compareSortValues(a, b) {
    const an = typeof a === 'number' ? a : (a !== null && a !== '' && !isNaN(a)) ? Number(a) : null;
    const bn = typeof b === 'number' ? b : (b !== null && b !== '' && !isNaN(b)) ? Number(b) : null;
    if (an !== null && bn !== null) return an - bn;
    return String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base', numeric: true });
  }
  function startResize(e, key) {
    startColumnResize(e, key, (k, finalWidth) => {
      const widths = { ...colPrefs.widths, [k]: finalWidth };
      setColPrefs((p) => ({ ...p, widths }));
      saveColumnWidths(user?.id, 'dispatch', widths);
    });
  }

  function handleSaveColumns(order, hiddenList, newWidths) {
    // Se mezcla con lo anterior (no se reemplaza colPrefs entero) para no perder los anchos ya
    // guardados si `newWidths` no viene (ColumnsModal SIEMPRE lo manda, pero por las dudas).
    setColPrefs((p) => ({ ...p, order, hidden: hiddenList, widths: newWidths ?? p.widths }));
    saveColumnOrder(user?.id, 'dispatch', order);
    saveHiddenColumns(user?.id, 'dispatch', hiddenList);
    if (newWidths) saveColumnWidths(user?.id, 'dispatch', newWidths);
    setColumnsOpen(false);
    showNotice(t('panel.dispatch.columnsUpdated'));
  }

  function handleResetColumnWidths() {
    setColPrefs((p) => ({ ...p, widths: {} }));
    saveColumnWidths(user?.id, 'dispatch', {});
    showNotice(t('panel.dispatch.columnWidthsRestored'));
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

  if (loading) return <p className="muted">{t('panel.dispatch.loadingOrders')}</p>;

  if (isPastProcessedDay) {
    return (
      <section className="page active">
        <div className="page-head">
          <div><h1>{t('panel.dispatch.workDay')}</h1><p>{t('panel.dispatch.historyOfDate', { date: fmtDate(date) })}</p></div>
          {canEdit && (
            <div className="head-actions">
              <button className="info" onClick={() => setForceLive(true)}>{t('panel.dispatch.viewLiveEdit')}</button>
              <button className="orange" onClick={unprocessDay}>{t('panel.dispatch.unprocessDayBtn')}</button>
            </div>
          )}
        </div>

        {canEdit && !isDriver && pendingDays.length > 0 && (
          <PendingDaysBanner pendingDays={pendingDays} date={date} onGo={goToPendingDay} onCloseAll={closePendingWithoutActivity} />
        )}

        <div className="toolbar">
          <label className="field">{t('panel.dispatch.workDay')}
            <div className="date-input-wrap">
              <input type="date" value={date} onChange={(e) => handleWorkDateChange(e.target.value)} disabled={!canEdit && !isDriver} />
              {isDriver && date !== serverToday && <button type="button" className="info" onClick={resetDriverViewToToday} style={{ marginLeft: 6 }}>{t('panel.common.today')}</button>}
            </div>
          </label>
        </div>

        {loadingHistorial ? <p className="muted">{t('panel.dispatch.loadingHistory')}</p> : historial ? (
          <HistorialTable snap={historial} />
        ) : <p className="muted">{t('panel.dispatch.noSnapshotFound')}</p>}
      </section>
    );
  }

  const sortedList = (() => {
    if (!sort) return list;
    const col = columns.find((c) => c?.key === sort.key);
    if (!col) return list;
    const withValue = list.map((row, i) => ({ row, i, value: col.sortValue ? col.sortValue(row) : row[col.key] }));
    withValue.sort((a, b) => {
      const cmp = compareSortValues(a.value, b.value);
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
      return a.i - b.i; // estable
    });
    return withValue.map((x) => x.row);
  })();

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>{t('panel.dispatch.workDay')}</h1>
          <p>{isDriver ? t('panel.dispatch.driverDayHint') : t('panel.dispatch.adminDayHint')}</p>
        </div>
        <div className="head-actions">
          {canEdit && (dayInfo.processed ? <button className="orange" onClick={unprocessDay}>{t('panel.dispatch.unprocessDayBtn')}</button> : <button className="primary" onClick={processDay}>{t('panel.dispatch.processDayBtn')}</button>)}
          <button className="excel" onClick={exportDiets} title={dietsLocked ? t('panel.dispatch.premiumFeature') : ''}>{t('panel.dispatch.exportDietsBtn')}{dietsLocked ? ' 🔒' : ''}</button>
          <button className="excel" onClick={exportRouteOrder}>{t('panel.dispatch.exportRouteOrderBtn')}</button>
          <button className="info" onClick={() => setColumnsOpen(true)}>{t('panel.common.columns')}</button>
        </div>
      </div>

      {dietsLocked && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
          {t('panel.dispatch.dietsLockedNote')}
        </p>
      )}

      {canEdit && !isDriver && pendingDays.length > 0 && (
        <PendingDaysBanner pendingDays={pendingDays} date={date} onGo={goToPendingDay} onCloseAll={closePendingWithoutActivity} />
      )}

      <div className="toolbar">
        <label className="field">{t('panel.dispatch.workDay')}
          <div className="date-input-wrap">
            <input type="date" value={date} onChange={(e) => handleWorkDateChange(e.target.value)} disabled={!canEdit && !isDriver} />
            {isDriver && date !== serverToday && <button type="button" className="info" onClick={resetDriverViewToToday} style={{ marginLeft: 6 }}>{t('panel.common.today')}</button>}
          </div>
        </label>
        {!isDriver && (
          <label className="field">{t('panel.common.route')}
            <select id="dispatch-route-filter" name="dispatch-route-filter" value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
              <option value="">{t('panel.dispatch.allRoutes')}</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">{t('panel.dispatch.orderStatusLabel')}
          <select id="dispatch-status-filter" name="dispatch-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">{t('panel.common.all')}</option>
            {['Activo', 'Pausado', 'Programado', 'Retorno pendiente', 'No laborable', 'Fuera de horario'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">{t('panel.dispatch.dayStateLabel')}
          <select id="dispatch-laborable" name="dispatch-laborable" value={dayInfo.laborable ? 'work' : 'off'} onChange={(e) => toggleDayLaborable(e.target.value === 'work')} disabled={!canEdit}>
            <option value="work">{t('panel.dispatch.workingOption')}</option>
            <option value="off">{t('panel.dispatch.nonWorkingOption')}</option>
          </select>
        </label>
        <input className="search" id="dispatch-search" name="dispatch-search" autoComplete="off" placeholder={t('panel.dispatch.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{t('panel.dispatch.visibleOrders', { total: list.length })}</span>
      </div>

      <div className="sheet">
        <table id="dispatch-table">
          <thead><tr>{columns.filter(Boolean).map((c) => (
            <th key={c.key} style={colPrefs.widths?.[c.key] ? { width: colPrefs.widths[c.key] } : undefined} className="th-sortable" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              <button type="button" className="th-sort-btn" onClick={() => toggleSort(c.key)} title={t('panel.common.sortByColumn')}>
                {c.label}
                <span className="th-sort-icon">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
              </button>
              <span className="col-resize-handle" onPointerDown={(e) => startResize(e, c.key)} title={t('panel.common.dragResize')} />
            </th>
          ))}</tr></thead>
          <tbody>
            {sortedList.length ? sortedList.map((c) => (
              // La key incluye la fecha: los campos editables de esta fila usan defaultValue (no están…
              <tr key={`${c.id}::${date}`}>{columns.map((col) => <td key={col.key}>{col.render(c)}</td>)}</tr>
            )) : (
              <tr><td colSpan={columns.length} className="empty">{t('panel.dispatch.noOrdersForFilters')}</td></tr>
            )}
          </tbody>
          <tfoot>
            {totalsRow(t('panel.dispatch.filteredTotals', { total: filteredActive.length }), filteredActive, 'filtered')}
            {totalsRow(t('panel.dispatch.generalTotals', { total: activeOrders.length }), activeOrders, 'general')}
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
        onResetWidths={handleResetColumnWidths}
      />
      <Modal title={t('panel.dispatch.duplicateOrderTitle')} open={!!orderConflict} onClose={() => resolveOrderConflict('cancel')} hideSave>
        {orderConflict && (
          <>
            <p style={{ marginTop: 0 }}>
              <Trans i18nKey="panel.dispatch.duplicateOrderMsg" values={{ number: orderConflict.value }} components={{ b: <b /> }} />
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="primary" onClick={() => resolveOrderConflict('shift')}>{t('panel.dispatch.shiftNextOrders')}</button>
              <button className="orange" onClick={() => resolveOrderConflict('duplicate')}>{t('panel.dispatch.keepBothWithNumber', { number: orderConflict.value })}</button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

function PendingDaysBanner({ pendingDays, date, onGo, onCloseAll }) {
  const { t } = useTranslation();
  const first = pendingDays[0];
  const last = pendingDays[pendingDays.length - 1];
  const title = pendingDays.length === 1
    ? t('panel.dispatch.pendingOne', { date: fmtDate(first) })
    : t('panel.dispatch.pendingMany', { days: pendingDays.length, from: fmtDate(first), to: fmtDate(last) });
  return (
    <div className="pending-days-banner" role="alert">
      <div className="pending-days-text">
        <strong>{title}</strong>
        <span>{t('panel.dispatch.pendingHint')}</span>
      </div>
      <div className="pending-days-actions">
        {date !== first && <button type="button" className="primary" onClick={() => onGo(first)}>{t('panel.dispatch.goToDay', { date: fmtDate(first) })}</button>}
        <button type="button" className="orange" onClick={onCloseAll}>{pendingDays.length === 1 ? t('panel.dispatch.closeOneNoActivity') : t('panel.dispatch.closeAllNoActivity')}</button>
      </div>
    </div>
  );
}

// Tabla de solo lectura para un día ya procesado: muestra la "foto" que quedó guardada en…
function HistorialTable({ snap }) {
  const { t } = useTranslation();
  const rows = snap.payload?.clientes || [];
  const itemLabels = [...new Set(rows.flatMap((c) => Object.keys(c.items || {})))];
  const savedAt = snap.created_at ? new Date(snap.created_at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const careersLabel = t('panel.dispatch.colCareers');
  const bagsLabel = t('panel.dispatch.colBags');
  const remainingLabel = t('panel.dispatch.colRemainingServices');
  const headers = [t('panel.dispatch.colOrder'), t('panel.common.client'), t('panel.common.route'), t('panel.common.driver'), t('panel.common.plan'), ...itemLabels, t('panel.common.address'), t('panel.dispatch.colPhone1'), t('panel.dispatch.colPhone2'), t('panel.dispatch.colSpecialDiet'), t('panel.common.notes'), careersLabel, bagsLabel, t('panel.common.status'), remainingLabel];
  const numericCols = new Set([...itemLabels, careersLabel, bagsLabel, remainingLabel]);

  return (
    <>
      {savedAt && <p className="muted" style={{ marginTop: -6 }}>{t('panel.dispatch.savedAtTime', { datetime: savedAt })}</p>}
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
            )) : <tr><td colSpan={headers.length} className="empty">{t('panel.dispatch.noClientsThatDay')}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="table-totals">
                {headers.map((h, i) => {
                  if (numericCols.has(h)) {
                    const sum = rows.reduce((s, c) => s + (h === careersLabel ? n(c.carreras) : h === bagsLabel ? n(c.bolsas) : h === remainingLabel ? n(c.serviciosRestantes) : n(c.items?.[h])), 0);
                    return <td key={h}>{sum}</td>;
                  }
                  return <td key={h}>{i === 0 ? t('panel.dispatch.historyTotals', { total: rows.length }) : '—'}</td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

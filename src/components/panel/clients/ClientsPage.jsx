import { useState, useEffect, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit, rpc, getSessionToken } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveOrder, effectiveMaps, effectiveNotes, dispatchStatus, statusBadgeClass, myRouteIds, clientWaLink, shiftOrdersFrom } from '../../../services/dispatchHelpers';
import { canManage, isPagePremiumLocked } from '../../../services/panelAuth';
import { resolveShortMapsLinkIfNeeded } from '../../../services/resolveMapsLink';
import Modal from '../Modal';
import DataTable from '../DataTable';
import { uid, fmtDate } from '../panelUtils';

const WEEKDAYS = [{ v: 1, k: 'Mon' }, { v: 2, k: 'Tue' }, { v: 3, k: 'Wed' }, { v: 4, k: 'Thu' }, { v: 5, k: 'Fri' }, { v: 6, k: 'Sat' }, { v: 0, k: 'Sun' }];

// Campo de texto que crece con el contenido en vez de quedarse fijo en una sola línea y…
function AutoTextarea({ className, ...props }) {
  const ref = useRef(null);
  function resize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(() => { resize(ref.current); });
  return <textarea ref={ref} rows={1} className={`auto-textarea${className ? ` ${className}` : ''}`} {...props} onInput={(e) => { props.onInput?.(e); resize(e.target); }} />;
}

// Filas de direcciones editables dentro del formulario de cliente
function AddressRows({ addresses, setAddresses, activeId, setActiveId, routes, onOrderChange }) {
  const { t } = useTranslation();
  function update(i, field, value) {
    setAddresses((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }
  function updateAddr(i, patch) {
    setAddresses((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function remove(i) {
    const removed = addresses[i];
    const next = addresses.filter((_, idx) => idx !== i);
    setAddresses(next);
    if (removed?.id === activeId) setActiveId(next[0]?.id || '');
  }
  function add() {
    const row = { id: uid('addr'), address: '', routeId: '', maps: '', order: '', notes: '', lat: null, lng: null };
    setAddresses([...addresses, row]);
    if (!activeId) setActiveId(row.id);
  }

  // Se resuelve al salir del campo de Maps, no recién al Guardar -- así "Coordenadas" (lo que…
  async function handleMapsBlur(i) {
    const addr = addresses[i];
    if (!addr) return;
    if (!addr.maps) {
      if (addr.mapsResolvedFrom) updateAddr(i, { lat: null, lng: null, mapsResolvedFrom: null, _coordsDraft: undefined });
      return;
    }
    const resolved = await resolveShortMapsLinkIfNeeded(addr);
    // Guarda mapsResolvedFrom junto con lat/lng: sin eso, el formulario volvería a pedir la…
    if (resolved.lat != null && (resolved.lat !== addr.lat || resolved.lng !== addr.lng || resolved.mapsResolvedFrom !== addr.mapsResolvedFrom)) {
      updateAddr(i, { lat: resolved.lat, lng: resolved.lng, mapsResolvedFrom: resolved.mapsResolvedFrom, _coordsDraft: undefined });
    }
  }

  // "Coordenadas" se edita como un solo texto "lat, lng" (más cómodo para copiar/pegar desde…
  function formatCoords(a) {
    return a.lat != null && a.lng != null ? `${a.lat}, ${a.lng}` : '';
  }
  function handleCoordsChange(i, text) {
    const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    updateAddr(i, m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]), _coordsDraft: undefined } : { _coordsDraft: text });
  }

  // Conflicto de "Orden de entrega": el aviso lo monta el formulario completo (no acá adentro,
  // que está dentro de un <form> y otro <dialog>), así que solo se avisa al salir del campo.
  const focusValue = useRef({});

  function handleOrderBlur(i) {
    const addr = addresses[i];
    const trimmed = String(addr.order ?? '').trim();
    const prevValue = focusValue.current[i] ?? '';
    if (trimmed === '' || trimmed === prevValue) return;
    onOrderChange?.({ index: i, addressId: addr.id, value: trimmed, routeId: addr.routeId, prevValue });
  }

  return (
    <>
      {addresses.map((a, i) => (
        <div key={a.id} className="address-row">
          <button type="button" className="icon-btn delete address-row-remove" onClick={() => remove(i)} aria-label={t('panel.clients.removeAddress')} title={t('panel.clients.removeAddress')}>×</button>

          <label className="address-field address-field-wide">
            <span>{t('panel.common.address')}</span>
            <AutoTextarea id={`addr-address-${a.id}`} name={`addr-address-${a.id}`} placeholder={t('panel.clients.addressPlaceholder')} value={a.address} onChange={(e) => update(i, 'address', e.target.value)} />
          </label>

          <label className="address-field">
            <span>{t('panel.common.route')}</span>
            <select id={`addr-route-${a.id}`} name={`addr-route-${a.id}`} value={a.routeId} onChange={(e) => update(i, 'routeId', e.target.value)}>
              <option value="">{t('panel.clients.noRoute')}</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>

          {/* Orden y Observaciones: mismos campos que ya se pueden editar desde Día de trabajo (uno… */}
          <label className="address-field">
            <span>{t('panel.clients.deliveryOrder')}</span>
            <input id={`addr-order-${a.id}`} name={`addr-order-${a.id}`} placeholder={t('panel.clients.orderPlaceholder')} type="number" value={a.order ?? ''} onFocus={() => { focusValue.current[i] = String(a.order ?? ''); }} onChange={(e) => update(i, 'order', e.target.value)} onBlur={() => handleOrderBlur(i)} />
          </label>

          <label className="address-field address-field-wide">
            <span>{t('panel.clients.mapsLink')}</span>
            <AutoTextarea id={`addr-maps-${a.id}`} name={`addr-maps-${a.id}`} autoComplete="off" placeholder="https://maps.app.goo.gl/…" value={a.maps} onChange={(e) => update(i, 'maps', e.target.value)} onBlur={() => handleMapsBlur(i)} />
          </label>

          <label className="address-field">
            <span>{t('panel.clients.coordinates')} {a.lat != null && <span className="address-coords-ok" title={t('panel.clients.coordsTooltip')}>{t('panel.clients.coordsResolved')}</span>}</span>
            <input
              id={`addr-coords-${a.id}`}
              name={`addr-coords-${a.id}`}
              autoComplete="off"
              placeholder={t('panel.clients.coordsPlaceholder')}
              value={a._coordsDraft !== undefined ? a._coordsDraft : formatCoords(a)}
              onChange={(e) => handleCoordsChange(i, e.target.value)}
            />
          </label>

          <label className="address-field address-field-wide">
            <span>{t('panel.clients.riderNotes')}</span>
            <AutoTextarea id={`addr-notes-${a.id}`} name={`addr-notes-${a.id}`} placeholder={t('panel.clients.riderNotesPlaceholder')} value={a.notes ?? ''} onChange={(e) => update(i, 'notes', e.target.value)} />
          </label>
        </div>
      ))}
      <button type="button" className="primary" onClick={add}>+ {t('panel.clients.addAddress')}</button>
      {addresses.length > 1 && (
        <label style={{ marginTop: 10 }}>{t('panel.clients.activeAddress')}
          <select id="active-address" name="active-address" value={activeId} onChange={(e) => setActiveId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.address || t('panel.clients.unnamed')}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

// Horario semanal: franjas de días (ej. "lunes, miércoles y viernes") que apuntan a una de…
function ScheduleRows({ schedule, setSchedule, addresses }) {
  const { t } = useTranslation();
  function update(i, patch) {
    setSchedule(schedule.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function toggleDay(i, day) {
    const row = schedule[i];
    const days = row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day];
    update(i, { days });
  }
  function remove(i) {
    setSchedule(schedule.filter((_, idx) => idx !== i));
  }
  function add() {
    setSchedule([...schedule, { days: [], addressId: addresses[0]?.id || '' }]);
  }

  if (!addresses.length) {
    return <p className="muted">{t('panel.clients.scheduleNoAddresses')}</p>;
  }

  return (
    <>
      {schedule.map((row, i) => (
        <div key={i} className="schedule-row">
          <div className="schedule-row-days">
            {WEEKDAYS.map((w) => (
              <label key={w.v} className="schedule-day-check">
                <span>{t(`panel.clients.weekday${w.k}`)}</span>
                <input type="checkbox" id={`schedule-${i}-day-${w.v}`} name={`schedule-${i}-day-${w.v}`} checked={row.days.includes(w.v)} onChange={() => toggleDay(i, w.v)} />
              </label>
            ))}
          </div>
          <select id={`schedule-${i}-address`} name={`schedule-${i}-address`} value={row.addressId} onChange={(e) => update(i, { addressId: e.target.value })}>
            {addresses.map((a, ai) => <option key={a.id} value={a.id}>{a.address || t('panel.clients.addressN', { n: ai + 1 })}</option>)}
          </select>
          <button type="button" className="icon-btn delete" onClick={() => remove(i)}>{t('panel.clients.remove')}</button>
        </div>
      ))}
      <button type="button" className="primary" onClick={add}>+ {t('panel.clients.addScheduleRange')}</button>
      {schedule.length > 0 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('panel.clients.scheduleDaysWarning')}</p>}
    </>
  );
}

// Modal de "Renovar plan" / "Añadir nuevo plan": suma días al plan del cliente en vez de…
function RenewPlanModal({ client, mode, plans, onClose, onConfirm }) {
  const { t } = useTranslation();
  const isChangeMode = mode === 'change';
  const hasRemainingBalance = n(client?.paidDays) > n(client?.consumedDays);
  const remaining = Math.max(0, n(client?.paidDays) - n(client?.consumedDays));
  const defaultPlanId = isChangeMode ? '' : client?.planId || '';
  const [planId, setPlanId] = useState(defaultPlanId);
  const [days, setDays] = useState(() => n(plans.find((p) => p.id === defaultPlanId)?.serviceDays) || '');
  const [planChangeMode, setPlanChangeMode] = useState('immediate');

  const samePlan = !planId || planId === client?.planId;
  const showChoice = !samePlan && hasRemainingBalance;

  function handlePlanChange(id) {
    setPlanId(id);
    const p = plans.find((pl) => pl.id === id);
    if (p?.serviceDays) setDays(n(p.serviceDays));
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const daysToAdd = n(data.days);
    if (!daysToAdd || daysToAdd < 1) { alert(t('panel.clients.alertEnterDays')); return false; }
    return onConfirm({ planId: data.planId, days: daysToAdd, planChangeMode: data.planChangeMode || 'immediate', samePlan: !data.planId || data.planId === client.planId });
  }

  if (!client) return null;
  const planName = (id) => plans.find((p) => p.id === id)?.name || t('panel.clients.noPlan');

  return (
    <Modal title={isChangeMode ? t('panel.clients.addNewPlan') : t('panel.clients.renewPlan')} open={!!client} onClose={onClose} onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="wide plan-summary-row" style={{ margin: 0 }}>
          <div className="plan-option-info">
            <b>{client.name}</b>
            <span className="muted">{t('panel.clients.currentPlanLabel')} {planName(client.planId)} · {hasRemainingBalance ? t('panel.clients.remainingDays', { days: remaining }) : t('panel.clients.noRemainingDays')}</span>
          </div>
        </div>
        <label>{isChangeMode ? t('panel.clients.newPlanLabel') : t('panel.clients.planToRenew')}
          <select name="planId" value={planId} onChange={(e) => handlePlanChange(e.target.value)}>
            <option value="">{isChangeMode ? t('panel.clients.choosePlan') : t('panel.clients.noPlan')}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>{t('panel.clients.daysToAdd')} *<input name="days" type="number" min="1" step="1" required value={days} onChange={(e) => setDays(e.target.value)} /></label>
        {showChoice && (
          <div className="wide">
            <div className="plan-options">
              <label className="plan-option" style={{ cursor: 'pointer' }}>
                <div className="plan-option-info"><b>{t('panel.clients.changeImmediate')}</b><span className="muted">{t('panel.clients.changeImmediateDesc')}</span></div>
                <input type="radio" name="planChangeMode" value="immediate" checked={planChangeMode === 'immediate'} onChange={() => setPlanChangeMode('immediate')} />
              </label>
              <label className="plan-option" style={{ cursor: 'pointer' }}>
                <div className="plan-option-info"><b>{t('panel.clients.changeCarry')}</b><span className="muted">{t('panel.clients.changeCarryDesc')}</span></div>
                <input type="radio" name="planChangeMode" value="carry" checked={planChangeMode === 'carry'} onChange={() => setPlanChangeMode('carry')} />
              </label>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function ClientsPage({ user, pendingClientAction, onConsumePendingClientAction, onRenewalCompleted, onReturnToOrigin }) {
  const { t } = useTranslation();
  const { clients, routes, plans, drivers, settings, currentDate, days, saveClients, deleteClients, showNotice, loading } = useOperations();
  // dispatchStatus() necesita el día real (con su laborable/procesado); si todavía no tiene…
  const dayInfo = days[currentDate] || { laborable: true };
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [activeAddressId, setActiveAddressId] = useState('');
  const [schedule, setSchedule] = useState([]);
  // Conflicto de "Orden de entrega" dentro del formulario: "correr a los siguientes" se aplica
  // recién al Guardar, así cancelar el formulario no deja movidos a otros clientes sin motivo.
  const [orderConflict, setOrderConflict] = useState(null);
  const [orderShift, setOrderShift] = useState(null);
  // Plan elegido en el <select> de "Plan asignado" al CREAR un cliente nuevo (los clientes…
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [returnDateValue, setReturnDateValue] = useState('');
  const [renewing, setRenewing] = useState(null);
  // Si "Renovar"/"Añadir nuevo plan" se apretó DESDE ADENTRO del modal de Editar cliente (no…
  const [reopenEditAfterRenew, setReopenEditAfterRenew] = useState(false);
  // Si se llegó a editar/renovar este cliente desde un botón de OTRA pantalla (Día de trabajo…
  const [returnOrigin, setReturnOrigin] = useState(null);
  // true mientras se pasa de "Editar cliente" a "Renovar"/"Añadir nuevo plan": el modal de
  // editar se cierra por dentro (dialog nativo) para abrir el de renovar, pero eso NO es un
  // cierre real -- si se tratara como cierre real, mandaría de vuelta a Notas/Día de trabajo a
  // mitad de camino y, peor, esa vuelta atrás disparaba el cierre de TODOS los diálogos
  // abiertos (incluido el que recién se estaba abriendo), lo que en varios navegadores dejaba
  // la pantalla bloqueada, sin poder tocar nada.
  const switchingToRenewRef = useRef(false);
  const canEdit = canManage(user?.role, settings.customRoles, 'clients');
  const isDriver = user?.role === 'driver';
  const myRoutes = myRouteIds(user, drivers);
  const menuItems = settings.menuItems || [];
  const scheduleLocked = isPagePremiumLocked('weeklySchedule', settings.premiumLockedPages) && settings.plan !== 'premium';

  function routeName(id) { return routes.find((r) => r.id === id)?.name || t('panel.clients.noRoute'); }
  function planName(id) { return plans.find((p) => p.id === id)?.name || t('panel.clients.noPlan'); }

  // Pedido 13 sep: faltaba una forma de sacarle el plan a un cliente sin tener que borrar y…
  function removePlan(c) {
    if (!window.confirm(t('panel.clients.removePlanConfirm', { plan: planName(c.planId), name: c.name }))) return;
    // Sin plan ni días el cliente queda esperando renovación: se limpia también cualquier
    // estado/fecha de una pausa o programación anterior para que no quede "Programado" colgado.
    const updated = { ...c, planId: '', paidDays: 0, consumedDays: 0, items: {}, status: 'Retorno pendiente', returnDate: '', pauseStart: '', pauseDates: [] };
    saveClients([updated]);
    setEditing(updated);
    setSelectedPlanId('');
    setReturnDateValue('');
    showNotice(t('panel.clients.planRemovedNotice', { name: c.name }));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Plan quitado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: { planAnterior: planName(c.planId) } });
  }
  function driverName(id) { const d = drivers.find((x) => x.id === id); return d ? `${d.firstName} ${d.lastName}` : t('panel.clients.unassigned'); }

  const scope = isDriver ? clients.filter((c) => myRoutes.includes(effectiveRouteId(c, currentDate))) : clients;
  const q = search.toLowerCase();
  const list = scope
    .filter((c) => !routeFilter || effectiveRouteId(c, currentDate) === routeFilter)
    .filter((c) => !q || [c.name, c.carnet, ...(c.addresses || []).map((a) => a.address), c.phone1, c.phone2, routeName(effectiveRouteId(c, currentDate)), planName(c.planId), driverName(c.driverId), dispatchStatus(c, currentDate, dayInfo), c.specialDiet, c.specialDietSnacks].join(' ').toLowerCase().includes(q));

  function openEdit(c) {
    setEditing(c || {});
    setAddresses(c?.addresses?.length ? c.addresses : []);
    setActiveAddressId(c?.activeAddressId || c?.addresses?.[0]?.id || '');
    setSchedule(c?.schedule?.length ? c.schedule : []);
    setSelectedPlanId(c?.planId || '');
    setReturnDateValue(c?.returnDate || '');
  }

  // Mismo mecanismo que en Día de trabajo, pero aplicado sobre el formulario sin guardar todavía
  function askOrderConflict({ index, addressId, value, routeId, prevValue }) {
    const conflict = clients.some((x) => x.id !== editing?.id && dispatchStatus(x, currentDate, dayInfo) === 'Activo'
      && effectiveRouteId(x, currentDate) === routeId && String(effectiveOrder(x, currentDate)) === value);
    if (conflict) setOrderConflict({ index, addressId, value, routeId, prevValue });
  }

  function resolveOrderConflict(choice) {
    const { index, value, prevValue, routeId, addressId } = orderConflict;
    if (choice === 'cancel') {
      setAddresses((prev) => prev.map((a, i) => (i === index ? { ...a, order: prevValue } : a)));
    } else if (choice === 'shift') {
      setOrderShift({ addressId, value, routeId });
    }
    // 'duplicate': el número ya quedó escrito en la fila, no hay que correr a nadie
    setOrderConflict(null);
  }

  // Sin fecha de retorno, un cliente "Programado" pasaría a quedar sin fecha para reactivarse: igual que
  // al borrarla en Día de trabajo, pasa a "Pausado". (En iPhone/iPad el selector de fecha no puede borrarla.)
  function clearReturnDate() {
    setReturnDateValue('');
    const statusSelect = document.getElementById('client-status-select');
    if (statusSelect && statusSelect.value === 'Programado') statusSelect.value = 'Pausado';
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const items = {};
    menuItems.forEach(({ key }) => { items[key] = n(data[`item_${key}`]); delete data[`item_${key}`]; });
    if (data.status !== 'Programado' && data.status !== 'Pausado') data.returnDate = '';
    // Igual que en togglePause: si desde este formulario se elige a mano cualquier estado que…
    if (data.status !== 'Pausado') { data.pauseStart = ''; data.pauseDates = []; }
    const resolvedAddresses = await Promise.all(addresses.filter((a) => a.address.trim()).map(resolveShortMapsLinkIfNeeded));
    // `_coordsDraft` es un campo interno solo para mientras se escribe a mano en el campo de…
    const finalAddresses = resolvedAddresses.map(({ _coordsDraft, ...a }) => a);
    const finalAddressIds = new Set(finalAddresses.map((a) => a.id));
    const finalSchedule = schedule.filter((row) => row.days.length && finalAddressIds.has(row.addressId));
    const isNew = !editing?.id;
    const activeAddr = finalAddresses.find((a) => a.id === activeAddressId) || finalAddresses[0];
    const c = {
      ...editing, ...data, items,
      addresses: finalAddresses,
      schedule: scheduleLocked ? editing?.schedule || [] : finalSchedule,
      activeAddressId: activeAddr?.id || '',
      routeId: activeAddr?.routeId || editing?.routeId || '',
      id: editing?.id || uid('c'),
    };
    saveClients([c]);
    if (orderShift) {
      // Se corre a los demás solo si el número elegido sigue siendo el que se guarda
      const row = finalAddresses.find((a) => a.id === orderShift.addressId);
      if (row && String(row.order ?? '').trim() === orderShift.value) {
        const shifted = shiftOrdersFrom(clients, orderShift.routeId, currentDate, Number(orderShift.value), c.id, dayInfo);
        if (shifted.length) saveClients(shifted);
      }
      setOrderShift(null);
    }
    showNotice(t('panel.clients.clientSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Cliente creado' : 'Cliente editado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: {} });
    // Si se llegó acá desde otra pantalla (Día de trabajo o Notas), se vuelve exactamente a esa…
    if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
  }

  function handleDelete(c) {
    if (!confirm(t('panel.clients.deleteConfirm', { name: c.name }))) return;
    deleteClients([c.id]);
    showNotice(t('panel.clients.clientDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Cliente eliminado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: {} });
  }

  function togglePause(c) {
    const current = dispatchStatus(c, currentDate, dayInfo);
    // Al reactivar hay que limpiar TAMBIÉN pauseDates (no solo pauseStart): si el cliente había…
    saveClients([{ ...c, status: current === 'Pausado' ? 'Activo' : 'Pausado', pauseStart: current === 'Pausado' ? '' : currentDate, pauseDates: current === 'Pausado' ? [] : (c.pauseDates || []) }]);
    showNotice(current === 'Pausado' ? t('panel.clients.clientActivated') : t('panel.clients.clientPaused'));
  }

  // Abre el modal de renovar/añadir plan; si el formulario de editar cliente estaba abierto…
  function openRenew(c, mode = 'renew') {
    switchingToRenewRef.current = !!editing;
    setReopenEditAfterRenew(!!editing);
    setEditing(null);
    setRenewing({ client: c, mode });
  }

  // Permite que otras pantallas (p. ej. Notas) pidan abrir la edición o la renovación de un…
  useEffect(() => {
    if (!pendingClientAction || loading) return;
    const c = clients.find((x) => x.id === pendingClientAction.clientId);
    if (c) {
      setReturnOrigin(pendingClientAction.origin || 'notes');
      if (pendingClientAction.action === 'renew') openRenew(c, 'renew');
      else openEdit(c);
    } else {
      showNotice(t('panel.clients.clientNotFound'), true);
    }
    onConsumePendingClientAction?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClientAction, loading]);

  async function confirmRenew({ planId, days, planChangeMode, samePlan }) {
    const c = renewing.client;
    // La cuenta (paidDays/pendingPlan/items/reactivar pausado) ya no se hace acá: vive en la…
    const result = await rpc('staff_aplicar_renovacion', {
      p_token: getSessionToken(), p_client_id: c.id, p_plan_id: samePlan ? '' : planId, p_dias: days,
      p_modo: planChangeMode || 'immediate',
    });
    if (!result) { showNotice(t('panel.clients.renewFailed'), true); return; }
    const updated = { ...result, id: c.id };
    saveClients([updated]);
    showNotice(samePlan ? t('panel.clients.planRenewedNotice', { name: c.name }) : t('panel.clients.newPlanAssignedNotice', { name: c.name }));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: samePlan ? 'Cliente renovado' : 'Nuevo plan asignado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: { plan: planName(updated.planId), diasAgregados: days, modo: samePlan ? 'mismo-plan' : planChangeMode } });
    // Guarda los datos de esta renovación para que, si el staff viene desde una nota de…
    onRenewalCompleted?.(c.id, { kind: samePlan ? 'renovacion' : 'compra', planName: planName(updated.planId), days, clientName: c.name, phone: c.phone1 });
    setRenewing(null);
    // Si se llegó a "Renovar"/"Añadir nuevo plan" DESDE DENTRO de Editar cliente, se vuelve ahí
    // (el returnOrigin de Notas/Día de trabajo, si hay, se aplica recién cuando ese modal se
    // cierre de verdad). Si se apretó directo desde la tabla o desde otra pantalla, se vuelve
    // a esa pantalla.
    if (reopenEditAfterRenew) { openEdit(updated); }
    else if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
    setReopenEditAfterRenew(false);
  }

  // allColumns (antes se llamaba "columns") -- ahora se le pasa COMPLETA a DataTable junto…
  const allColumns = [
    { key: 'order', label: t('panel.clients.colOrder'), sortValue: (c) => n(effectiveOrder(c, currentDate)), render: (c) => n(effectiveOrder(c, currentDate)) || '' },
    { key: 'name', label: t('panel.clients.colClientCarnet'), sortValue: (c) => c.name, render: (c) => (<><b>{c.name}</b><br /><small className="muted">CI: {c.carnet || '—'}</small></>) },
    { key: 'route', label: t('panel.common.route'), sortValue: (c) => routeName(effectiveRouteId(c, currentDate)), render: (c) => routeName(effectiveRouteId(c, currentDate)) },
    { key: 'address1', label: t('panel.common.address'), sortValue: (c) => (c.addresses || []).map((a) => a.address).filter(Boolean).join(', '), render: (c) => (c.addresses || []).map((a) => a.address).filter(Boolean).join(', ') || '—' },
    { key: 'notes', label: t('panel.common.notes'), sortValue: (c) => effectiveNotes(c, currentDate), render: (c) => effectiveNotes(c, currentDate) || '—' },
    { key: 'maps', label: 'Google Maps', sortable: false, render: (c) => { const link = effectiveMaps(c, currentDate); return link ? <a href={link} target="_blank" rel="noopener">{t('panel.clients.openMap')}</a> : '—'; } },
    { key: 'phone1', label: t('panel.common.phone'), sortValue: (c) => c.phone1, render: (c) => { const link = clientWaLink(c.phone1); return link ? <a href={link} target="_blank" rel="noopener" title={t('panel.clients.openWhatsappChat')}>{c.phone1}</a> : (c.phone1 || '—'); } },
    { key: 'plan', label: t('panel.common.plan'), sortValue: (c) => planName(c.planId), render: (c) => planName(c.planId) },
    { key: 'driver', label: t('panel.common.driver'), sortValue: (c) => driverName(c.driverId), render: (c) => driverName(c.driverId) },
    { key: 'status', label: t('panel.common.status'), sortValue: (c) => dispatchStatus(c, currentDate, dayInfo), render: (c) => <span className={`badge ${statusBadgeClass(dispatchStatus(c, currentDate, dayInfo))}`}>{dispatchStatus(c, currentDate, dayInfo)}</span> },
    { key: 'paidDays', label: t('panel.clients.paidDays'), sortValue: (c) => n(c.paidDays), render: (c) => n(c.paidDays) },
    { key: 'consumedDays', label: t('panel.clients.consumedDaysCol'), sortValue: (c) => n(c.consumedDays), render: (c) => n(c.consumedDays) },
    { key: 'specialDiet', label: t('panel.clients.specialDiet'), sortValue: (c) => c.specialDiet || '', render: (c) => c.specialDiet || '—' },
    { key: 'specialDietSnacks', label: t('panel.clients.specialDietSnacks'), sortValue: (c) => c.specialDietSnacks || '', render: (c) => c.specialDietSnacks || '—' },
    { key: 'id', label: t('panel.common.actions'), sortable: false, render: (c) => canEdit ? (
      <>
        <button className={`icon-btn ${dispatchStatus(c, currentDate, dayInfo) === 'Pausado' ? 'success' : 'orange'}`} onClick={() => togglePause(c)}>{dispatchStatus(c, currentDate, dayInfo) === 'Pausado' ? t('panel.clients.activate') : t('panel.clients.pause')}</button>
        <button className="icon-btn warning" onClick={() => openRenew(c, 'renew')}>{t('panel.clients.renew')}</button>
        <button className="icon-btn info" onClick={() => openEdit(c)}>{t('panel.common.edit')}</button>
        <button className="icon-btn delete" onClick={() => handleDelete(c)}>{t('panel.clients.remove')}</button>
      </>
    ) : '—' },
  ];

  if (loading) return <p className="muted">{t('panel.clients.loadingClients')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.clients')}</h1><p>{t('panel.clients.pageSubtitle')}</p></div>
        {canEdit && (
          <div className="head-actions">
            <button type="button" className="info" onClick={() => setColumnsOpen(true)}>{t('panel.common.columns')}</button>
            <button className="primary" onClick={() => openEdit(null)}>+ {t('panel.clients.addClient')}</button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <input className="search" id="clients-search" name="clients-search" autoComplete="off" placeholder={t('panel.clients.searchClients')} value={search} onChange={(e) => setSearch(e.target.value)} />
        {!isDriver && (
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
            <option value="">{t('panel.clients.allRoutes')}</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <span className="muted">{t('panel.clients.clientsCount', { count: list.length })}</span>
      </div>
      <DataTable allColumns={allColumns} rows={list} emptyText={t('panel.clients.noClients')} resizeGroup="clients" userId={user?.id} columnsOpen={columnsOpen} onColumnsOpenChange={setColumnsOpen} />

      <Modal title={editing?.id ? t('panel.clients.editClient') : t('panel.clients.addClient')} open={!!editing} onClose={() => {
          setEditing(null);
          setOrderConflict(null);
          setOrderShift(null);
          if (switchingToRenewRef.current) { switchingToRenewRef.current = false; return; }
          if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
        }} onSubmit={handleSubmit}>
        {editing && (() => {
          const isExisting = !!editing.id;
          const remaining = Math.max(0, n(editing.paidDays) - n(editing.consumedDays));
          const pendingPlan = editing.pendingPlan;
          const pendingDaysLeftOld = pendingPlan ? Math.max(0, n(pendingPlan.activateAtConsumedDays) - n(editing.consumedDays)) : 0;
          const pendingDaysNew = pendingPlan ? Math.max(0, n(editing.paidDays) - n(pendingPlan.activateAtConsumedDays)) : 0;
          return (
            <div className="form-grid">
              <div className="form-section tone-primary">
                <div className="form-section-title">🧾 {t('panel.clients.clientDataSection')}</div>
                <div className="form-section-grid">
                  <label>{t('panel.clients.fullName')} *<input name="name" required defaultValue={editing.name} /></label>
                  <label>{t('panel.clients.idCard')} *<input name="carnet" required defaultValue={editing.carnet} /></label>
                  <label>{t('panel.clients.phone1')} *<input name="phone1" required autoComplete="tel" defaultValue={editing.phone1} /></label>
                  <label>{t('panel.clients.phone2')}<input name="phone2" autoComplete="tel" defaultValue={editing.phone2} /></label>
                </div>
              </div>

              <div className="form-section tone-accent">
                <div className="form-section-title">📍 {t('panel.clients.addressesSection')}</div>
                <p className="muted" style={{ margin: '2px 0 8px' }}>{t('panel.clients.addressesHint')}</p>
                <AddressRows addresses={addresses} setAddresses={setAddresses} activeId={activeAddressId} setActiveId={setActiveAddressId} routes={routes} onOrderChange={askOrderConflict} />
              </div>

              <div className="form-section tone-warning">
                <div className="form-section-title">🍽️ {t('panel.clients.planStatusSection')}</div>
                {returnDateValue && (
                  <div className="return-date-notice">
                    <span>📅 {t('panel.clients.scheduledReturnDate')} <b>{fmtDate(returnDateValue)}</b></span>
                    <button type="button" className="danger" onClick={clearReturnDate}>{t('panel.clients.removeReturnDate')}</button>
                  </div>
                )}
                <div className="form-section-grid">
                  <div className="wide">
                    {isExisting ? (
                      <>
                        <div className="plan-summary-row">
                          <div className="plan-option-info">
                            <b>{t('panel.clients.assignedPlan', { name: planName(editing.planId) })}</b>
                            <span className="muted">{n(editing.paidDays) ? t('panel.clients.daysConsumedSummary', { consumed: n(editing.consumedDays), paid: n(editing.paidDays), remaining }) : t('panel.clients.noDaysLoaded')}</span>
                          </div>
                          <div className="plan-option-actions">
                            <button type="button" className="warning" onClick={() => openRenew(editing, 'renew')}>🔄 {t('panel.clients.renew')}</button>
                            <button type="button" className="primary" onClick={() => openRenew(editing, 'change')}>➕ {t('panel.clients.addNewPlan')}</button>
                            {editing.planId && <button type="button" className="danger" onClick={() => removePlan(editing)}>🗑️ {t('panel.clients.deletePlan')}</button>}
                          </div>
                        </div>
                        <p className="muted" style={{ margin: '4px 0 0' }}>{t('panel.clients.planButtonsHint')}</p>
                        <input type="hidden" name="planId" value={editing.planId || ''} />
                      </>
                    ) : (
                      <label>{t('panel.clients.assignedPlanLabel')}
                        <select name="planId" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                          <option value="">{t('panel.clients.noPlan')}</option>
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  {pendingPlan && (
                    <div className="wide plan-alert-box">
                      <div className="plan-option-info">
                        <b>{t('panel.clients.pendingPlanTitle')}</b>
                        <span className="muted">{t('panel.clients.pendingPlanDesc', { daysLeft: pendingDaysLeftOld, currentPlan: planName(editing.planId), newPlan: planName(pendingPlan.planId), daysNew: pendingDaysNew, total: n(editing.paidDays) })}</span>
                      </div>
                    </div>
                  )}
                  <label>{t('panel.clients.planStatusLabel')}
                    <select name="status" id="client-status-select" key={`status-${editing.status || 'Activo'}`} defaultValue={editing.status || 'Activo'}>
                      {['Activo', 'Pausado', 'Retorno pendiente', 'Programado'].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label>{t('panel.clients.startDate')}<div className="date-input-wrap"><input name="startDate" type="date" defaultValue={editing.startDate} /></div></label>
                  <label>{t('panel.clients.returnDate')}<div className="date-input-wrap"><input name="returnDate" type="date" value={returnDateValue} onChange={(e) => setReturnDateValue(e.target.value)} />{returnDateValue && <button type="button" className="icon-btn delete" title={t('panel.clients.removeReturnDateAria')} aria-label={t('panel.clients.removeReturnDateAria')} onClick={clearReturnDate}>✕</button>}</div></label>
                  {/* Las keys incluyen el valor guardado: son inputs no controlados y sin esto */}
                  {/* quedaban mostrando el número viejo tras "Borrar plan" o una renovación. */}
                  <label>{t('panel.clients.paidDays')}<input key={`paidDays-${selectedPlanId}-${n(editing.paidDays)}`} name="paidDays" type="number" min="0" defaultValue={editing.paidDays != null ? n(editing.paidDays) : (isExisting ? 0 : (n(plans.find((p) => p.id === selectedPlanId)?.serviceDays) || 0))} /></label>
                  <label>{t('panel.clients.consumedDaysLabel')}<input key={`consumedDays-${n(editing.consumedDays)}`} name="consumedDays" type="number" min="0" defaultValue={n(editing.consumedDays)} /></label>
                  <label>{t('panel.clients.careersPerDelivery')}
                    <select name="career" defaultValue={String(n(editing.career) || 1)}>
                      <option value="1">{t('panel.clients.careerShort')} (1)</option><option value="2">{t('panel.clients.careerLong')} (2)</option><option value="3">{t('panel.clients.careerVeryLong')} (3)</option>
                    </select>
                  </label>
                  <label>{t('panel.clients.bagsCount')}<input name="bags" type="number" min="0" defaultValue={editing.bags != null ? n(editing.bags) : (isExisting ? 0 : 1)} /></label>
                  <label className="wide">{t('panel.clients.specialDiet')}<AutoTextarea name="specialDiet" defaultValue={editing.specialDiet} /></label>
                  <label className="wide">{t('panel.clients.specialDietSnacks')}<AutoTextarea name="specialDietSnacks" defaultValue={editing.specialDietSnacks} /></label>
                </div>
              </div>

              <div className="form-section tone-accent">
                <div className="form-section-title">🥗 {t('panel.clients.itemsIncluded')}</div>
                <p className="muted" style={{ margin: '2px 0 8px' }}>{t('panel.clients.itemsHint')}</p>
                <div className="form-section-grid items-grid" key={`items-${selectedPlanId}-${editing.planId}-${JSON.stringify(editing.items || {})}`}>
                  {/* La key incluye editing.items: los inputs usan defaultValue (no controlados),… */}
                  {/* así que sin esto no se refrescaban solos al renovar/cambiar de plan hasta… */}
                  {/* cerrar y volver a abrir "Editar cliente". */}
                  {menuItems.map(({ key, label }) => (
                    <label key={key}>{label}<input type="number" min="0" name={`item_${key}`} defaultValue={n(editing.items?.[key] ?? plans.find((p) => p.id === selectedPlanId)?.items?.[key])} /></label>
                  ))}
                </div>
              </div>

              <div className="form-section tone-danger">
                <div className="form-section-title">🗓️ {t('panel.clients.weeklySchedule')} {scheduleLocked && <span className="badge warn" style={{ marginLeft: 6 }}>{t('panel.clients.premiumFeature')}</span>}</div>
                {scheduleLocked ? (
                  <p className="muted">{t('panel.clients.premiumLockedMsg')}</p>
                ) : (
                  <>
                    <p className="muted" style={{ margin: '2px 0 8px' }}>{t('panel.clients.weeklyScheduleHint')}</p>
                    <ScheduleRows schedule={schedule} setSchedule={setSchedule} addresses={addresses.filter((a) => a.address.trim())} />
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Afuera del formulario de cliente: un <dialog> adentro de un <form> anida un segundo <form> */}
      <Modal title={t('panel.clients.duplicateOrderTitle')} open={!!orderConflict} onClose={() => resolveOrderConflict('cancel')} hideSave>
        {orderConflict && (
          <>
            <p style={{ marginTop: 0 }}>
              <Trans i18nKey="panel.clients.duplicateOrderMessage" values={{ value: orderConflict.value }} components={{ b: <b /> }} />
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="primary" onClick={() => resolveOrderConflict('shift')}>{t('panel.clients.shiftOrders')}</button>
              <button type="button" className="orange" onClick={() => resolveOrderConflict('duplicate')}>{t('panel.clients.keepBothOrders', { value: orderConflict.value })}</button>
              <small className="muted">{t('panel.clients.shiftAppliesOnSave')}</small>
            </div>
          </>
        )}
      </Modal>

      {renewing && (
        <RenewPlanModal
          client={renewing.client}
          mode={renewing.mode}
          plans={plans}
          onClose={() => {
            setRenewing(null);
            if (reopenEditAfterRenew) { openEdit(renewing.client); }
            else if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
            setReopenEditAfterRenew(false);
          }}
          onConfirm={confirmRenew}
        />
      )}
    </section>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveOrder, effectiveMaps, effectiveNotes, dispatchStatus, statusBadgeClass, myRouteIds, clientWaLink, shiftOrdersFrom } from '../../../services/dispatchHelpers';
import { canManage, isPagePremiumLocked } from '../../../services/panelAuth';
import { resolveShortMapsLinkIfNeeded } from '../../../services/resolveMapsLink';
import Modal from '../Modal';
import DataTable from '../DataTable';

const WEEKDAYS = [{ v: 1, l: 'Lun' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mié' }, { v: 4, l: 'Jue' }, { v: 5, l: 'Vie' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' }];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Campo de texto que crece con el contenido en vez de quedarse fijo en
// una sola línea y esconder el resto adentro (con scroll horizontal
// invisible a simple vista) -- pedido 14 sep: en Dirección, Link de Maps,
// Observaciones y Dieta especial a veces hay bastante para escribir y no
// se veía completo. `rows={1}` es solo el punto de partida antes de que
// el efecto mida el contenido real; se recalcula en cada tecla/pegado
// (onInput) y también de entrada, para que un valor ya cargado (al abrir
// un cliente existente) aparezca con su alto correcto sin que haga falta
// tocarlo primero.
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

// Filas de direcciones editables dentro del formulario de cliente. Vive
// como su propio estado local (no se guarda hasta apretar "Guardar" del
// modal) para que agregar/quitar filas sea instantáneo.
function AddressRows({ addresses, setAddresses, activeId, setActiveId, routes, clients, currentDate, dayInfo, saveClients, selfId }) {
  function update(i, field, value) {
    setAddresses(addresses.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
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

  // Se resuelve al salir del campo de Maps, no recién al Guardar -- así
  // "Coordenadas" (lo que usa el mapa para ubicar al cliente) aparece de una.
  async function handleMapsBlur(i) {
    const addr = addresses[i];
    if (!addr) return;
    if (!addr.maps) {
      // BUG (reportado 13 sep): al borrar el link, las coordenadas viejas
      // se quedaban pegadas. Solo se limpian si vinieron de un link
      // resuelto antes -- si se cargaron a mano, se respetan.
      if (addr.mapsResolvedFrom) updateAddr(i, { lat: null, lng: null, mapsResolvedFrom: null, _coordsDraft: undefined });
      return;
    }
    const resolved = await resolveShortMapsLinkIfNeeded(addr);
    // Guarda mapsResolvedFrom junto con lat/lng: sin eso, el formulario
    // volvería a pedir la resolución a la función de Supabase cada vez
    // que se guarda, aunque el link no haya cambiado.
    if (resolved.lat != null && (resolved.lat !== addr.lat || resolved.lng !== addr.lng || resolved.mapsResolvedFrom !== addr.mapsResolvedFrom)) {
      // BUG (reportado 13 sep, "dice resuelto en verde pero no rellena
      // nada"): el tilde verde lee `a.lat` (que sí se actualizaba bien),
      // pero el campo de texto de Coordenadas prioriza `_coordsDraft`
      // por sobre `lat/lng` -- si esa persona había escrito algo a mano
      // ahí antes (o el campo había quedado en '' por tocarlo sin
      // querer), `_coordsDraft` se quedaba pegado y tapaba el valor
      // recién resuelto. Hay que limpiarlo acá también, no solo cuando
      // se escribe manualmente (handleCoordsChange ya lo hacía bien).
      updateAddr(i, { lat: resolved.lat, lng: resolved.lng, mapsResolvedFrom: resolved.mapsResolvedFrom, _coordsDraft: undefined });
    }
  }

  // "Coordenadas" se edita como un solo texto "lat, lng" (más cómodo
  // para copiar/pegar desde Google Maps que dos campos separados). Tolera
  // espacios de más; si no se puede leer como dos números, no rompe nada,
  // simplemente no actualiza lat/lng todavía (se puede seguir editando).
  function formatCoords(a) {
    return a.lat != null && a.lng != null ? `${a.lat}, ${a.lng}` : '';
  }
  function handleCoordsChange(i, text) {
    const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    updateAddr(i, m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]), _coordsDraft: undefined } : { _coordsDraft: text });
  }

  // Conflicto de "Orden de entrega": mismo mecanismo que Día de trabajo
  // (handleFieldBlur/resolveOrderConflict de DispatchPage.jsx). Solo
  // compara contra clientes ACTIVOS de la MISMA ruta (cada ruta tiene su
  // propio orden) -- incluida "Ruta abierta" (routeId === ''), que es una
  // ruta válida como cualquier otra, no "sin ruta". `focusValue` guarda
  // con qué número se entró al campo, para poder devolverlo tal cual si
  // se cancela -- el input es controlado (value={a.order}), así que al
  // momento del blur `a.order` ya es el valor NUEVO, no sirve para
  // "volver atrás".
  const [orderConflict, setOrderConflict] = useState(null); // { index, value, routeId, prevValue }
  const focusValue = useRef({});

  function handleOrderBlur(i) {
    const addr = addresses[i];
    const trimmed = String(addr.order ?? '').trim();
    const prevValue = focusValue.current[i] ?? '';
    if (trimmed === '' || trimmed === prevValue || !clients) return;
    const conflicts = clients.filter((x) => x.id !== selfId && dispatchStatus(x, currentDate, dayInfo, false) === 'Activo' && effectiveRouteId(x, currentDate) === addr.routeId && String(effectiveOrder(x, currentDate)) === trimmed);
    if (conflicts.length) setOrderConflict({ index: i, value: trimmed, routeId: addr.routeId, prevValue });
  }

  function resolveOrderConflict(choice) {
    const { index, value, routeId, prevValue } = orderConflict;
    if (choice === 'cancel') {
      update(index, 'order', prevValue);
    } else if (choice === 'shift') {
      const shifted = shiftOrdersFrom(clients, routeId, currentDate, Number(value), selfId, dayInfo);
      if (shifted.length) saveClients(shifted);
    }
    // 'duplicate': no hace falta hacer nada más, el valor ya quedó en `a.order`.
    setOrderConflict(null);
  }

  return (
    <>
      {addresses.map((a, i) => (
        <div key={a.id} className="address-row">
          <button type="button" className="icon-btn delete address-row-remove" onClick={() => remove(i)} aria-label="Eliminar esta dirección" title="Eliminar esta dirección">×</button>

          <label className="address-field address-field-wide">
            <span>Dirección</span>
            <AutoTextarea id={`addr-address-${a.id}`} name={`addr-address-${a.id}`} placeholder="Ej. Av. Busch #123, edif. Torre Azul, depto 4B" value={a.address} onChange={(e) => update(i, 'address', e.target.value)} />
          </label>

          <label className="address-field">
            <span>Ruta</span>
            <select id={`addr-route-${a.id}`} name={`addr-route-${a.id}`} value={a.routeId} onChange={(e) => update(i, 'routeId', e.target.value)}>
              <option value="">Ruta abierta</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>

          {/* Orden y Observaciones: mismos campos que ya se pueden editar
              desde Día de trabajo (uno por dirección, con la misma
              prioridad de effectiveOrder/effectiveNotes) -- ahora también
              editables acá para no depender siempre de entrar a Día de
              trabajo para fijar el valor inicial de un cliente nuevo. */}
          <label className="address-field">
            <span>Orden de entrega</span>
            <input id={`addr-order-${a.id}`} name={`addr-order-${a.id}`} placeholder="Ej. 1" type="number" value={a.order ?? ''} onFocus={() => { focusValue.current[i] = String(a.order ?? ''); }} onChange={(e) => update(i, 'order', e.target.value)} onBlur={() => handleOrderBlur(i)} />
          </label>

          <label className="address-field address-field-wide">
            <span>Link de Google Maps</span>
            <AutoTextarea id={`addr-maps-${a.id}`} name={`addr-maps-${a.id}`} autoComplete="off" placeholder="https://maps.app.goo.gl/…" value={a.maps} onChange={(e) => update(i, 'maps', e.target.value)} onBlur={() => handleMapsBlur(i)} />
          </label>

          <label className="address-field">
            <span>Coordenadas {a.lat != null && <span className="address-coords-ok" title="Esto es lo que usa el mapa para ubicar al cliente">✓ resuelto</span>}</span>
            <input
              id={`addr-coords-${a.id}`}
              name={`addr-coords-${a.id}`}
              autoComplete="off"
              placeholder="Se completa solo al pegar el link"
              value={a._coordsDraft !== undefined ? a._coordsDraft : formatCoords(a)}
              onChange={(e) => handleCoordsChange(i, e.target.value)}
            />
          </label>

          <label className="address-field address-field-wide">
            <span>Observaciones para el repartidor</span>
            <AutoTextarea id={`addr-notes-${a.id}`} name={`addr-notes-${a.id}`} placeholder="Ej. dejar en portería, tocar timbre 2" value={a.notes ?? ''} onChange={(e) => update(i, 'notes', e.target.value)} />
          </label>
        </div>
      ))}
      <button type="button" className="outline" onClick={add}>+ Añadir dirección</button>
      {addresses.length > 1 && (
        <label style={{ marginTop: 10 }}>Dirección activa (la que se usa por defecto)
          <select id="active-address" name="active-address" value={activeId} onChange={(e) => setActiveId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.address || 'Sin nombre'}</option>)}
          </select>
        </label>
      )}
      {orderConflict && (
        <dialog className="panel-modal" open onClose={() => resolveOrderConflict('cancel')}>
          <div className="modal-head"><h2>Número de orden repetido</h2></div>
          <div className="modal-body">
            <p style={{ marginTop: 0 }}>Ya hay otro cliente activo con el número <b>{orderConflict.value}</b> en esta ruta. ¿Qué hacés?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="primary" onClick={() => resolveOrderConflict('shift')}>Correr los siguientes un número (mantener la secuencia)</button>
              <button type="button" className="outline" onClick={() => resolveOrderConflict('duplicate')}>Dejar los dos con el número {orderConflict.value}</button>
              <button type="button" className="outline" onClick={() => resolveOrderConflict('cancel')}>Cancelar</button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

// Horario semanal: franjas de días (ej. "lunes, miércoles y viernes") que
// apuntan a una de las direcciones ya cargadas arriba. Si un cliente
// tiene esto configurado y hoy no cae en ninguna franja, aparece como
// "Fuera de horario" en vez de "Activo" -- sin que nadie tenga que
// pausarlo/reactivarlo a mano cada semana.
function ScheduleRows({ schedule, setSchedule, addresses }) {
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
    return <p className="muted">Agrega al menos una dirección arriba antes de configurar el horario semanal.</p>;
  }

  return (
    <>
      {schedule.map((row, i) => (
        <div key={i} className="schedule-row">
          <div className="schedule-row-days">
            {WEEKDAYS.map((w) => (
              <label key={w.v} className="schedule-day-check">
                <span>{w.l}</span>
                <input type="checkbox" id={`schedule-${i}-day-${w.v}`} name={`schedule-${i}-day-${w.v}`} checked={row.days.includes(w.v)} onChange={() => toggleDay(i, w.v)} />
              </label>
            ))}
          </div>
          <select id={`schedule-${i}-address`} name={`schedule-${i}-address`} value={row.addressId} onChange={(e) => update(i, { addressId: e.target.value })}>
            {addresses.map((a, ai) => <option key={a.id} value={a.id}>{a.address || `Dirección ${ai + 1}`}</option>)}
          </select>
          <button type="button" className="icon-btn delete" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button type="button" className="outline" onClick={add}>+ Añadir franja</button>
      {schedule.length > 0 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Los días que no estén marcados en ninguna franja, el cliente queda como "Fuera de horario" en vez de "Activo".</p>}
    </>
  );
}

// Modal de "Renovar plan" / "Añadir nuevo plan": suma días al plan del
// cliente en vez de tener que editar a mano "Días pagados". Reproduce la
// misma lógica que el formulario clientForm() de panel.html: si es el
// mismo plan simplemente se acumulan los días; si es un plan distinto y
// todavía quedan días del plan actual, se pregunta si cambiar de
// inmediato o conservar los días actuales y encolar el nuevo plan
// (pendingPlan). En modo "Añadir nuevo plan" el selector arranca en
// blanco a propósito (antes elegía el primer plan distinto al actual sin
// que el usuario lo pidiera).
function RenewPlanModal({ client, mode, plans, onClose, onConfirm }) {
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
    if (!daysToAdd || daysToAdd < 1) { alert('Ingresa cuántos días agregar.'); return false; }
    return onConfirm({ planId: data.planId, days: daysToAdd, planChangeMode: data.planChangeMode || 'immediate', samePlan: !data.planId || data.planId === client.planId });
  }

  if (!client) return null;
  const planName = (id) => plans.find((p) => p.id === id)?.name || 'Sin plan';

  return (
    <Modal title={isChangeMode ? 'Añadir nuevo plan' : 'Renovar plan'} open={!!client} onClose={onClose} onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="wide plan-summary-row" style={{ margin: 0 }}>
          <div className="plan-option-info">
            <b>{client.name}</b>
            <span className="muted">Plan actual: {planName(client.planId)} · {hasRemainingBalance ? `le quedan ${remaining} día(s)` : 'sin días restantes (Retorno pendiente)'}</span>
          </div>
        </div>
        <label>{isChangeMode ? 'Nuevo plan' : 'Plan a renovar'}
          <select name="planId" value={planId} onChange={(e) => handlePlanChange(e.target.value)}>
            <option value="">{isChangeMode ? 'Elige un plan…' : 'Sin plan'}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Días a agregar *<input name="days" type="number" min="1" step="1" required value={days} onChange={(e) => setDays(e.target.value)} /></label>
        {showChoice && (
          <div className="wide">
            <div className="plan-options">
              <label className="plan-option" style={{ cursor: 'pointer' }}>
                <div className="plan-option-info"><b>Cambiar de inmediato</b><span className="muted">Se pierden los días restantes del plan actual; el nuevo plan y sus días empiezan a contar desde hoy.</span></div>
                <input type="radio" name="planChangeMode" value="immediate" checked={planChangeMode === 'immediate'} onChange={() => setPlanChangeMode('immediate')} />
              </label>
              <label className="plan-option" style={{ cursor: 'pointer' }}>
                <div className="plan-option-info"><b>Conservar los días actuales y sumar</b><span className="muted">Termina primero el plan actual y pasa al nuevo recién cuando se acaben esos días.</span></div>
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
  const { clients, routes, plans, drivers, settings, currentDate, days, saveClients, deleteClients, showNotice, loading } = useOperations();
  // dispatchStatus() necesita el día real (con su laborable/procesado);
  // si todavía no tiene un registro propio en `days`, se asume laborable
  // -- mismo criterio que usa DispatchPage.jsx.
  const dayInfo = days[currentDate] || { laborable: true };
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [activeAddressId, setActiveAddressId] = useState('');
  const [schedule, setSchedule] = useState([]);
  // Plan elegido en el <select> de "Plan asignado" al CREAR un cliente
  // nuevo (los clientes existentes no usan ese selector, cambian de plan
  // con los botones "Renovar"/"Añadir nuevo plan"). Antes ese <select>
  // era no controlado (`defaultValue`), así que elegir un plan ahí no
  // disparaba nada -- ni el autorrelleno de "Artículos incluidos" (que
  // el propio formulario prometía: "Se autorrellenan al elegir un plan
  // arriba"), ni los días pagados, ni la cantidad de bolsas. Bug
  // reportado 13 sep.
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [renewing, setRenewing] = useState(null); // { client, mode: 'renew'|'change' }
  // Si "Renovar"/"Añadir nuevo plan" se apretó DESDE ADENTRO del modal de
  // Editar cliente (no desde el botón de la fila en la lista), hay que
  // volver a abrir ese mismo modal al terminar (guardar o cancelar) en vez
  // de dejar al staff en la lista principal -- reportado 14 sep: "me saca
  // al menú principal en vez de dejarme seguir editando el formulario".
  const [reopenEditAfterRenew, setReopenEditAfterRenew] = useState(false);
  // Si se llegó a editar/renovar este cliente desde un botón de OTRA
  // pantalla (Día de trabajo o Notas), al terminar (guardar o cancelar)
  // hay que devolver al staff exactamente a esa misma pantalla -- no
  // siempre a Notas, aunque se haya originado en Día de trabajo. Guarda el
  // nombre de la pantalla de origen ('dispatch'/'notes') o null si se
  // entró directamente a Clientes (en cuyo caso no hay que navegar a
  // ningún lado al cerrar el formulario).
  const [returnOrigin, setReturnOrigin] = useState(null);
  const canEdit = canManage(user?.role, settings.customRoles, 'clients');
  const isDriver = user?.role === 'driver';
  const myRoutes = myRouteIds(user, drivers);
  const menuItems = settings.menuItems || [];
  const scheduleLocked = isPagePremiumLocked('weeklySchedule', settings.premiumLockedPages) && settings.plan !== 'premium';

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Sin ruta'; }
  function planName(id) { return plans.find((p) => p.id === id)?.name || 'Sin plan'; }

  // Pedido 13 sep: faltaba una forma de sacarle el plan a un cliente sin
  // tener que borrar y volver a crear el cliente entero. Reinicia
  // días/artículos porque ya no corresponden a ningún plan activo -- si
  // hace falta, se cargan de nuevo a mano.
  function removePlan(c) {
    if (!window.confirm(`¿Quitar el plan "${planName(c.planId)}" de ${c.name}? Se van a borrar los días pagados/consumidos y los artículos asignados.`)) return;
    const updated = { ...c, planId: '', paidDays: 0, consumedDays: 0, items: {} };
    saveClients([updated]);
    setEditing(updated);
    showNotice(`Plan quitado de ${c.name}.`);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Plan quitado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: { planAnterior: planName(c.planId) } });
  }
  function driverName(id) { return drivers.find((d) => d.id === id) ? `${drivers.find((d) => d.id === id).firstName} ${drivers.find((d) => d.id === id).lastName}` : 'Sin asignar'; }

  const scope = isDriver ? clients.filter((c) => myRoutes.includes(effectiveRouteId(c, currentDate))) : clients;
  const q = search.toLowerCase();
  const list = scope.filter((c) => !q || [c.name, c.carnet, ...(c.addresses || []).map((a) => a.address), c.phone1, routeName(c.routeId), planName(c.planId)].join(' ').toLowerCase().includes(q));

  function openEdit(c) {
    setEditing(c || {});
    setAddresses(c?.addresses?.length ? c.addresses : []);
    setActiveAddressId(c?.activeAddressId || c?.addresses?.[0]?.id || '');
    setSchedule(c?.schedule?.length ? c.schedule : []);
    setSelectedPlanId(c?.planId || '');
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const items = {};
    menuItems.forEach(({ key }) => { items[key] = n(data[`item_${key}`]); delete data[`item_${key}`]; });
    if (data.status !== 'Programado') data.returnDate = '';
    // Igual que en togglePause: si desde este formulario se elige a mano
    // cualquier estado que no sea "Pausado", hay que soltar pauseStart Y
    // pauseDates -- de lo contrario un cliente pausado "solo hoy" desde Día
    // de trabajo (pauseDates) o pausado "desde tal fecha" (pauseStart)
    // seguía viéndose Pausado pese al cambio manual, porque dispatchStatus()
    // revisa esos dos campos antes que status.
    if (data.status !== 'Pausado') { data.pauseStart = ''; data.pauseDates = []; }
    const resolvedAddresses = await Promise.all(addresses.filter((a) => a.address.trim()).map(resolveShortMapsLinkIfNeeded));
    // `_coordsDraft` es un campo interno solo para mientras se escribe a
    // mano en el campo de Coordenadas (ver AddressRows más abajo) -- si
    // se guardaba tal cual en la base, la próxima vez que se abriera este
    // cliente el campo de texto mostraba ese draft viejo (a veces una
    // simple string vacía) en vez de las coordenadas reales -- una de las
    // formas en que se producía el bug "dice resuelto en verde pero no
    // rellena nada" reportado el 13 sep.
    const finalAddresses = resolvedAddresses.map(({ _coordsDraft, ...a }) => a);
    const finalAddressIds = new Set(finalAddresses.map((a) => a.id));
    const finalSchedule = schedule.filter((row) => row.days.length && finalAddressIds.has(row.addressId));
    const isNew = !editing?.id;
    const c = {
      ...editing, ...data, items,
      addresses: finalAddresses,
      schedule: scheduleLocked ? editing?.schedule || [] : finalSchedule,
      activeAddressId: finalAddresses.find((a) => a.id === activeAddressId)?.id || finalAddresses[0]?.id || '',
      routeId: finalAddresses.find((a) => a.id === (finalAddresses.find((x) => x.id === activeAddressId)?.id || finalAddresses[0]?.id))?.routeId || editing?.routeId || '',
      id: editing?.id || uid('c'),
    };
    saveClients([c]);
    showNotice('Cliente guardado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Cliente creado' : 'Cliente editado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: {} });
    // Si se llegó acá desde otra pantalla (Día de trabajo o Notas), se
    // vuelve exactamente a esa misma pantalla -- p. ej. para que el staff
    // pueda marcar una nota como cumplida, o seguir donde estaba en Día de
    // trabajo sin tener que navegar de nuevo a mano.
    if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
  }

  function handleDelete(c) {
    if (!confirm(`¿Eliminar a ${c.name}?`)) return;
    deleteClients([c.id]);
    showNotice('Cliente eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Cliente eliminado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: {} });
  }

  function togglePause(c) {
    const current = dispatchStatus(c, currentDate, dayInfo, false);
    // Al reactivar hay que limpiar TAMBIÉN pauseDates (no solo pauseStart):
    // si el cliente había quedado pausado "solo por hoy" desde Día de
    // trabajo (Pausar hoy → agrega la fecha de hoy a pauseDates), esa fecha
    // seguía ganándole al status/pauseStart recién puestos acá, y el
    // cliente se veía "Pausado" hasta que cambiaba el día y la fecha ya no
    // coincidía. Ver dispatchStatus() en services/dispatchHelpers.js: revisa
    // pauseDates antes que status.
    saveClients([{ ...c, status: current === 'Pausado' ? 'Activo' : 'Pausado', pauseStart: current === 'Pausado' ? '' : currentDate, pauseDates: current === 'Pausado' ? [] : (c.pauseDates || []) }]);
    showNotice(current === 'Pausado' ? 'Cliente activado.' : 'Cliente pausado.');
  }

  // Abre el modal de renovar/añadir plan; si el formulario de editar
  // cliente estaba abierto se cierra (conviene guardar cambios pendientes
  // de nombre/dirección antes de usar estos botones, ya que no se guardan
  // al abrir la renovación) -- pero se recuerda para reabrirlo solo al
  // terminar, en vez de quedar cerrado para siempre (ver
  // reopenEditAfterRenew arriba).
  function openRenew(c, mode = 'renew') {
    setReopenEditAfterRenew(!!editing);
    setEditing(null);
    setRenewing({ client: c, mode });
  }

  // Permite que otras pantallas (p. ej. Notas) pidan abrir la edición o la
  // renovación de un cliente específico al navegar acá.
  useEffect(() => {
    if (!pendingClientAction || loading) return;
    const c = clients.find((x) => x.id === pendingClientAction.clientId);
    if (c) {
      setReturnOrigin(pendingClientAction.origin || 'notes');
      if (pendingClientAction.action === 'renew') openRenew(c, 'renew');
      else openEdit(c);
    } else {
      showNotice('No se encontró ese cliente (puede haber sido eliminado).', true);
    }
    onConsumePendingClientAction?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClientAction, loading]);

  async function confirmRenew({ planId, days, planChangeMode, samePlan }) {
    const c = renewing.client;
    const hasRemainingBalance = n(c.paidDays) > n(c.consumedDays);
    const updated = { ...c };
    if (samePlan) {
      updated.paidDays = n(c.paidDays) + days;
      if (c.pendingPlan) updated.pendingPlan = { ...c.pendingPlan, activateAtConsumedDays: n(c.pendingPlan.activateAtConsumedDays) + days };
    } else {
      const newPlan = plans.find((p) => p.id === planId);
      if (hasRemainingBalance && planChangeMode === 'carry') {
        const threshold = n(c.paidDays);
        updated.paidDays = threshold + days;
        updated.pendingPlan = { planId, activateAtConsumedDays: threshold };
      } else {
        updated.planId = planId;
        updated.items = newPlan?.items || {};
        updated.paidDays = n(c.paidDays) + days;
        updated.pendingPlan = null;
      }
    }
    if (updated.status === 'Pausado' || updated.status === 'Retorno pendiente') {
      updated.status = 'Activo'; updated.pauseStart = ''; updated.pauseDates = [];
    }
    saveClients([updated]);
    showNotice(samePlan ? `Plan de ${c.name} renovado.` : `Nuevo plan asignado a ${c.name}.`);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: samePlan ? 'Cliente renovado' : 'Nuevo plan asignado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: { plan: planName(updated.planId), diasAgregados: days, modo: samePlan ? 'mismo-plan' : planChangeMode } });
    // Guarda los datos de esta renovación para que, si el staff viene desde
    // una nota de solicitud de plan y después la marca "Cumplida", se pueda
    // armar el mensaje de confirmación de WhatsApp con el plan y los días
    // reales que se cargaron (no lo que el cliente pidió, sino lo que
    // finalmente se aplicó).
    onRenewalCompleted?.(c.id, { kind: samePlan ? 'renovacion' : 'compra', planName: planName(updated.planId), days, clientName: c.name, phone: c.phone1 });
    setRenewing(null);
    // Si esta renovación se hizo desde el botón "Renovar" de otra pantalla
    // (Notas o Día de trabajo), se vuelve automáticamente a esa misma
    // pantalla -- si no, el staff se queda en Clientes y puede olvidarse
    // de, por ejemplo, marcar la nota como cumplida (el paso que dispara
    // el mensaje de confirmación por WhatsApp). Eso tiene prioridad sobre
    // reabrir "Editar cliente": si se llegó desde una nota, lo que importa
    // es volver a esa nota, no quedarse editando el cliente.
    if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); }
    else if (reopenEditAfterRenew) { openEdit(updated); }
    setReopenEditAfterRenew(false);
  }

  // allColumns (antes se llamaba "columns") -- ahora se le pasa COMPLETA a
  // DataTable junto con resizeGroup="clients", que se encarga de aplicar
  // el orden/ocultas que cada usuario haya guardado y de mostrar el botón
  // "Columnas" (mismo mecanismo que ya existía en Día de trabajo).
  const allColumns = [
    { key: 'order', label: 'Orden', render: (c) => n(effectiveOrder(c, currentDate)) || '' },
    { key: 'name', label: 'Cliente / carnet', render: (c) => (<><b>{c.name}</b><br /><small className="muted">CI: {c.carnet || '—'}</small></>) },
    { key: 'route', label: 'Ruta', render: (c) => routeName(effectiveRouteId(c, currentDate)) },
    { key: 'address1', label: 'Dirección', render: (c) => (c.addresses || []).map((a) => a.address).filter(Boolean).join(', ') || '—' },
    { key: 'notes', label: 'Observaciones', render: (c) => effectiveNotes(c, currentDate) || '—' },
    { key: 'maps', label: 'Google Maps', render: (c) => { const link = effectiveMaps(c, currentDate); return link ? <a href={link} target="_blank" rel="noopener">Abrir mapa</a> : '—'; } },
    { key: 'phone1', label: 'Teléfono', render: (c) => { const link = clientWaLink(c.phone1); return link ? <a href={link} target="_blank" rel="noopener" title="Abrir chat de WhatsApp">{c.phone1}</a> : (c.phone1 || '—'); } },
    { key: 'plan', label: 'Plan', render: (c) => planName(c.planId) },
    { key: 'driver', label: 'Driver', render: (c) => driverName(c.driverId) },
    { key: 'status', label: 'Estado', render: (c) => <span className={`badge ${statusBadgeClass(dispatchStatus(c, currentDate, dayInfo, false))}`}>{dispatchStatus(c, currentDate, dayInfo, false)}</span> },
    { key: 'paidDays', label: 'Días pagados', render: (c) => n(c.paidDays) },
    { key: 'consumedDays', label: 'Consumidos', render: (c) => n(c.consumedDays) },
    { key: 'specialDiet', label: 'Dieta especial', render: (c) => c.specialDiet || '—' },
    { key: 'id', label: 'Acciones', render: (c) => canEdit ? (
      <>
        <button className="icon-btn warning" onClick={() => togglePause(c)}>{dispatchStatus(c, currentDate, dayInfo, false) === 'Pausado' ? 'Activar' : 'Pausar'}</button>
        <button className="icon-btn violet" onClick={() => openRenew(c, 'renew')}>Renovar</button>
        <button className="icon-btn info" onClick={() => openEdit(c)}>Editar</button>
        <button className="icon-btn delete" onClick={() => handleDelete(c)}>×</button>
      </>
    ) : '—' },
  ];

  if (loading) return <p className="muted">Cargando clientes…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Clientes</h1><p>Ficha completa, plan alimenticio y datos de entrega.</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => openEdit(null)}>+ Añadir cliente</button></div>}
      </div>

      <div className="toolbar">
        <input className="search" id="clients-search" name="clients-search" autoComplete="off" placeholder="Buscar clientes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{list.length} clientes</span>
      </div>
      <DataTable allColumns={allColumns} rows={list} emptyText="No hay clientes registrados." resizeGroup="clients" userId={user?.id} />

      <Modal title={editing?.id ? 'Editar cliente' : 'Añadir cliente'} open={!!editing} onClose={() => { setEditing(null); if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); } }} onSubmit={handleSubmit}>
        {editing && (() => {
          const isExisting = !!editing.id;
          const remaining = Math.max(0, n(editing.paidDays) - n(editing.consumedDays));
          const pendingPlan = editing.pendingPlan;
          const pendingDaysLeftOld = pendingPlan ? Math.max(0, n(pendingPlan.activateAtConsumedDays) - n(editing.consumedDays)) : 0;
          const pendingDaysNew = pendingPlan ? Math.max(0, n(editing.paidDays) - n(pendingPlan.activateAtConsumedDays)) : 0;
          return (
            <div className="form-grid">
              <div className="form-section tone-primary">
                <div className="form-section-title">🧾 Datos del cliente</div>
                <div className="form-section-grid">
                  <label>Nombre completo *<input name="name" required defaultValue={editing.name} /></label>
                  <label>Carnet *<input name="carnet" required defaultValue={editing.carnet} /></label>
                  <label>Teléfono 1 *<input name="phone1" required autoComplete="tel" defaultValue={editing.phone1} /></label>
                  <label>Teléfono 2<input name="phone2" autoComplete="tel" defaultValue={editing.phone2} /></label>
                </div>
              </div>

              <div className="form-section tone-accent">
                <div className="form-section-title">📍 Direcciones</div>
                <p className="muted" style={{ margin: '2px 0 8px' }}>Agrega una o varias direcciones de entrega. La ruta de cada una define automáticamente su driver.</p>
                <AddressRows addresses={addresses} setAddresses={setAddresses} activeId={activeAddressId} setActiveId={setActiveAddressId} routes={routes} clients={clients} currentDate={currentDate} dayInfo={dayInfo} saveClients={saveClients} selfId={editing?.id} />
              </div>

              <div className="form-section tone-warning">
                <div className="form-section-title">🍽️ Plan y estado del servicio</div>
                <div className="form-section-grid">
                  <div className="wide">
                    {isExisting ? (
                      <>
                        <div className="plan-summary-row">
                          <div className="plan-option-info">
                            <b>Plan asignado: {planName(editing.planId)}</b>
                            <span className="muted">{n(editing.paidDays) ? `${n(editing.consumedDays)} de ${n(editing.paidDays)} día(s) consumidos · quedan ${remaining}` : 'Sin días cargados todavía'}</span>
                          </div>
                          <div className="plan-option-actions">
                            <button type="button" className="outline" onClick={() => openRenew(editing, 'renew')}>🔄 Renovar</button>
                            <button type="button" className="outline" onClick={() => openRenew(editing, 'change')}>➕ Añadir nuevo plan</button>
                            {editing.planId && <button type="button" className="danger" onClick={() => removePlan(editing)}>🗑️ Borrar plan</button>}
                          </div>
                        </div>
                        <p className="muted" style={{ margin: '4px 0 0' }}>Usa estos botones para sumar días o cambiar de plan: los días pagados/consumidos no se resetean, se acumulan para poder ver la antigüedad y el consumo real del cliente. Si necesitas ajustar los números a mano, hazlo desde aquí abajo.</p>
                        <input type="hidden" name="planId" value={editing.planId || ''} />
                      </>
                    ) : (
                      <label>Plan asignado
                        <select name="planId" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                          <option value="">Sin plan</option>
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  {pendingPlan && (
                    <div className="wide plan-alert-box">
                      <div className="plan-option-info">
                        <b>Cambio de plan programado</b>
                        <span className="muted">Le quedan {pendingDaysLeftOld} día(s) con el plan actual ("{planName(editing.planId)}"), después pasa a "{planName(pendingPlan.planId)}" por {pendingDaysNew} día(s) más ({n(editing.paidDays)} en total).</span>
                      </div>
                    </div>
                  )}
                  <label>Estado del plan
                    <select name="status" defaultValue={editing.status || 'Activo'}>
                      {['Activo', 'Pausado', 'Retorno pendiente', 'Programado'].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label>Fecha de inicio<div className="date-input-wrap"><input name="startDate" type="date" defaultValue={editing.startDate} /></div></label>
                  <label>Fecha de retorno<div className="date-input-wrap"><input name="returnDate" type="date" defaultValue={editing.returnDate} /></div></label>
                  <label>Días pagados<input key={`paidDays-${selectedPlanId}`} name="paidDays" type="number" min="0" defaultValue={editing.paidDays != null ? n(editing.paidDays) : (isExisting ? 0 : (n(plans.find((p) => p.id === selectedPlanId)?.serviceDays) || 0))} /></label>
                  <label>Días consumidos<input name="consumedDays" type="number" min="0" defaultValue={n(editing.consumedDays)} /></label>
                  <label>Carreras por entrega
                    <select name="career" defaultValue={String(n(editing.career) || 1)}>
                      <option value="1">Corto (1)</option><option value="2">Largo (2)</option><option value="3">Muy Largo (3)</option>
                    </select>
                  </label>
                  <label>Cantidad de bolsas<input name="bags" type="number" min="0" defaultValue={editing.bags != null ? n(editing.bags) : (isExisting ? 0 : 1)} /></label>
                  <label className="wide">Dieta especial<AutoTextarea name="specialDiet" defaultValue={editing.specialDiet} /></label>
                </div>
              </div>

              <div className="form-section tone-accent">
                <div className="form-section-title">🥗 Artículos incluidos</div>
                <p className="muted" style={{ margin: '2px 0 8px' }}>Se autorrellenan al elegir un plan arriba; puedes editarlos manualmente después.</p>
                <div className="form-section-grid items-grid" key={`items-${selectedPlanId}`}>
                  {menuItems.map(({ key, label }) => (
                    <label key={key}>{label}<input type="number" min="0" name={`item_${key}`} defaultValue={n(editing.items?.[key] ?? plans.find((p) => p.id === selectedPlanId)?.items?.[key])} /></label>
                  ))}
                </div>
              </div>

              <div className="form-section tone-danger">
                <div className="form-section-title">🗓️ Horario semanal {scheduleLocked && <span className="badge warn" style={{ marginLeft: 6 }}>Función Premium</span>}</div>
                {scheduleLocked ? (
                  <p className="muted">Esta empresa está en plan Básico. Activa Premium en Configuración para usar horarios semanales.</p>
                ) : (
                  <>
                    <p className="muted" style={{ margin: '2px 0 8px' }}>Opcional: si el cliente solo recibe ciertos días de la semana, configuralo acá y no hace falta pausarlo/reactivarlo a mano cada semana.</p>
                    <ScheduleRows schedule={schedule} setSchedule={setSchedule} addresses={addresses.filter((a) => a.address.trim())} />
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {renewing && (
        <RenewPlanModal
          client={renewing.client}
          mode={renewing.mode}
          plans={plans}
          onClose={() => { setRenewing(null); if (returnOrigin) { onReturnToOrigin?.(returnOrigin); setReturnOrigin(null); } else if (reopenEditAfterRenew) { openEdit(renewing.client); } setReopenEditAfterRenew(false); }}
          onConfirm={confirmRenew}
        />
      )}
    </section>
  );
}

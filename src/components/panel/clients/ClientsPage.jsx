import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveOrder, effectiveMaps, effectiveAddress, dispatchStatus, statusBadgeClass, myRouteIds } from '../../../services/dispatchHelpers';
import { canManage, isPagePremiumLocked } from '../../../services/panelAuth';
import { resolveShortMapsLinkIfNeeded } from '../../../services/resolveMapsLink';
import Modal from '../Modal';
import DataTable from '../DataTable';

const WEEKDAYS = [{ v: 1, l: 'Lun' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mié' }, { v: 4, l: 'Jue' }, { v: 5, l: 'Vie' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' }];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function waLink(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.length <= 8 ? '591' + digits : digits}`;
}

// Filas de direcciones editables dentro del formulario de cliente. Vive
// como su propio estado local (no se guarda hasta apretar "Guardar" del
// modal) para que agregar/quitar filas sea instantáneo.
function AddressRows({ addresses, setAddresses, activeId, setActiveId, routes }) {
  function update(i, field, value) {
    setAddresses(addresses.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }
  function remove(i) {
    const removed = addresses[i];
    const next = addresses.filter((_, idx) => idx !== i);
    setAddresses(next);
    if (removed?.id === activeId) setActiveId(next[0]?.id || '');
  }
  function add() {
    const row = { id: uid('addr'), address: '', routeId: '', maps: '', order: '' };
    setAddresses([...addresses, row]);
    if (!activeId) setActiveId(row.id);
  }

  return (
    <>
      {addresses.map((a, i) => (
        <div key={a.id} className="address-row">
          <input placeholder="Dirección" value={a.address} onChange={(e) => update(i, 'address', e.target.value)} />
          <select value={a.routeId} onChange={(e) => update(i, 'routeId', e.target.value)}>
            <option value="">Ruta abierta</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input placeholder="Link de Google Maps" value={a.maps} onChange={(e) => update(i, 'maps', e.target.value)} />
          <button type="button" className="icon-btn delete" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button type="button" className="outline" onClick={add}>+ Añadir dirección</button>
      {addresses.length > 1 && (
        <label style={{ marginTop: 10 }}>Dirección activa (la que se usa por defecto)
          <select value={activeId} onChange={(e) => setActiveId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.address || 'Sin nombre'}</option>)}
          </select>
        </label>
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
                <input type="checkbox" checked={row.days.includes(w.v)} onChange={() => toggleDay(i, w.v)} />
              </label>
            ))}
          </div>
          <select value={row.addressId} onChange={(e) => update(i, { addressId: e.target.value })}>
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

export default function ClientsPage({ user }) {
  const { clients, routes, plans, drivers, settings, currentDate, saveClients, deleteClients, showNotice, loading } = useOperations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [activeAddressId, setActiveAddressId] = useState('');
  const [schedule, setSchedule] = useState([]);
  const canEdit = canManage(user?.role, settings.customRoles, 'clients');
  const isDriver = user?.role === 'driver';
  const myRoutes = myRouteIds(user, drivers);
  const menuItems = settings.menuItems || [];
  const scheduleLocked = isPagePremiumLocked('weeklySchedule', settings.premiumLockedPages) && settings.plan !== 'premium';

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Sin ruta'; }
  function planName(id) { return plans.find((p) => p.id === id)?.name || 'Sin plan'; }
  function driverName(id) { return drivers.find((d) => d.id === id) ? `${drivers.find((d) => d.id === id).firstName} ${drivers.find((d) => d.id === id).lastName}` : 'Sin asignar'; }

  const scope = isDriver ? clients.filter((c) => myRoutes.includes(effectiveRouteId(c, currentDate))) : clients;
  const q = search.toLowerCase();
  const list = scope.filter((c) => !q || [c.name, c.carnet, ...(c.addresses || []).map((a) => a.address), c.phone1, routeName(c.routeId), planName(c.planId)].join(' ').toLowerCase().includes(q));

  function openEdit(c) {
    setEditing(c || {});
    setAddresses(c?.addresses?.length ? c.addresses : []);
    setActiveAddressId(c?.activeAddressId || c?.addresses?.[0]?.id || '');
    setSchedule(c?.schedule?.length ? c.schedule : []);
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const items = {};
    menuItems.forEach(({ key }) => { items[key] = n(data[`item_${key}`]); delete data[`item_${key}`]; });
    if (data.status !== 'Programado') data.returnDate = '';
    const resolvedAddresses = await Promise.all(addresses.filter((a) => a.address.trim()).map(resolveShortMapsLinkIfNeeded));
    const finalAddresses = resolvedAddresses;
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
  }

  function handleDelete(c) {
    if (!confirm(`¿Eliminar a ${c.name}?`)) return;
    deleteClients([c.id]);
    showNotice('Cliente eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Cliente eliminado', entity_type: 'client', entity_label: c.name, entity_id: c.id, details: {} });
  }

  function togglePause(c) {
    const current = dispatchStatus(c, currentDate, {}, false);
    saveClients([{ ...c, status: current === 'Pausado' ? 'Activo' : 'Pausado', pauseStart: current === 'Pausado' ? '' : currentDate }]);
    showNotice(current === 'Pausado' ? 'Cliente activado.' : 'Cliente pausado.');
  }

  const columns = [
    { key: 'order', label: 'Orden', render: (c) => n(effectiveOrder(c, currentDate)) || '' },
    { key: 'name', label: 'Cliente / carnet', render: (c) => (<><b>{c.name}</b><br /><small className="muted">CI: {c.carnet || '—'}</small></>) },
    { key: 'route', label: 'Ruta', render: (c) => routeName(effectiveRouteId(c, currentDate)) },
    { key: 'address1', label: 'Dirección', render: (c) => (c.addresses || []).map((a) => a.address).filter(Boolean).join(', ') || '—' },
    { key: 'maps', label: 'Google Maps', render: (c) => { const link = effectiveMaps(c, currentDate); return link ? <a href={link} target="_blank" rel="noopener">Abrir mapa</a> : '—'; } },
    { key: 'phone1', label: 'Teléfono', render: (c) => { const link = waLink(c.phone1); return link ? <a href={link} target="_blank" rel="noopener" title="Abrir chat de WhatsApp">{c.phone1}</a> : (c.phone1 || '—'); } },
    { key: 'plan', label: 'Plan', render: (c) => planName(c.planId) },
    { key: 'driver', label: 'Driver', render: (c) => driverName(c.driverId) },
    { key: 'status', label: 'Estado', render: (c) => <span className={`badge ${statusBadgeClass(dispatchStatus(c, currentDate, {}, false))}`}>{dispatchStatus(c, currentDate, {}, false)}</span> },
    { key: 'paidDays', label: 'Días pagados', render: (c) => n(c.paidDays) },
    { key: 'consumedDays', label: 'Consumidos', render: (c) => n(c.consumedDays) },
    { key: 'specialDiet', label: 'Dieta especial', render: (c) => c.specialDiet || '—' },
    { key: 'id', label: 'Acciones', render: (c) => canEdit ? (
      <>
        <button className="icon-btn" onClick={() => togglePause(c)}>{dispatchStatus(c, currentDate, {}, false) === 'Pausado' ? 'Activar' : 'Pausar'}</button>
        <button className="icon-btn" onClick={() => openEdit(c)}>Editar</button>
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
        <input className="search" placeholder="Buscar clientes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{list.length} clientes</span>
      </div>
      <DataTable columns={columns} rows={list} emptyText="No hay clientes registrados." resizeGroup="clients" userId={user?.id} />

      <Modal title={editing?.id ? 'Editar cliente' : 'Añadir cliente'} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        {editing && (
          <div className="form-grid">
            <label>Nombre completo *<input name="name" required defaultValue={editing.name} /></label>
            <label>Carnet *<input name="carnet" required defaultValue={editing.carnet} /></label>
            <div className="wide">
              <label>Direcciones</label>
              <p className="muted" style={{ margin: '2px 0 8px' }}>Agrega una o varias direcciones de entrega. La ruta de cada una define automáticamente su driver.</p>
              <AddressRows addresses={addresses} setAddresses={setAddresses} activeId={activeAddressId} setActiveId={setActiveAddressId} routes={routes} />
            </div>
            <div className="wide">
              <label>Horario semanal {scheduleLocked && <span className="badge warn" style={{ marginLeft: 6 }}>Función Premium</span>}</label>
              <p className="muted" style={{ margin: '2px 0 8px' }}>Opcional: si el cliente solo recibe ciertos días de la semana, configuralo acá y no hace falta pausarlo/reactivarlo a mano cada semana.</p>
              {scheduleLocked ? (
                <p className="muted">Esta empresa está en plan Básico. Activa Premium en Configuración para usar horarios semanales.</p>
              ) : (
                <ScheduleRows schedule={schedule} setSchedule={setSchedule} addresses={addresses.filter((a) => a.address.trim())} />
              )}
            </div>
            <label>Teléfono 1 *<input name="phone1" required defaultValue={editing.phone1} /></label>
            <label>Teléfono 2<input name="phone2" defaultValue={editing.phone2} /></label>
            <label>Plan asignado
              <select name="planId" defaultValue={editing.planId || ''}>
                <option value="">Sin plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Estado del plan
              <select name="status" defaultValue={editing.status || 'Activo'}>
                {['Activo', 'Pausado', 'Retorno pendiente', 'Programado'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>Fecha de inicio<input name="startDate" type="date" defaultValue={editing.startDate} /></label>
            <label>Fecha de retorno<input name="returnDate" type="date" defaultValue={editing.returnDate} /></label>
            <label>Días pagados<input name="paidDays" type="number" min="0" defaultValue={n(editing.paidDays)} /></label>
            <label>Días consumidos<input name="consumedDays" type="number" min="0" defaultValue={n(editing.consumedDays)} /></label>
            <label>Carreras por entrega
              <select name="career" defaultValue={String(n(editing.career) || 1)}>
                <option value="1">Corto (1)</option><option value="2">Largo (2)</option><option value="3">Muy Largo (3)</option>
              </select>
            </label>
            <label>Cantidad de bolsas<input name="bags" type="number" min="0" defaultValue={n(editing.bags)} /></label>
            <label className="wide">Dieta especial<textarea name="specialDiet" defaultValue={editing.specialDiet} /></label>
            <div className="wide">
              <label>Artículos incluidos</label>
              <p className="muted" style={{ margin: '2px 0 8px' }}>Se autorrellenan al elegir un plan; puedes editarlos manualmente después.</p>
              <div className="form-grid">
                {menuItems.map(({ key, label }) => (
                  <label key={key}>{label}<input type="number" min="0" name={`item_${key}`} defaultValue={n(editing.items?.[key] ?? plans.find((p) => p.id === editing.planId)?.items?.[key])} /></label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

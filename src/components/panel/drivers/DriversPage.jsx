import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { driverRouteIds } from '../../../services/dispatchHelpers';
import Modal from '../Modal';
import DataTable from '../DataTable';
import ImageField from '../ImageField';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function DriversPage({ user }) {
  const { drivers, routes, clients, settings, saveDrivers, saveClients, showNotice, loading } = useOperations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const canEdit = canManage(user?.role, settings.customRoles, 'drivers');

  function openEdit(d) {
    setEditing(d || {});
    setPhotoUrl(d?.photoUrl || '');
  }

  function routeName(id) {
    return routes.find((r) => r.id === id)?.name || 'Sin ruta';
  }

  // Evita que una misma ruta quede asignada a dos drivers a la vez.
  function driverRouteConflict(routeId, excludeDriverId) {
    if (!routeId) return null;
    return drivers.find((d) => d.id !== excludeDriverId && driverRouteIds(d).includes(routeId));
  }

  const q = search.toLowerCase();
  const list = drivers.filter((d) => !q || [d.firstName, d.lastName, d.carnet, d.phone, d.address, routeName(d.routeId)].join(' ').toLowerCase().includes(q));

  function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const extraRouteIds = [...form.elements.extraRouteIds.selectedOptions].map((o) => o.value).filter(Boolean);
    delete data.extraRouteIds;

    if (extraRouteIds.includes(data.routeId)) {
      showNotice('La ruta principal no puede repetirse también como ruta adicional.', true);
      return false;
    }
    for (const rid of [data.routeId, ...extraRouteIds]) {
      const conflict = driverRouteConflict(rid, editing?.id);
      if (conflict) {
        showNotice(`La ruta "${routeName(rid)}" ya está asignada a ${conflict.firstName} ${conflict.lastName}. Quítasela primero.`, true);
        return false;
      }
    }

    const isNew = !editing?.id;
    data.photoUrl = photoUrl;
    let d;
    if (editing?.id) {
      d = { ...editing, ...data, extraRouteIds };
      saveDrivers(drivers.map((x) => (x.id === d.id ? d : x)));
      // Si el driver cambió de ruta, sus clientes asignados directamente lo siguen.
      const affected = clients.filter((c) => c.driverId === d.id && c.routeId !== d.routeId);
      if (affected.length) saveClients(affected.map((c) => ({ ...c, routeId: d.routeId })));
    } else {
      d = { id: uid('d'), ...data, extraRouteIds };
      saveDrivers([...drivers, d]);
    }
    showNotice('Driver guardado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Driver creado' : 'Driver editado', entity_type: 'driver', entity_label: `${d.firstName || ''} ${d.lastName || ''}`.trim(), entity_id: d.id, details: {} });
  }

  function handleDelete(d) {
    if (!confirm('¿Eliminar este driver?')) return;
    saveDrivers(drivers.filter((x) => x.id !== d.id));
    showNotice('Registro eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Driver eliminado', entity_type: 'driver', entity_label: `${d.firstName} ${d.lastName}`, entity_id: d.id, details: {} });
  }

  const columns = [
    { key: 'name', label: 'Nombre', render: (d) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)' }}>
          {d.photoUrl ? <img src={d.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
        </div>
        <b>{d.firstName} {d.lastName}</b>
      </div>
    ) },
    { key: 'carnet', label: 'Carnet', render: (d) => d.carnet || '—' },
    { key: 'phone', label: 'Teléfono', render: (d) => d.phone || '—' },
    { key: 'address', label: 'Dirección domicilio', render: (d) => d.address || '—' },
    { key: 'route', label: 'Ruta', render: (d) => (
      <>{routeName(d.routeId)}{(d.extraRouteIds || []).length > 0 && <span className="badge warn" title="Rutas de reemplazo"> + {d.extraRouteIds.map(routeName).join(', ')}</span>}</>
    ) },
    { key: 'id', label: 'Acciones', render: (d) => canEdit ? (
      <><button className="icon-btn info" onClick={() => openEdit(d)}>Editar</button><button className="icon-btn delete" onClick={() => handleDelete(d)}>×</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">Cargando drivers…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Drivers</h1><p>Personal de entrega registrado.</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => openEdit(null)}>+ Añadir driver</button></div>}
      </div>

      <DataTable columns={columns} rows={list} search={search} onSearchChange={setSearch} searchPlaceholder="Buscar driver…" emptyText="No hay drivers registrados." resizeGroup="drivers" userId={user?.id} />

      <Modal title={editing?.id ? 'Editar driver' : 'Añadir driver'} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          <ImageField label="Foto (opcional)" name="photoUrl" value={photoUrl} onChange={setPhotoUrl} folder="drivers" maxDim={300} />
          <label>Nombre *<input name="firstName" required defaultValue={editing?.firstName} /></label>
          <label>Apellido *<input name="lastName" required defaultValue={editing?.lastName} /></label>
          <label>Carnet *<input name="carnet" required defaultValue={editing?.carnet} /></label>
          <label>Teléfono *<input name="phone" required defaultValue={editing?.phone} /></label>
          <label className="wide">Dirección de domicilio *<input name="address" required defaultValue={editing?.address} /></label>
          <label>Ruta asignada
            <select name="routeId" defaultValue={editing?.routeId || ''}>
              <option value="">Ruta abierta</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="wide">Rutas adicionales (solo para cubrir un reemplazo temporal)
            <select name="extraRouteIds" multiple size={4} defaultValue={editing?.extraRouteIds || []}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <small>Ctrl/Cmd + clic para elegir varias. Una ruta no puede estar a la vez en dos drivers.</small>
          </label>
        </div>
      </Modal>
    </section>
  );
}

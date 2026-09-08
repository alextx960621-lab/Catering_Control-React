import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import Modal from '../Modal';
import DataTable from '../DataTable';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const ROUTE_TYPES = { short: ['Corta', 'done'], long: ['Larga', 'pending'], verylong: ['Muy larga', 'warn'] };

export default function RoutesPage({ user }) {
  const { routes, clients, drivers, saveRoutes, showNotice, loading } = useOperations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const canEdit = canManage(user?.role, settings.customRoles, 'routes');

  const q = search.toLowerCase();
  const list = routes.filter((r) => !q || [r.name, r.description].join(' ').toLowerCase().includes(q));

  function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const isNew = !editing?.id;
    let r;
    if (editing?.id) {
      r = { ...editing, ...data };
      saveRoutes(routes.map((x) => (x.id === r.id ? r : x)));
    } else {
      r = { id: uid('r'), ...data };
      saveRoutes([...routes, r]);
    }
    showNotice('Ruta guardada.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Ruta creada' : 'Ruta editada', entity_type: 'route', entity_label: r.name, entity_id: r.id, details: {} });
  }

  function handleDelete(r) {
    if (clients.some((c) => c.routeId === r.id) || drivers.some((d) => d.routeId === r.id)) {
      showNotice('No se puede eliminar una ruta asignada.', true);
      return;
    }
    if (!confirm('¿Eliminar esta ruta?')) return;
    saveRoutes(routes.filter((x) => x.id !== r.id));
    showNotice('Registro eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Ruta eliminada', entity_type: 'route', entity_label: r.name, entity_id: r.id, details: {} });
  }

  const columns = [
    { key: 'name', label: 'Ruta', render: (r) => <>{<b>{r.name}</b>}{r.open && <span className="badge off"> Abierta</span>}</> },
    { key: 'type', label: 'Tipo', render: (r) => { const [label, cl] = ROUTE_TYPES[r.type] || ROUTE_TYPES.short; return <span className={`badge ${cl}`}>{label}</span>; } },
    { key: 'description', label: 'Descripción', render: (r) => r.description || '—' },
    { key: 'clients', label: 'Clientes', render: (r) => clients.filter((c) => c.routeId === r.id).length },
    { key: 'drivers', label: 'Drivers', render: (r) => drivers.filter((d) => d.routeId === r.id).length },
    { key: 'id', label: 'Acciones', render: (r) => canEdit && !r.open ? (
      <><button className="icon-btn" onClick={() => setEditing(r)}>Editar</button><button className="icon-btn delete" onClick={() => handleDelete(r)}>×</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">Cargando rutas…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Rutas</h1><p>Incluye una ruta abierta para drivers disponibles sin ruta de trabajo.</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => setEditing({})}>+ Crear ruta</button></div>}
      </div>

      <DataTable columns={columns} rows={list} search={search} onSearchChange={setSearch} searchPlaceholder="Buscar ruta…" emptyText="No hay rutas registradas." resizeGroup="routes" userId={user?.id} />

      <Modal title={editing?.id ? 'Editar ruta' : 'Crear ruta'} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>Nombre de ruta *<input name="name" required defaultValue={editing?.name} /></label>
          <label>Orden<input type="number" min="0" name="order" defaultValue={editing?.order} /></label>
          <label>Tipo de ruta
            <select name="type" defaultValue={editing?.type || 'short'}>
              <option value="short">Corta</option>
              <option value="long">Larga</option>
              <option value="verylong">Muy larga</option>
            </select>
          </label>
          <label className="wide">Descripción / zona<input name="description" defaultValue={editing?.description} /></label>
        </div>
      </Modal>
    </section>
  );
}

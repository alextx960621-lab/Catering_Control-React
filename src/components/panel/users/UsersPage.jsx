import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { rpc, dbInsertAudit } from '../../../services/supabaseClient';
import { driverRouteIds } from '../../../services/dispatchHelpers';
import { ROLE_LABELS, ROLE_PAGE_OPTIONS, roleLabel, isBuiltinRole } from '../../../services/panelAuth';
import Modal from '../Modal';
import DataTable from '../DataTable';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function UsersPage({ user }) {
  const { staffUsers, saveStaffUsers, drivers, saveDrivers, routes, settings, saveSettings, showNotice, loading } = useOperations();
  const [editing, setEditing] = useState(null);
  const [editingRole, setEditingRole] = useState(null);
  const isSuperAdmin = user?.role === 'superadmin';
  const customRoles = settings.customRoles || [];

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Ruta abierta'; }

  function driverRouteConflict(routeId, excludeDriverId) {
    if (!routeId) return null;
    return drivers.find((d) => d.id !== excludeDriverId && driverRouteIds(d).includes(routeId));
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const u = editing?.id ? editing : null;

    if (staffUsers.some((x) => x.username === data.username && x.id !== u?.id)) { showNotice('Ese usuario ya existe.', true); return false; }
    if (staffUsers.some((x) => x.email.toLowerCase() === data.email.toLowerCase() && x.id !== u?.id)) { showNotice('Ese correo ya está registrado.', true); return false; }
    if (data.role === 'superadmin') {
      if (!isSuperAdmin) { showNotice('Solo el Super Administrador puede asignar ese rol.', true); return false; }
      if (staffUsers.some((x) => x.role === 'superadmin' && x.id !== u?.id)) { showNotice('Ya existe un Super Administrador. Solo puede haber uno.', true); return false; }
    }
    if (u?.role === 'superadmin' && data.role !== 'superadmin' && !isSuperAdmin) { showNotice('Solo el propio Super Administrador puede quitarse ese rol.', true); return false; }
    if (data.password && data.password !== data.passwordConfirm) { showNotice('La contraseña y su confirmación no coinciden.', true); return false; }

    let passwordHash = u?.passwordHash || '';
    if (data.password) {
      passwordHash = await rpc('hash_password', { p_password: data.password });
      if (!passwordHash) { showNotice('No se pudo generar la contraseña de forma segura. Intenta nuevamente.', true); return false; }
    } else if (!u) {
      showNotice('La contraseña es obligatoria para un usuario nuevo.', true);
      return false;
    }

    let driverId = u?.driverId;
    let updatedDrivers = drivers;
    if (data.role === 'driver') {
      const conflict = driverRouteConflict(data.routeId, driverId);
      if (conflict) { showNotice(`La ruta "${routeName(data.routeId)}" ya está asignada a ${conflict.firstName} ${conflict.lastName}.`, true); return false; }
      const existingDriver = drivers.find((d) => d.id === driverId);
      const parts = data.name.trim().split(/\s+/);
      const driverData = { firstName: parts.shift() || data.name, lastName: parts.join(' ') || '', carnet: data.carnet, phone: data.phone, address: data.address, routeId: data.routeId };
      if (existingDriver) {
        updatedDrivers = drivers.map((d) => (d.id === existingDriver.id ? { ...d, ...driverData } : d));
      } else {
        const newDriver = { id: uid('d'), ...driverData };
        updatedDrivers = [...drivers, newDriver];
        driverId = newDriver.id;
      }
      saveDrivers(updatedDrivers);
    }

    const isNew = !u;
    const userData = { username: data.username, email: data.email, passwordHash, name: data.name, role: data.role, routeId: data.role === 'driver' ? data.routeId : '', driverId: data.role === 'driver' ? driverId : '' };
    const finalUser = u ? { ...u, ...userData } : { id: uid('u'), ...userData };
    saveStaffUsers(u ? staffUsers.map((x) => (x.id === finalUser.id ? finalUser : x)) : [...staffUsers, finalUser]);
    showNotice(data.role === 'driver' ? 'Usuario, acceso y ficha de driver guardados.' : 'Usuario guardado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Usuario creado' : 'Usuario editado', entity_type: 'user', entity_label: `${finalUser.name} (${finalUser.username})`, entity_id: finalUser.id, details: { rol: finalUser.role } });
  }

  function handleDelete(u) {
    if (u.id === user.id) { showNotice('No puedes eliminar tu usuario actual.', true); return; }
    if (u.role === 'superadmin' && !isSuperAdmin) { showNotice('No puedes eliminar al Super Administrador.', true); return; }
    if (!confirm('¿Eliminar este usuario?')) return;
    saveStaffUsers(staffUsers.filter((x) => x.id !== u.id));
    showNotice('Usuario eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Usuario eliminado', entity_type: 'user', entity_label: `${u.name} (${u.username})`, entity_id: u.id, details: {} });
  }

  // --- Roles a medida ------------------------------------------------
  function handleRoleSubmit(form) {
    const label = form.elements.label.value.trim();
    if (!label) { showNotice('El nombre del rol no puede estar vacío.', true); return false; }
    const pages = {};
    ROLE_PAGE_OPTIONS.forEach(([key, , editable]) => {
      const view = !!form.elements[`view_${key}`]?.checked;
      const edit = editable ? view && !!form.elements[`edit_${key}`]?.checked : false;
      pages[key] = { view, edit };
    });
    const isNew = !editingRole?.id;
    const updated = isNew
      ? [...customRoles, { id: uid('role'), label, pages }]
      : customRoles.map((r) => (r.id === editingRole.id ? { ...r, label, pages } : r));
    saveSettings({ ...settings, customRoles: updated });
    showNotice(isNew ? 'Rol creado.' : 'Rol actualizado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Rol creado' : 'Rol editado', entity_type: 'role', entity_label: label, entity_id: editingRole?.id || '', details: {} });
  }

  function handleRoleDelete(r) {
    const inUse = staffUsers.filter((u) => u.role === r.id);
    if (inUse.length) { showNotice(`No se puede eliminar: ${inUse.length} usuario(s) todavía tienen el rol "${r.label}". Cámbiales el rol primero.`, true); return; }
    if (!confirm(`¿Eliminar el rol "${r.label}"?`)) return;
    saveSettings({ ...settings, customRoles: customRoles.filter((x) => x.id !== r.id) });
    showNotice('Rol eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Rol eliminado', entity_type: 'role', entity_label: r.label, entity_id: r.id, details: {} });
  }

  function roleSummary(r) {
    const pages = ROLE_PAGE_OPTIONS.filter(([key]) => r.pages?.[key]?.view).map(([key, label, editable]) => (editable && r.pages[key].edit ? `${label} (editar)` : label));
    return pages.length ? pages.join(', ') : 'Sin páginas asignadas';
  }

  const visibleUsers = isSuperAdmin ? staffUsers : staffUsers.filter((u) => u.role !== 'superadmin');
  const columns = [
    { key: 'username', label: 'Usuario', render: (u) => <b>{u.username}</b> },
    { key: 'name', label: 'Nombre', render: (u) => u.name },
    { key: 'email', label: 'Correo', render: (u) => u.email || '—' },
    { key: 'role', label: 'Rol', render: (u) => <span className={`badge ${isBuiltinRole(u.role) ? 'off' : 'violet-badge'}`}>{roleLabel(u.role, customRoles)}</span> },
    { key: 'route', label: 'Ruta asignada', render: (u) => u.role === 'driver' ? routeName(u.routeId) : '—' },
    { key: 'id', label: 'Acciones', render: (u) => (
      <><button className="icon-btn" onClick={() => setEditing(u)}>Editar</button>{u.id !== user.id && <button className="icon-btn delete" onClick={() => handleDelete(u)}>×</button>}</>
    ) },
  ];

  const roleColumns = [
    { key: 'label', label: 'Rol', render: (r) => <b>{r.label}</b> },
    { key: 'summary', label: 'Acceso', render: (r) => <small className="muted">{roleSummary(r)}</small> },
    { key: 'id', label: 'Acciones', render: (r) => (
      <><button className="icon-btn" onClick={() => setEditingRole(r)}>Editar</button><button className="icon-btn delete" onClick={() => handleRoleDelete(r)}>×</button></>
    ) },
  ];

  if (loading) return <p className="muted">Cargando usuarios…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Usuarios y permisos</h1><p>Roles fijos: Administrador, Editor, Cocina y Driver, más los roles a medida que crees abajo.</p></div>
        <div className="head-actions"><button className="primary" onClick={() => setEditing({})}>+ Crear usuario</button></div>
      </div>
      <DataTable columns={columns} rows={visibleUsers} emptyText="No hay usuarios registrados." resizeGroup="users" userId={user?.id} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div><h1 style={{ fontSize: 19 }}>Roles a medida</h1><p>Elegí, página por página, qué puede ver y editar cada rol nuevo que crees.</p></div>
        <div className="head-actions"><button className="violet" onClick={() => setEditingRole({})}>+ Crear rol</button></div>
      </div>
      <DataTable columns={roleColumns} rows={customRoles} emptyText="No hay roles a medida todavía — solo los 4 fijos." resizeGroup="custom-roles" userId={user?.id} />

      <Modal title={editing?.id ? 'Editar usuario' : 'Crear usuario'} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        {editing && <UserFormFields editing={editing} isSuperAdmin={isSuperAdmin} routes={routes} drivers={drivers} customRoles={customRoles} />}
      </Modal>

      <Modal title={editingRole?.id ? 'Editar rol' : 'Crear rol'} open={!!editingRole} onClose={() => setEditingRole(null)} onSubmit={handleRoleSubmit}>
        {editingRole && <RoleFormFields role={editingRole} />}
      </Modal>
    </section>
  );
}

function UserFormFields({ editing, isSuperAdmin, routes, drivers, customRoles }) {
  const [role, setRole] = useState(editing.role || 'driver');
  const d = editing.driverId ? drivers.find((x) => x.id === editing.driverId) || {} : {};
  const showDriver = role === 'driver';

  return (
    <div className="form-grid">
      <label>Nombre de usuario *<input name="username" required defaultValue={editing.username} /></label>
      <label>Correo *<input type="email" name="email" required defaultValue={editing.email} /></label>
      <label>{editing.id ? 'Nueva contraseña' : 'Contraseña *'}<input type="password" name="password" required={!editing.id} autoComplete="new-password" /></label>
      <label>{editing.id ? 'Confirmar nueva contraseña' : 'Confirmar contraseña *'}<input type="password" name="passwordConfirm" required={!editing.id} autoComplete="new-password" /></label>
      <label>Rol
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {isSuperAdmin && <option value="superadmin">Super Administrador</option>}
          <option value="admin">Administrador</option>
          <option value="editor">Editor</option>
          <option value="kitchen">Cocina</option>
          <option value="driver">Driver</option>
          {customRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {isSuperAdmin && <small>Solo puede haber un Super Administrador.</small>}
      </label>
      <label>Nombre completo *<input name="name" required defaultValue={editing.name} /></label>
      {showDriver && <>
        <label>Carnet *<input name="carnet" required defaultValue={d.carnet} /></label>
        <label>Teléfono<input name="phone" defaultValue={d.phone} /></label>
        <label>Ruta asignada
          <select name="routeId" defaultValue={editing.routeId || ''}>
            <option value="">Ruta abierta</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="wide">Dirección de domicilio<input name="address" defaultValue={d.address} /></label>
      </>}
      {!showDriver && <p className="muted wide">Solo el rol Driver necesita ficha de driver y ruta asignada.</p>}
    </div>
  );
}

function RoleFormFields({ role }) {
  const pages = role.pages || {};
  return (
    <div className="form-grid">
      <label className="wide">Nombre del rol *<input name="label" required defaultValue={role.label} placeholder="Ej.: Supervisor de zona" /></label>
      <div className="wide sheet">
        <table>
          <thead><tr><th>Página</th><th>Ver</th><th>Editar</th></tr></thead>
          <tbody>
            {ROLE_PAGE_OPTIONS.map(([key, label, editable]) => (
              <tr key={key}>
                <td>{label}</td>
                <td><input type="checkbox" name={`view_${key}`} defaultChecked={!!pages[key]?.view} /></td>
                <td>{editable ? <input type="checkbox" name={`edit_${key}`} defaultChecked={!!pages[key]?.edit} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

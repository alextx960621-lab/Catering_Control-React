import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { rpc, dbInsertAudit, getSessionToken } from '../../../services/supabaseClient';
import { driverRouteIds } from '../../../services/dispatchHelpers';
import { ROLE_PAGE_OPTIONS, roleLabel, isBuiltinRole } from '../../../services/panelAuth';
import { removeStoredImage } from '../../../services/imageUpload';
import Modal from '../Modal';
import DataTable from '../DataTable';
import ImageField from '../ImageField';
import { uid } from '../panelUtils';

export default function UsersPage({ user }) {
  const { t } = useTranslation();
  const { staffUsers, saveStaffUsers, drivers, saveDrivers, routes, settings, saveSettings, showNotice, loading } = useOperations();
  const [editing, setEditing] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [editingRole, setEditingRole] = useState(null);
  const isSuperAdmin = user?.role === 'superadmin';
  const customRoles = settings.customRoles || [];

  // La foto del usuario es suya; si además es driver y no puso ninguna, se muestra la del registro de driver
  function userPhoto(u) {
    return u?.photoUrl || (u?.driverId ? drivers.find((d) => d.id === u.driverId)?.photoUrl : '') || '';
  }

  function openEdit(u) {
    setEditing(u || {});
    setPhotoUrl(userPhoto(u));
  }

  function routeName(id) { return routes.find((r) => r.id === id)?.name || (id ? t('panel.users.openRoute') : t('panel.users.noRoute')); }

  function driverRouteConflict(routeId, excludeDriverId) {
    if (!routeId) return null;
    return drivers.find((d) => d.id !== excludeDriverId && driverRouteIds(d).includes(routeId));
  }

  async function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const u = editing?.id ? editing : null;

    if (staffUsers.some((x) => x.username === data.username && x.id !== u?.id)) { showNotice(t('panel.users.usernameExists'), true); return false; }
    if (staffUsers.some((x) => x.email.toLowerCase() === data.email.toLowerCase() && x.id !== u?.id)) { showNotice(t('panel.users.emailExists'), true); return false; }
    if (data.role === 'superadmin') {
      if (!isSuperAdmin) { showNotice(t('panel.users.onlySuperAdminCanAssign'), true); return false; }
      if (staffUsers.some((x) => x.role === 'superadmin' && x.id !== u?.id)) { showNotice(t('panel.users.superAdminExists'), true); return false; }
    }
    if (u?.role === 'superadmin' && data.role !== 'superadmin' && !isSuperAdmin) { showNotice(t('panel.users.onlySelfCanRemoveSuperAdmin'), true); return false; }
    if (data.password && data.password.length < 8) { showNotice(t('panel.users.passwordMinLength'), true); return false; }
    if (data.password && data.password !== data.passwordConfirm) { showNotice(t('panel.users.passwordMismatch'), true); return false; }

    let passwordHash = u?.passwordHash || '';
    if (data.password) {
      passwordHash = await rpc('staff_hash_password', { p_token: getSessionToken(), p_password: data.password });
      if (!passwordHash) { showNotice(t('panel.users.passwordHashFailed'), true); return false; }
    } else if (!u) {
      showNotice(t('panel.users.passwordRequiredNew'), true);
      return false;
    }

    let driverId = u?.driverId;
    let updatedDrivers = drivers;
    if (data.role === 'driver') {
      const conflict = driverRouteConflict(data.routeId, driverId);
      if (conflict) { showNotice(t('panel.users.routeAlreadyAssigned', { route: routeName(data.routeId), driver: `${conflict.firstName} ${conflict.lastName}` }), true); return false; }
      const existingDriver = drivers.find((d) => d.id === driverId);
      const parts = data.name.trim().split(/\s+/);
      const driverData = { firstName: parts.shift() || data.name, lastName: parts.join(' ') || '', carnet: data.carnet, phone: data.phone, address: data.address, routeId: data.routeId, photoUrl: data.photoUrl };
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
    // La foto de un usuario-driver vive en su registro de driver (lo que usan Despacho y Entregas).
    // Y no se copia la del driver al usuario: dos dueños de un mismo archivo lo borran por partida doble.
    const linkedDriverPhoto = u?.driverId ? drivers.find((d) => d.id === u.driverId)?.photoUrl : '';
    const ownPhoto = data.role === 'driver' || !photoUrl || photoUrl === linkedDriverPhoto ? '' : photoUrl;
    const userData = { username: data.username, email: data.email, passwordHash, name: data.name, role: data.role, routeId: data.role === 'driver' ? data.routeId : '', driverId: data.role === 'driver' ? driverId : '', photoUrl: ownPhoto };
    const finalUser = u ? { ...u, ...userData } : { id: uid('u'), ...userData };
    saveStaffUsers(u ? staffUsers.map((x) => (x.id === finalUser.id ? finalUser : x)) : [...staffUsers, finalUser]);
    showNotice(data.role === 'driver' ? t('panel.users.userDriverSaved') : t('panel.users.userSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Usuario creado' : 'Usuario editado', entity_type: 'user', entity_label: `${finalUser.name} (${finalUser.username})`, entity_id: finalUser.id, details: { rol: finalUser.role } });
  }

  function handleDelete(u) {
    if (u.id === user.id) { showNotice(t('panel.users.cannotDeleteSelf'), true); return; }
    if (u.role === 'superadmin' && !isSuperAdmin) { showNotice(t('panel.users.cannotDeleteSuperAdmin'), true); return; }
    if (!confirm(t('panel.users.confirmDeleteUser'))) return;
    if (u.photoUrl) removeStoredImage(u.photoUrl);
    saveStaffUsers(staffUsers.filter((x) => x.id !== u.id));
    showNotice(t('panel.users.userDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Usuario eliminado', entity_type: 'user', entity_label: `${u.name} (${u.username})`, entity_id: u.id, details: {} });
  }

  // Roles a medida
  function handleRoleSubmit(form) {
    const label = form.elements.label.value.trim();
    if (!label) { showNotice(t('panel.users.roleNameRequired'), true); return false; }
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
    showNotice(isNew ? t('panel.users.roleCreated') : t('panel.users.roleUpdated'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Rol creado' : 'Rol editado', entity_type: 'role', entity_label: label, entity_id: editingRole?.id || '', details: {} });
  }

  function handleRoleDelete(r) {
    const inUse = staffUsers.filter((u) => u.role === r.id);
    if (inUse.length) { showNotice(t('panel.users.roleInUse', { count: inUse.length, role: r.label }), true); return; }
    if (!confirm(t('panel.users.confirmDeleteRole', { role: r.label }))) return;
    saveSettings({ ...settings, customRoles: customRoles.filter((x) => x.id !== r.id) });
    showNotice(t('panel.users.roleDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Rol eliminado', entity_type: 'role', entity_label: r.label, entity_id: r.id, details: {} });
  }

  function roleSummary(r) {
    const pages = ROLE_PAGE_OPTIONS.filter(([key]) => r.pages?.[key]?.view).map(([key, label, editable]) => {
      const pageName = t(`panel.nav.${key}`, { defaultValue: label });
      return editable && r.pages[key].edit ? t('panel.users.pageWithEdit', { page: pageName }) : pageName;
    });
    return pages.length ? pages.join(', ') : t('panel.users.noPagesAssigned');
  }

  const visibleUsers = isSuperAdmin ? staffUsers : staffUsers.filter((u) => u.role !== 'superadmin');
  const columns = [
    { key: 'username', label: t('panel.users.username'), render: (u) => <b>{u.username}</b> },
    { key: 'name', label: t('panel.common.name'), render: (u) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)' }}>
          {userPhoto(u) ? <img src={userPhoto(u)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
        </div>
        <span>{u.name}</span>
      </div>
    ) },
    { key: 'email', label: t('panel.users.email'), render: (u) => u.email || '—' },
    { key: 'role', label: t('panel.users.role'), render: (u) => <span className={`badge ${isBuiltinRole(u.role) ? 'off' : 'violet-badge'}`}>{t(`panel.roles.${u.role}`, { defaultValue: roleLabel(u.role, customRoles) })}</span> },
    { key: 'route', label: t('panel.users.assignedRoute'), render: (u) => u.role === 'driver' ? routeName(u.routeId) : '—' },
    { key: 'id', label: t('panel.common.actions'), render: (u) => (
      <><button className="icon-btn info" onClick={() => openEdit(u)}>{t('panel.common.edit')}</button>{u.id !== user.id && <button className="icon-btn delete" onClick={() => handleDelete(u)}>{t('panel.users.remove')}</button>}</>
    ) },
  ];

  const roleColumns = [
    { key: 'label', label: t('panel.users.role'), render: (r) => <b>{r.label}</b> },
    { key: 'summary', label: t('panel.users.access'), render: (r) => <small className="muted">{roleSummary(r)}</small> },
    { key: 'id', label: t('panel.common.actions'), render: (r) => (
      <><button className="icon-btn info" onClick={() => setEditingRole(r)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleRoleDelete(r)}>{t('panel.users.remove')}</button></>
    ) },
  ];

  if (loading) return <p className="muted">{t('panel.users.loading')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.users.title')}</h1><p>{t('panel.users.description')}</p></div>
        <div className="head-actions"><button className="primary" onClick={() => openEdit(null)}>+ {t('panel.users.createUser')}</button></div>
      </div>
      <DataTable columns={columns} rows={visibleUsers} emptyText={t('panel.users.usersEmpty')} resizeGroup="users" userId={user?.id} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div><h1 style={{ fontSize: 19 }}>{t('panel.users.customRolesTitle')}</h1><p>{t('panel.users.customRolesDescription')}</p></div>
        <div className="head-actions"><button className="info" onClick={() => setEditingRole({})}>+ {t('panel.users.createRole')}</button></div>
      </div>
      <DataTable columns={roleColumns} rows={customRoles} emptyText={t('panel.users.rolesEmpty')} resizeGroup="custom-roles" userId={user?.id} />

      <Modal title={editing?.id ? t('panel.users.editUser') : t('panel.users.createUser')} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        {editing && <UserFormFields editing={editing} photoUrl={photoUrl} setPhotoUrl={setPhotoUrl} isSuperAdmin={isSuperAdmin} routes={routes} drivers={drivers} customRoles={customRoles} />}
      </Modal>

      <Modal title={editingRole?.id ? t('panel.users.editRole') : t('panel.users.createRole')} open={!!editingRole} onClose={() => setEditingRole(null)} onSubmit={handleRoleSubmit}>
        {editingRole && <RoleFormFields role={editingRole} />}
      </Modal>
    </section>
  );
}

function UserFormFields({ editing, photoUrl, setPhotoUrl, isSuperAdmin, routes, drivers, customRoles }) {
  const { t } = useTranslation();
  const [role, setRole] = useState(editing.role || 'driver');
  const d = editing.driverId ? drivers.find((x) => x.id === editing.driverId) || {} : {};
  const showDriver = role === 'driver';

  return (
    <div className="form-grid">
      <ImageField
        label={t('panel.users.photoOptional')}
        name="photoUrl"
        value={photoUrl}
        onChange={setPhotoUrl}
        folder="users"
        maxDim={300}
        hint={t('panel.users.photoHint')}
      />
      <label>{t('panel.users.username')} *<input name="username" required defaultValue={editing.username} /></label>
      <label>{t('panel.users.email')} *<input type="email" name="email" required autoComplete="email" defaultValue={editing.email} /></label>
      <label>{editing.id ? t('panel.users.newPassword') : `${t('panel.users.password')} *`}<input type="password" name="password" required={!editing.id} autoComplete="new-password" /></label>
      <label>{editing.id ? t('panel.users.confirmNewPassword') : `${t('panel.users.confirmPassword')} *`}<input type="password" name="passwordConfirm" required={!editing.id} autoComplete="new-password" /></label>
      <label>{t('panel.users.role')}
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {isSuperAdmin && <option value="superadmin">{t('panel.roles.superadmin')}</option>}
          <option value="admin">{t('panel.roles.admin')}</option>
          <option value="editor">{t('panel.roles.editor')}</option>
          <option value="kitchen">{t('panel.roles.kitchen')}</option>
          <option value="driver">{t('panel.roles.driver')}</option>
          {customRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {isSuperAdmin && <small>{t('panel.users.onlyOneSuperAdmin')}</small>}
      </label>
      <label>{t('panel.users.fullName')} *<input name="name" required defaultValue={editing.name} /></label>
      {showDriver && <>
        <label>{t('panel.users.carnet')} *<input name="carnet" required defaultValue={d.carnet} /></label>
        <label>{t('panel.common.phone')}<input name="phone" autoComplete="tel" defaultValue={d.phone} /></label>
        <label>{t('panel.users.assignedRoute')}
          <select name="routeId" defaultValue={editing.routeId || ''}>
            <option value="">{t('panel.users.noRoute')}</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="wide">{t('panel.users.homeAddress')}<input name="address" defaultValue={d.address} /></label>
      </>}
      {!showDriver && <p className="muted wide">{t('panel.users.onlyDriverNeedsCard')}</p>}
    </div>
  );
}

function RoleFormFields({ role }) {
  const { t } = useTranslation();
  const pages = role.pages || {};
  return (
    <div className="form-grid">
      <label className="wide">{t('panel.users.roleName')} *<input name="label" required defaultValue={role.label} placeholder={t('panel.users.roleNamePlaceholder')} /></label>
      <div className="wide sheet">
        <table>
          <thead><tr><th>{t('panel.users.pageColumn')}</th><th>{t('panel.users.viewColumn')}</th><th>{t('panel.common.edit')}</th></tr></thead>
          <tbody>
            {ROLE_PAGE_OPTIONS.map(([key, label, editable]) => (
              <tr key={key}>
                <td>{t(`panel.nav.${key}`, { defaultValue: label })}</td>
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

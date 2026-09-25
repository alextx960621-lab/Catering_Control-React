import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { driverRouteIds } from '../../../services/dispatchHelpers';
import Modal from '../Modal';
import DataTable from '../DataTable';
import ImageField from '../ImageField';
import { removeStoredImage } from '../../../services/imageUpload';
import { uid } from '../panelUtils';

export default function DriversPage({ user }) {
  const { t } = useTranslation();
  const { drivers, routes, clients, settings, saveDrivers, saveClients, showNotice, loading } = useOperations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  // El toast global queda tapado por el <dialog> abierto: los rechazos del formulario se avisan adentro
  const [formError, setFormError] = useState('');
  const canEdit = canManage(user?.role, settings.customRoles, 'drivers');

  function openEdit(d) {
    setEditing(d || {});
    setPhotoUrl(d?.photoUrl || '');
    setFormError('');
  }

  function routeName(id) {
    return routes.find((r) => r.id === id)?.name || t('panel.drivers.noRoute');
  }

  // Evita que una misma ruta quede asignada a dos drivers a la vez
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
      setFormError(t('panel.drivers.mainRouteDuplicate'));
      return false;
    }
    for (const rid of [data.routeId, ...extraRouteIds]) {
      const conflict = driverRouteConflict(rid, editing?.id);
      if (conflict) {
        setFormError(t('panel.drivers.routeConflict', { route: routeName(rid), name: `${conflict.firstName} ${conflict.lastName}` }));
        return false;
      }
    }
    setFormError('');

    const isNew = !editing?.id;
    data.photoUrl = photoUrl;
    let d;
    if (editing?.id) {
      d = { ...editing, ...data, extraRouteIds };
      saveDrivers(drivers.map((x) => (x.id === d.id ? d : x)));
      // Si el driver cambió de ruta, sus clientes lo siguen: la ruta real de un cliente está en la
      // dirección que usa ese día, así que hay que mover también esas direcciones (no solo routeId).
      const prevRouteIds = driverRouteIds(editing);
      if (d.routeId && prevRouteIds.length) {
        const moved = [];
        clients.filter((c) => c.driverId === d.id).forEach((c) => {
          const addresses = (c.addresses || []).map((a) => (prevRouteIds.includes(a.routeId) ? { ...a, routeId: d.routeId } : a));
          const addressesChanged = addresses.some((a, i) => a !== (c.addresses || [])[i]);
          const routeChanged = prevRouteIds.includes(c.routeId) && c.routeId !== d.routeId;
          if (addressesChanged || routeChanged) moved.push({ ...c, addresses, routeId: routeChanged ? d.routeId : c.routeId });
        });
        if (moved.length) saveClients(moved);
      }
    } else {
      d = { id: uid('d'), ...data, extraRouteIds };
      saveDrivers([...drivers, d]);
    }
    showNotice(t('panel.drivers.driverSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Driver creado' : 'Driver editado', entity_type: 'driver', entity_label: `${d.firstName || ''} ${d.lastName || ''}`.trim(), entity_id: d.id, details: {} });
  }

  function handleDelete(d) {
    if (!confirm(t('panel.drivers.confirmDelete'))) return;
    if (d.photoUrl) removeStoredImage(d.photoUrl);
    saveDrivers(drivers.filter((x) => x.id !== d.id));
    showNotice(t('panel.drivers.recordDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Driver eliminado', entity_type: 'driver', entity_label: `${d.firstName} ${d.lastName}`, entity_id: d.id, details: {} });
  }

  const columns = [
    { key: 'name', label: t('panel.common.name'), render: (d) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)' }}>
          {d.photoUrl ? <img src={d.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
        </div>
        <b>{d.firstName} {d.lastName}</b>
      </div>
    ) },
    { key: 'carnet', label: t('panel.drivers.carnet'), render: (d) => d.carnet || '—' },
    { key: 'phone', label: t('panel.common.phone'), render: (d) => d.phone || '—' },
    { key: 'address', label: t('panel.drivers.homeAddress'), render: (d) => d.address || '—' },
    { key: 'route', label: t('panel.common.route'), render: (d) => (
      <>{routeName(d.routeId)}{(d.extraRouteIds || []).length > 0 && <span className="badge warn" title={t('panel.drivers.backupRoutes')}> + {d.extraRouteIds.map(routeName).join(', ')}</span>}</>
    ) },
    { key: 'id', label: t('panel.common.actions'), render: (d) => canEdit ? (
      <><button className="icon-btn info" onClick={() => openEdit(d)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleDelete(d)}>{t('panel.drivers.remove')}</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">{t('panel.drivers.loading')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.drivers')}</h1><p>{t('panel.drivers.subtitle')}</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => openEdit(null)}>+ {t('panel.drivers.addDriver')}</button></div>}
      </div>

      <DataTable columns={columns} rows={list} search={search} onSearchChange={setSearch} searchPlaceholder={t('panel.drivers.searchPlaceholder')} emptyText={t('panel.drivers.empty')} resizeGroup="drivers" userId={user?.id} />

      <Modal title={editing?.id ? t('panel.drivers.editTitle') : t('panel.drivers.addDriver')} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <ImageField
            label={t('panel.drivers.photoOptional')}
            name="photoUrl"
            value={photoUrl}
            onChange={setPhotoUrl}
            folder="drivers"
            maxDim={300}
            hint={t('panel.drivers.photoHint')}
          />
          <label>{t('panel.common.name')} *<input name="firstName" required defaultValue={editing?.firstName} /></label>
          <label>{t('panel.drivers.lastName')} *<input name="lastName" required defaultValue={editing?.lastName} /></label>
          <label>{t('panel.drivers.carnet')} *<input name="carnet" required defaultValue={editing?.carnet} /></label>
          <label>{t('panel.common.phone')} *<input name="phone" required autoComplete="tel" defaultValue={editing?.phone} /></label>
          <label className="wide">{t('panel.drivers.addressForm')} *<input name="address" required defaultValue={editing?.address} /></label>
          <label>{t('panel.drivers.assignedRoute')}
            <select name="routeId" defaultValue={editing?.routeId || ''}>
              <option value="">{t('panel.drivers.noRoute')}</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="wide">{t('panel.drivers.extraRoutes')}
            <select name="extraRouteIds" multiple size={4} defaultValue={editing?.extraRouteIds || []}>
              {/* "Ruta abierta" no se puede tomar como extra: es justamente no tener ruta de trabajo */}
              {routes.filter((r) => !r.open).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <small>{t('panel.drivers.extraRoutesHint')}</small>
          </label>
        </div>
      </Modal>
    </section>
  );
}

import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { effectiveRouteId, driverRouteIds } from '../../../services/dispatchHelpers';
import { dbInsertAudit } from '../../../services/supabaseClient';
import Modal from '../Modal';
import DataTable from '../DataTable';
import { uid } from '../panelUtils';

const ROUTE_TYPES = { short: 'done', long: 'pending', verylong: 'warn' };
const ROUTE_TYPE_LABELS = { short: 'panel.routes.typeShort', long: 'panel.routes.typeLong', verylong: 'panel.routes.typeVeryLong' };

export default function RoutesPage({ user }) {
  const { t } = useTranslation();
  const { routes, clients, drivers, settings, currentDate, saveRoutes, showNotice, loading } = useOperations();
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
    showNotice(t('panel.routes.routeSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Ruta creada' : 'Ruta editada', entity_type: 'route', entity_label: r.name, entity_id: r.id, details: {} });
  }

  // Una ruta sigue "en uso" si alguna dirección del cliente la apunta, aunque hoy no le toque
  function routeInUse(r) {
    return clients.some((c) => c.routeId === r.id || (c.addresses || []).some((a) => a.routeId === r.id))
      || drivers.some((d) => driverRouteIds(d).includes(r.id));
  }

  function handleDelete(r) {
    if (routeInUse(r)) {
      showNotice(t('panel.routes.cannotDeleteAssignedRoute'), true);
      return;
    }
    if (!confirm(t('panel.routes.confirmDeleteRoute'))) return;
    saveRoutes(routes.filter((x) => x.id !== r.id));
    showNotice(t('panel.routes.recordDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Ruta eliminada', entity_type: 'route', entity_label: r.name, entity_id: r.id, details: {} });
  }

  const columns = [
    { key: 'name', label: t('panel.common.route'), render: (r) => <>{<b>{r.name}</b>}{r.open && <span className="badge off"> {t('panel.routes.open')}</span>}</> },
    { key: 'type', label: t('panel.routes.type'), render: (r) => { const cl = ROUTE_TYPES[r.type] || ROUTE_TYPES.short; const label = t(ROUTE_TYPE_LABELS[r.type] || ROUTE_TYPE_LABELS.short); return <span className={`badge ${cl}`}>{label}</span>; } },
    { key: 'description', label: t('panel.routes.description'), render: (r) => r.description || '—' },
    { key: 'clients', label: t('panel.routes.clients'), render: (r) => clients.filter((c) => effectiveRouteId(c, currentDate) === r.id).length },
    { key: 'drivers', label: t('panel.routes.drivers'), render: (r) => drivers.filter((d) => driverRouteIds(d).includes(r.id)).length },
    { key: 'id', label: t('panel.common.actions'), render: (r) => canEdit && !r.open ? (
      <><button className="icon-btn info" onClick={() => setEditing(r)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleDelete(r)}>{t('panel.routes.remove')}</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">{t('panel.routes.loadingRoutes')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.routes')}</h1><p>{t('panel.routes.subtitle')}</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => setEditing({})}>+ {t('panel.routes.createRoute')}</button></div>}
      </div>

      <DataTable columns={columns} rows={list} search={search} onSearchChange={setSearch} searchPlaceholder={t('panel.routes.searchPlaceholder')} emptyText={t('panel.routes.noRoutes')} resizeGroup="routes" userId={user?.id} />

      <Modal title={editing?.id ? t('panel.routes.editRoute') : t('panel.routes.createRoute')} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>{t('panel.routes.routeNameLabel')} *<input name="name" required defaultValue={editing?.name} /></label>
          <label>{t('panel.routes.order')}<input type="number" min="0" name="order" defaultValue={editing?.order} /></label>
          <label>{t('panel.routes.routeType')}
            <select name="type" defaultValue={editing?.type || 'short'}>
              <option value="short">{t('panel.routes.typeShort')}</option>
              <option value="long">{t('panel.routes.typeLong')}</option>
              <option value="verylong">{t('panel.routes.typeVeryLong')}</option>
            </select>
          </label>
          <label className="wide">{t('panel.routes.descriptionZone')}<input name="description" defaultValue={editing?.description} /></label>
        </div>
      </Modal>
    </section>
  );
}

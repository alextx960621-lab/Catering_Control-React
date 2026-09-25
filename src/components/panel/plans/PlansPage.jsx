import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { useCompanyPrefs } from '../../../context/CompanyPrefsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import Modal from '../Modal';
import DataTable from '../DataTable';
import ImageField from '../ImageField';
import { removeStoredImage } from '../../../services/imageUpload';
import { uid } from '../panelUtils';

function ReassignPlanModal({ open, onClose, plans, clients, saveClients, showNotice, logAudit, planName }) {
  const { t } = useTranslation();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [checked, setChecked] = useState(new Set());
  const targets = plans.length && fromId ? clients.filter((c) => c.planId === fromId) : [];

  function toggleAll() {
    if (checked.size === targets.length) setChecked(new Set());
    else setChecked(new Set(targets.map((c) => c.id)));
  }
  function toggleOne(id) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }
  function handleFromChange(id) {
    setFromId(id);
    setChecked(new Set(clients.filter((c) => c.planId === id).map((c) => c.id)));
  }

  function handleSubmit() {
    if (!fromId || !toId) { alert(t('panel.plans.selectOriginAndDestination')); return false; }
    if (fromId === toId) { alert(t('panel.plans.sameOriginAndDestination')); return false; }
    const selected = clients.filter((c) => checked.has(c.id));
    if (!selected.length) { alert(t('panel.plans.noClientsSelected')); return false; }
    const toPlanObj = plans.find((p) => p.id === toId);
    saveClients(selected.map((c) => ({ ...c, planId: toId, items: { ...(toPlanObj?.items || {}) } })));
    showNotice(t('panel.plans.clientsReassigned', { count: selected.length, from: planName(fromId), to: planName(toId) }));
    logAudit('Clientes reasignados de plan', `${planName(fromId)} → ${planName(toId)}`, toId, { clientes: selected.length });
  }

  return (
    <Modal title={t('panel.plans.reassignClients')} open={open} onClose={onClose} onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>{t('panel.plans.currentPlanOrigin')} *
          <select id="reassign-from-plan" name="reassign-from-plan" value={fromId} onChange={(e) => handleFromChange(e.target.value)} required>
            <option value="">{t('panel.plans.selectOption')}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>{t('panel.plans.newPlanDestination')} *
          <select id="reassign-to-plan" name="reassign-to-plan" value={toId} onChange={(e) => setToId(e.target.value)} required>
            <option value="">{t('panel.plans.selectOption')}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="wide">
          {!fromId ? (
            <p className="muted">{t('panel.plans.chooseOriginHint')}</p>
          ) : !targets.length ? (
            <p className="muted">{t('panel.plans.noClientsWithPlan', { plan: planName(fromId) })}</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b>{t('panel.plans.clientsWithPlanCount', { count: targets.length })}</b>
                <button type="button" className="info" style={{ padding: '4px 10px' }} onClick={toggleAll}>{t('panel.plans.toggleAll')}</button>
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--panel-line)', borderRadius: 8, padding: 8, display: 'grid', gap: 4 }}>
                {targets.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggleOne(c.id)} style={{ width: 'auto', minHeight: 'auto' }} />{c.name}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PlansPage({ user }) {
  const { t } = useTranslation();
  const { plans, settings, clients, savePlans, saveClients, saveSettings, showNotice, loading } = useOperations();
  const { formatMoney, currencySymbol } = useCompanyPrefs();
  const [editingPlan, setEditingPlan] = useState(null);
  const [planPhoto, setPlanPhoto] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const canEdit = canManage(user?.role, settings.customRoles, 'plans');
  const menuItems = settings.menuItems || [];

  function planName(id) { return plans.find((p) => p.id === id)?.name || t('panel.plans.noPlan'); }
  function logAudit(action, label, id, details = {}) {
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action, entity_type: 'plan', entity_label: label, entity_id: id, details });
  }

  function openPlan(p) {
    setEditingPlan(p || {});
    setPlanPhoto(p?.photoUrl || '');
  }

  function handlePlanSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    data.photoUrl = planPhoto;
    data.cost = n(data.cost);
    data.serviceDays = n(data.serviceDays);
    data.availableForPurchase = !!form.elements.availableForPurchase?.checked;
    const items = {};
    menuItems.forEach(({ key }) => { items[key] = n(data[`item_${key}`]); delete data[`item_${key}`]; });
    const isNew = !editingPlan?.id;
    let p;
    if (editingPlan?.id) {
      p = { ...editingPlan, ...data, items };
      savePlans(plans.map((x) => (x.id === p.id ? p : x)));
    } else {
      p = { id: uid('p'), ...data, items };
      savePlans([...plans, p]);
    }
    showNotice(t('panel.plans.planSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Plan creado' : 'Plan editado', entity_type: 'plan', entity_label: p.name, entity_id: p.id, details: {} });
  }

  function handlePlanDelete(p) {
    if (clients.some((c) => c.planId === p.id)) {
      showNotice(t('panel.plans.cannotDeleteAssignedPlan'), true);
      return;
    }
    if (!confirm(t('panel.plans.confirmDeletePlan', { name: p.name }))) return;
    if (p.photoUrl) removeStoredImage(p.photoUrl);
    savePlans(plans.filter((x) => x.id !== p.id));
    showNotice(t('panel.plans.planDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Plan eliminado', entity_type: 'plan', entity_label: p.name, entity_id: p.id, details: {} });
  }

  function handleItemSubmit(form) {
    const label = form.elements.label.value.trim();
    if (!label) { showNotice(t('panel.plans.nameCannotBeEmpty'), true); return false; }
    const isNew = !editingItem?.key;
    const updated = isNew
      ? [...menuItems, { key: uid('item'), label }]
      : menuItems.map((m) => (m.key === editingItem.key ? { ...m, label } : m));
    saveSettings({ ...settings, menuItems: updated });
    showNotice(isNew ? t('panel.plans.itemCreated') : t('panel.plans.itemUpdated'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Artículo de menú creado' : 'Artículo de menú editado', entity_type: 'menu-item', entity_label: label, entity_id: editingItem?.key || '', details: {} });
  }

  function handleItemDelete(item) {
    if (menuItems.length <= 1) { showNotice(t('panel.plans.atLeastOneItem'), true); return; }
    if (!confirm(t('panel.plans.confirmDeleteItem', { name: item.label }))) return;
    const updatedPlans = plans.map((p) => {
      if (!p.items || !(item.key in p.items)) return p;
      const items = { ...p.items };
      delete items[item.key];
      return { ...p, items };
    });
    savePlans(updatedPlans);
    saveSettings({ ...settings, menuItems: menuItems.filter((m) => m.key !== item.key) });
    showNotice(t('panel.plans.itemDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Artículo de menú eliminado', entity_type: 'menu-item', entity_label: item.label, entity_id: item.key, details: {} });
  }

  const planColumns = [
    { key: 'name', label: t('panel.common.plan'), render: (p) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)' }}>
          {p.photoUrl ? <img src={p.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🍽️'}
        </div>
        <b>{p.name}</b>
      </div>
    ) },
    { key: 'type', label: t('panel.plans.type'), render: (p) => p.type || t('panel.plans.typeGeneral') },
    { key: 'cost', label: t('panel.plans.cost'), render: (p) => n(p.cost) ? formatMoney(n(p.cost)) : '—' },
    { key: 'serviceDays', label: t('panel.plans.daysIncluded'), render: (p) => n(p.serviceDays) || '—' },
    { key: 'availableForPurchase', label: t('panel.plans.inClientPortal'), render: (p) => <span className={`badge ${p.availableForPurchase ? 'active' : 'off'}`}>{p.availableForPurchase ? t('panel.common.yes') : t('panel.common.no')}</span> },
    ...menuItems.map(({ key, label }) => ({ key, label, render: (p) => n(p.items?.[key]) })),
    { key: 'id', label: t('panel.common.actions'), render: (p) => canEdit ? (
      <><button className="icon-btn info" onClick={() => openPlan(p)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handlePlanDelete(p)}>{t('panel.plans.remove')}</button></>
    ) : '—' },
  ];

  const itemColumns = [
    { key: 'label', label: t('panel.plans.item'), render: (m) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)', fontSize: 13 }}>
          {settings.itemIcons?.[m.key] ? <img src={settings.itemIcons[m.key]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🍽'}
        </div>
        {m.label}
      </div>
    ) },
    { key: 'id', label: t('panel.common.actions'), render: (m) => canEdit ? (
      <><button className="icon-btn info" onClick={() => setEditingItem(m)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleItemDelete(m)}>{t('panel.plans.remove')}</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">{t('panel.plans.loadingPlans')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.plans')}</h1><p>{t('panel.plans.subtitle')}</p></div>
        {canEdit && (
          <div className="head-actions">
            <button className="primary" onClick={() => openPlan(null)}>+ {t('panel.plans.createPlan')}</button>
            <button className="violet" onClick={() => setReassigning(true)}>{t('panel.plans.reassignClients')}</button>
            <button className="primary" onClick={() => setEditingItem({})}>+ {t('panel.plans.createItem')}</button>
          </div>
        )}
      </div>

      <DataTable columns={planColumns} rows={plans} emptyText={t('panel.plans.noPlans')} resizeGroup="plans" userId={user?.id} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div><h1 style={{ fontSize: 19 }}>{t('panel.plans.menuItemsTitle')}</h1><p>{t('panel.plans.menuItemsSubtitle')}</p></div>
      </div>
      <DataTable columns={itemColumns} rows={menuItems} getRowId={(m) => m.key} emptyText={t('panel.plans.noItems')} resizeGroup="plan-items" userId={user?.id} />

      <Modal title={editingPlan?.id ? t('panel.plans.editPlan') : t('panel.plans.createPlan')} open={!!editingPlan} onClose={() => setEditingPlan(null)} onSubmit={handlePlanSubmit}>
        <div className="form-grid">
          <ImageField
            label={t('panel.plans.planPhotoLabel')}
            name="photoUrl"
            value={planPhoto}
            onChange={setPlanPhoto}
            folder="plans"
            maxDim={300}
            aspect="4-3"
            hint={t('panel.plans.planPhotoHint')}
          />
          <label>{t('panel.plans.planNameLabel')} *<input name="name" required defaultValue={editingPlan?.name} /></label>
          <label>{t('panel.plans.cost')} ({currencySymbol})<input type="number" min="0" step="0.01" name="cost" defaultValue={n(editingPlan?.cost)} /></label>
          <label>{t('panel.plans.serviceDaysLabel')}<input type="number" min="1" step="1" name="serviceDays" placeholder={t('panel.plans.serviceDaysPlaceholder')} defaultValue={n(editingPlan?.serviceDays) || ''} /></label>
          <label className="wide"><input type="checkbox" name="availableForPurchase" defaultChecked={!!editingPlan?.availableForPurchase} style={{ width: 'auto', minHeight: 'auto', verticalAlign: -2, marginRight: 6 }} /> {t('panel.plans.availableForPurchaseLabel')}</label>
          <label>{t('panel.plans.type')}<input name="type" defaultValue={editingPlan?.type} placeholder={t('panel.plans.typeGeneral')} /></label>
          {menuItems.map(({ key, label }) => (
            <label key={key}>{label}<input type="number" min="0" name={`item_${key}`} defaultValue={n(editingPlan?.items?.[key])} /></label>
          ))}
        </div>
      </Modal>

      <Modal title={editingItem?.key ? t('panel.plans.editItem') : t('panel.plans.createItem')} open={!!editingItem} onClose={() => setEditingItem(null)} onSubmit={handleItemSubmit}>
        <div className="form-grid">
          <label className="wide">{t('panel.plans.itemNameLabel')} *<input name="label" required defaultValue={editingItem?.label} placeholder={t('panel.plans.itemNamePlaceholder')} /></label>
          {editingItem?.key && (
            <ImageField
              label={t('panel.plans.itemIconLabel')}
              name="_icon"
              value={settings.itemIcons?.[editingItem.key] || ''}
              onChange={(url) => saveSettings({ ...settings, itemIcons: { ...settings.itemIcons, [editingItem.key]: url } })}
              folder="item-icons"
              maxDim={120}
              hint={t('panel.plans.itemIconHint')}
            />
          )}
        </div>
      </Modal>

      <ReassignPlanModal
        open={reassigning}
        onClose={() => setReassigning(false)}
        plans={plans}
        clients={clients}
        saveClients={saveClients}
        showNotice={showNotice}
        logAudit={logAudit}
        planName={planName}
      />
    </section>
  );
}

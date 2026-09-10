import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import Modal from '../Modal';
import DataTable from '../DataTable';
import ImageField from '../ImageField';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function ReassignPlanModal({ open, onClose, plans, clients, saveClients, showNotice, logAudit, planName }) {
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
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  }
  function handleFromChange(id) {
    setFromId(id);
    setChecked(new Set(clients.filter((c) => c.planId === id).map((c) => c.id)));
  }

  function handleSubmit() {
    if (!fromId || !toId) { alert('Selecciona el plan de origen y el de destino.'); return false; }
    if (fromId === toId) { alert('El plan de origen y destino no pueden ser el mismo.'); return false; }
    const selected = clients.filter((c) => checked.has(c.id));
    if (!selected.length) { alert('No hay clientes seleccionados para reasignar.'); return false; }
    const toPlanObj = plans.find((p) => p.id === toId);
    saveClients(selected.map((c) => ({ ...c, planId: toId, items: { ...(toPlanObj?.items || {}) } })));
    showNotice(`${selected.length} cliente(s) reasignado(s) de "${planName(fromId)}" a "${planName(toId)}".`);
    logAudit('Clientes reasignados de plan', `${planName(fromId)} → ${planName(toId)}`, toId, { clientes: selected.length });
  }

  return (
    <Modal title="Reasignar clientes de plan" open={open} onClose={onClose} onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>Plan actual (origen) *
          <select value={fromId} onChange={(e) => handleFromChange(e.target.value)} required>
            <option value="">Selecciona…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Plan nuevo (destino) *
          <select value={toId} onChange={(e) => setToId(e.target.value)} required>
            <option value="">Selecciona…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="wide">
          {!fromId ? (
            <p className="muted">Elegí el plan de origen para ver qué clientes lo tienen.</p>
          ) : !targets.length ? (
            <p className="muted">No hay clientes con el plan "{planName(fromId)}".</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b>Clientes con este plan ({targets.length})</b>
                <button type="button" className="outline" style={{ padding: '4px 10px' }} onClick={toggleAll}>Seleccionar/quitar todos</button>
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
  const { plans, settings, clients, savePlans, saveClients, saveSettings, showNotice, loading } = useOperations();
  const [editingPlan, setEditingPlan] = useState(null);
  const [planPhoto, setPlanPhoto] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const canEdit = canManage(user?.role, settings.customRoles, 'plans');
  const menuItems = settings.menuItems || [];

  function planName(id) { return plans.find((p) => p.id === id)?.name || 'Sin plan'; }
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
    showNotice('Plan guardado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Plan creado' : 'Plan editado', entity_type: 'plan', entity_label: p.name, entity_id: p.id, details: {} });
  }

  function handlePlanDelete(p) {
    if (clients.some((c) => c.planId === p.id)) {
      showNotice('No se puede eliminar un plan asignado a clientes. Reasígnalos primero.', true);
      return;
    }
    if (!confirm(`¿Eliminar el plan "${p.name}"?`)) return;
    savePlans(plans.filter((x) => x.id !== p.id));
    showNotice('Plan eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Plan eliminado', entity_type: 'plan', entity_label: p.name, entity_id: p.id, details: {} });
  }

  function handleItemSubmit(form) {
    const label = form.elements.label.value.trim();
    if (!label) { showNotice('El nombre no puede estar vacío.', true); return false; }
    const isNew = !editingItem?.key;
    const updated = isNew
      ? [...menuItems, { key: uid('item'), label }]
      : menuItems.map((m) => (m.key === editingItem.key ? { ...m, label } : m));
    saveSettings({ ...settings, menuItems: updated });
    showNotice(isNew ? 'Artículo creado.' : 'Artículo actualizado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: isNew ? 'Artículo de menú creado' : 'Artículo de menú editado', entity_type: 'menu-item', entity_label: label, entity_id: editingItem?.key || '', details: {} });
  }

  function handleItemDelete(item) {
    if (menuItems.length <= 1) { showNotice('Debe existir al menos un artículo en el menú.', true); return; }
    if (!confirm(`¿Eliminar el artículo "${item.label}"? Se quitará de planes y clientes que lo usen.`)) return;
    const updatedPlans = plans.map((p) => {
      if (!p.items || !(item.key in p.items)) return p;
      const items = { ...p.items };
      delete items[item.key];
      return { ...p, items };
    });
    savePlans(updatedPlans);
    saveSettings({ ...settings, menuItems: menuItems.filter((m) => m.key !== item.key) });
    showNotice('Artículo eliminado.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Artículo de menú eliminado', entity_type: 'menu-item', entity_label: item.label, entity_id: item.key, details: {} });
  }

  const planColumns = [
    { key: 'name', label: 'Plan', render: (p) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)' }}>
          {p.photoUrl ? <img src={p.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🍽️'}
        </div>
        <b>{p.name}</b>
      </div>
    ) },
    { key: 'type', label: 'Tipo', render: (p) => p.type || 'General' },
    { key: 'cost', label: 'Costo', render: (p) => n(p.cost) ? `Bs ${n(p.cost)}` : '—' },
    { key: 'serviceDays', label: 'Días incluidos', render: (p) => n(p.serviceDays) || '—' },
    { key: 'availableForPurchase', label: 'En portal cliente', render: (p) => <span className={`badge ${p.availableForPurchase ? 'active' : 'off'}`}>{p.availableForPurchase ? 'Sí' : 'No'}</span> },
    ...menuItems.map(({ key, label }) => ({ key, label, render: (p) => n(p.items?.[key]) })),
    { key: 'id', label: 'Acciones', render: (p) => canEdit ? (
      <><button className="icon-btn" onClick={() => openPlan(p)}>Editar</button><button className="icon-btn delete" onClick={() => handlePlanDelete(p)}>×</button></>
    ) : '—' },
  ];

  const itemColumns = [
    { key: 'label', label: 'Artículo', render: (m) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--panel-bg)', border: '1px solid var(--panel-line)', fontSize: 13 }}>
          {settings.itemIcons?.[m.key] ? <img src={settings.itemIcons[m.key]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🍽'}
        </div>
        {m.label}
      </div>
    ) },
    { key: 'id', label: 'Acciones', render: (m) => canEdit ? (
      <><button className="icon-btn" onClick={() => setEditingItem(m)}>Editar</button><button className="icon-btn delete" onClick={() => handleItemDelete(m)}>×</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">Cargando planes…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Planes</h1><p>Configuración de artículos incluidos por plan.</p></div>
        {canEdit && (
          <div className="head-actions">
            <button className="primary" onClick={() => openPlan(null)}>+ Crear plan</button>
            <button className="info" onClick={() => setReassigning(true)}>Reasignar clientes de plan</button>
            <button className="outline" onClick={() => setEditingItem({})}>+ Crear artículo</button>
          </div>
        )}
      </div>

      <DataTable columns={planColumns} rows={plans} emptyText="No hay planes creados todavía." resizeGroup="plans" userId={user?.id} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div><h1 style={{ fontSize: 19 }}>Artículos del menú</h1><p>Aparecen como columnas en Día de trabajo y en el portal del cliente.</p></div>
      </div>
      <DataTable columns={itemColumns} rows={menuItems} getRowId={(m) => m.key} emptyText="No hay artículos definidos." resizeGroup="plan-items" userId={user?.id} />

      <Modal title={editingPlan?.id ? 'Editar plan' : 'Crear plan'} open={!!editingPlan} onClose={() => setEditingPlan(null)} onSubmit={handlePlanSubmit}>
        <div className="form-grid">
          <ImageField label="Foto del plan (opcional)" name="photoUrl" value={planPhoto} onChange={setPlanPhoto} folder="plans" maxDim={300} />
          <label>Nombre del plan *<input name="name" required defaultValue={editingPlan?.name} /></label>
          <label>Costo (Bs)<input type="number" min="0" step="0.01" name="cost" defaultValue={n(editingPlan?.cost)} /></label>
          <label>Días de servicio incluidos<input type="number" min="1" step="1" name="serviceDays" placeholder="Ej: 20" defaultValue={n(editingPlan?.serviceDays) || ''} /></label>
          <label className="wide"><input type="checkbox" name="availableForPurchase" defaultChecked={!!editingPlan?.availableForPurchase} style={{ width: 'auto', minHeight: 'auto', verticalAlign: -2, marginRight: 6 }} /> Disponible en "Adquirir nuevo plan" (portal del cliente)</label>
          <label>Tipo<input name="type" defaultValue={editingPlan?.type} placeholder="General" /></label>
          {menuItems.map(({ key, label }) => (
            <label key={key}>{label}<input type="number" min="0" name={`item_${key}`} defaultValue={n(editingPlan?.items?.[key])} /></label>
          ))}
        </div>
      </Modal>

      <Modal title={editingItem?.key ? 'Editar artículo' : 'Crear artículo'} open={!!editingItem} onClose={() => setEditingItem(null)} onSubmit={handleItemSubmit}>
        <div className="form-grid">
          <label className="wide">Nombre del artículo *<input name="label" required defaultValue={editingItem?.label} placeholder="Ej.: Postre" /></label>
          {editingItem?.key && (
            <ImageField
              label="Ícono (opcional)"
              name="_icon"
              value={settings.itemIcons?.[editingItem.key] || ''}
              onChange={(url) => saveSettings({ ...settings, itemIcons: { ...settings.itemIcons, [editingItem.key]: url } })}
              folder="item-icons"
              maxDim={120}
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

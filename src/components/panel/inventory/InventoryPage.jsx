import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { canManageInventory } from '../../../services/panelAuth';
import Modal from '../Modal';
import DataTable from '../DataTable';
import { uid } from '../panelUtils';

const MOVEMENT_LABELS = { entry: 'Ingreso', waste: 'Merma', delivery: 'Entrega procesada', use: 'Uso' };

export default function InventoryPage({ user }) {
  const { t } = useTranslation();
  const { inventory, settings, saveInventory, showNotice, loading } = useOperations();
  const [editingItem, setEditingItem] = useState(null);
  const [editingLink, setEditingLink] = useState(null);
  const [movementModal, setMovementModal] = useState(null); // 'entry' | 'use' | 'waste'
  const [editingMovement, setEditingMovement] = useState(null);
  const canEdit = canManageInventory(user?.role, settings.customRoles);
  const menuItems = settings.menuItems || [];
  // Etiquetas traducidas para mostrar en tabla (MOVEMENT_LABELS queda fijo para auditoría)
  const movementLabels = {
    entry: t('panel.inventory.movementEntry'),
    waste: t('panel.inventory.movementWaste'),
    delivery: t('panel.inventory.movementDelivery'),
    use: t('panel.inventory.movementUse'),
  };

  function kitchenItem(id) { return inventory.items.find((i) => i.id === id); }
  function menuLabel(key) { return menuItems.find((m) => m.key === key)?.label || key; }

  function logAudit(action, label, id, details = {}) {
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action, entity_type: 'inventory', entity_label: label, entity_id: id, details });
  }

  function handleItemSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const isNew = !editingItem?.id;
    const item = { id: editingItem?.id || uid('inv'), name: data.name, unit: data.unit || 'unidades', stock: n(data.stock), minimum: n(data.minimum) };
    const items = isNew ? [...inventory.items, item] : inventory.items.map((i) => (i.id === item.id ? item : i));
    saveInventory({ ...inventory, items });
    showNotice(t('panel.inventory.itemSaved'));
    logAudit(isNew ? 'Producto de cocina creado' : 'Producto de cocina editado', item.name, item.id);
  }

  function handleItemDelete(item) {
    if (inventory.links.some((l) => l.inventoryId === item.id)) { showNotice(t('panel.inventory.itemHasLinks'), true); return; }
    if (!confirm(t('panel.inventory.confirmDeleteItem', { name: item.name }))) return;
    saveInventory({ ...inventory, items: inventory.items.filter((i) => i.id !== item.id) });
    showNotice(t('panel.inventory.itemDeleted'));
    logAudit('Producto de cocina eliminado', item.name, item.id);
  }

  function handleLinkSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const isNew = !editingLink?.id;
    const link = { id: editingLink?.id || uid('link'), inventoryId: data.inventoryId, clientItemKey: data.clientItemKey, quantity: n(data.quantity) };
    const links = isNew ? [...inventory.links, link] : inventory.links.map((l) => (l.id === link.id ? link : l));
    saveInventory({ ...inventory, links });
    showNotice(t('panel.inventory.linkSaved'));
    logAudit(isNew ? 'Vínculo de consumo creado' : 'Vínculo de consumo editado', `${kitchenItem(link.inventoryId)?.name} ↔ ${menuLabel(link.clientItemKey)}`, link.id);
  }

  function handleLinkDelete(link) {
    if (!confirm(t('panel.inventory.confirmDeleteLink'))) return;
    saveInventory({ ...inventory, links: inventory.links.filter((l) => l.id !== link.id) });
    showNotice(t('panel.inventory.linkDeleted'));
    logAudit('Vínculo de consumo eliminado', `${kitchenItem(link.inventoryId)?.name || ''} ↔ ${menuLabel(link.clientItemKey)}`, link.id);
  }

  function handleMovementSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const qty = Math.abs(n(data.quantity));
    if (!qty) return false;
    const type = editingMovement?.type || movementModal;
    const signedQty = type === 'entry' ? qty : -qty;
    const item = kitchenItem(data.inventoryId);
    if (!item) return false;
    if (editingMovement?.id) {
      // Editar un movimiento manual existente: primero se revierte su efecto anterior sobre el…
      const prev = editingMovement;
      const prevItem = kitchenItem(prev.inventoryId);
      const items = inventory.items.map((i) => {
        if (i.id === prevItem?.id) i = { ...i, stock: n(i.stock) - n(prev.quantity) };
        if (i.id === item.id) i = { ...i, stock: n(i.stock) + signedQty };
        return i;
      });
      const movement = { ...prev, inventoryId: item.id, quantity: signedQty, note: data.note || '' };
      saveInventory({ ...inventory, items, movements: inventory.movements.map((m) => (m.id === movement.id ? movement : m)) });
      showNotice(t('panel.inventory.movementUpdated'));
      logAudit('Movimiento de inventario editado', item.name, item.id, { cantidad: signedQty });
    } else {
      const movement = { id: uid('mov'), date: new Date().toISOString().slice(0, 10), inventoryId: item.id, type, quantity: signedQty, note: data.note || '' };
      saveInventory({ ...inventory, items: inventory.items.map((i) => (i.id === item.id ? { ...i, stock: n(i.stock) + signedQty } : i)), movements: [movement, ...inventory.movements] });
      showNotice(t('panel.inventory.movementRegistered'));
      logAudit(`Inventario: ${MOVEMENT_LABELS[type]}`, item.name, item.id, { cantidad: signedQty });
    }
  }

  // Eliminar un movimiento manual (entrada/uso/merma) revierte su efecto sobre el stock
  function handleMovementDelete(m) {
    if (m.type === 'delivery') return;
    if (!confirm(t('panel.inventory.confirmDeleteMovement'))) return;
    const item = kitchenItem(m.inventoryId);
    saveInventory({
      ...inventory,
      items: item ? inventory.items.map((i) => (i.id === item.id ? { ...i, stock: n(i.stock) - n(m.quantity) } : i)) : inventory.items,
      movements: inventory.movements.filter((x) => x.id !== m.id),
    });
    showNotice(t('panel.inventory.movementDeleted'));
    logAudit('Movimiento de inventario eliminado', item?.name || m.inventoryId, m.id, { tipo: m.type, cantidad: m.quantity, motivo: m.note });
  }

  const itemColumns = [
    { key: 'name', label: t('panel.inventory.colProduct'), render: (item) => (<>{<b>{item.name}</b>}{n(item.stock) <= n(item.minimum) && <span className="badge warn"> {t('panel.inventory.lowStock')}</span>}</>) },
    { key: 'unit', label: t('panel.inventory.unit'), render: (item) => item.unit || t('panel.inventory.units') },
    { key: 'stock', label: t('panel.inventory.stock'), render: (item) => n(item.stock) },
    { key: 'minimum', label: t('panel.inventory.minimum'), render: (item) => n(item.minimum) },
    { key: 'links', label: t('panel.inventory.colDeductedWith'), render: (item) => {
      const links = inventory.links.filter((l) => l.inventoryId === item.id);
      return links.length ? links.map((l) => `${n(l.quantity)} × ${menuLabel(l.clientItemKey)}`).join(', ') : '—';
    } },
    { key: 'id', label: t('panel.common.actions'), render: (item) => canEdit ? (
      <><button className="icon-btn info" onClick={() => setEditingItem(item)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleItemDelete(item)}>{t('panel.inventory.remove')}</button></>
    ) : '—' },
  ];

  const linkColumns = [
    { key: 'inventoryId', label: t('panel.inventory.kitchenProduct'), render: (l) => kitchenItem(l.inventoryId)?.name || t('panel.inventory.productDeleted') },
    { key: 'clientItemKey', label: t('panel.inventory.deliveredItem'), render: (l) => menuLabel(l.clientItemKey) },
    { key: 'quantity', label: t('panel.inventory.colQuantityPerDelivery'), render: (l) => n(l.quantity) },
    { key: 'id', label: t('panel.common.actions'), render: (l) => canEdit ? (
      <><button className="icon-btn info" onClick={() => setEditingLink(l)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleLinkDelete(l)}>{t('panel.inventory.remove')}</button></>
    ) : '—' },
  ];

  const movementColumns = [
    { key: 'date', label: t('panel.common.date'), render: (m) => m.date },
    { key: 'inventoryId', label: t('panel.inventory.colProduct'), render: (m) => kitchenItem(m.inventoryId)?.name || t('panel.inventory.productDeleted') },
    { key: 'quantity', label: t('panel.inventory.quantity'), render: (m) => (m.quantity > 0 ? `+${n(m.quantity)}` : n(m.quantity)) },
    { key: 'type', label: t('panel.inventory.colType'), render: (m) => movementLabels[m.type] || m.type },
    { key: 'note', label: t('panel.inventory.detail'), render: (m) => m.note || '—' },
    { key: 'id', label: t('panel.common.actions'), render: (m) => (canEdit && m.type !== 'delivery') ? (
      <><button className="icon-btn info" onClick={() => setEditingMovement(m)}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => handleMovementDelete(m)}>{t('panel.inventory.remove')}</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">{t('panel.inventory.loading')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.inventory')}</h1><p>{t('panel.inventory.description')}</p></div>
        {canEdit && (
          <div className="head-actions">
            <button className="primary" onClick={() => setEditingItem({})}>+ {t('panel.inventory.kitchenProduct')}</button>
            <button className="success" onClick={() => setMovementModal('entry')}>+ {t('panel.inventory.movementEntry')}</button>
            <button className="violet" onClick={() => setMovementModal('use')}>− {t('panel.inventory.movementUse')}</button>
            <button className="orange" onClick={() => setMovementModal('waste')}>− {t('panel.inventory.movementWaste')}</button>
            <button className="info" onClick={() => setEditingLink({})}>{t('panel.inventory.linkConsumption')}</button>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: -10, marginBottom: 14 }}>{t('panel.inventory.autoDiscountNote')}</p>

      <div className="two-col">
        <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>{t('panel.inventory.productsTitle')}</h3><DataTable columns={itemColumns} rows={inventory.items} emptyText={t('panel.inventory.productsEmpty')} resizeGroup="inventory-items" userId={user?.id} /></div>
        <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>{t('panel.inventory.linksTitle')}</h3><DataTable columns={linkColumns} rows={inventory.links} emptyText={t('panel.inventory.linksEmpty')} resizeGroup="inventory-links" userId={user?.id} /></div>
      </div>
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 12 }}>{t('panel.inventory.movementsTitle')}</h3>
        <DataTable columns={movementColumns} rows={inventory.movements.slice(0, 12)} emptyText={t('panel.inventory.movementsEmpty')} resizeGroup="inventory-movements" userId={user?.id} />
      </div>

      <Modal title={editingItem?.id ? t('panel.inventory.editProduct') : t('panel.inventory.kitchenProduct')} open={!!editingItem} onClose={() => setEditingItem(null)} onSubmit={handleItemSubmit}>
        <div className="form-grid">
          <label className="wide">{t('panel.common.name')} *<input name="name" required defaultValue={editingItem?.name} /></label>
          <label>{t('panel.inventory.unit')}<input name="unit" defaultValue={editingItem?.unit} placeholder={t('panel.inventory.units')} /></label>
          <label>{t('panel.inventory.currentStock')}<input type="number" min="0" name="stock" defaultValue={n(editingItem?.stock)} /></label>
          <label>{t('panel.inventory.minimumAlert')}<input type="number" min="0" name="minimum" defaultValue={n(editingItem?.minimum)} /></label>
        </div>
      </Modal>

      <Modal title={editingLink?.id ? t('panel.inventory.editLink') : t('panel.inventory.linkConsumption')} open={!!editingLink} onClose={() => setEditingLink(null)} onSubmit={handleLinkSubmit}>
        <div className="form-grid">
          <label>{t('panel.inventory.kitchenProduct')} *
            <select name="inventoryId" required defaultValue={editingLink?.inventoryId || ''}>
              <option value="" disabled>{t('panel.inventory.choose')}</option>
              {inventory.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label>{t('panel.inventory.deliveredItem')} *
            <select name="clientItemKey" required defaultValue={editingLink?.clientItemKey || ''}>
              <option value="" disabled>{t('panel.inventory.choose')}</option>
              {menuItems.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="wide">{t('panel.inventory.quantityPerDelivery')} *<input type="number" min="0" step="0.01" name="quantity" required defaultValue={n(editingLink?.quantity) || 1} /></label>
        </div>
      </Modal>

      <Modal title={editingMovement ? t('panel.inventory.editMovement') : movementModal === 'entry' ? t('panel.inventory.registerEntry') : movementModal === 'waste' ? t('panel.inventory.registerWaste') : t('panel.inventory.registerUse')} open={!!movementModal || !!editingMovement} onClose={() => { setMovementModal(null); setEditingMovement(null); }} onSubmit={handleMovementSubmit}>
        <div className="form-grid">
          <label className="wide">{t('panel.inventory.colProduct')} *
            <select name="inventoryId" required defaultValue={editingMovement?.inventoryId || ''}>
              <option value="" disabled>{t('panel.inventory.choose')}</option>
              {inventory.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label>{t('panel.inventory.quantity')} *<input type="number" min="0.01" step="0.01" name="quantity" required defaultValue={editingMovement ? Math.abs(n(editingMovement.quantity)) : ''} /></label>
          <label className="wide">{t('panel.inventory.detailOptional')}<input name="note" defaultValue={editingMovement?.note} /></label>
        </div>
      </Modal>
    </section>
  );
}

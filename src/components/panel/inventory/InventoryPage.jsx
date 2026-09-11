import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { canManageInventory } from '../../../services/panelAuth';
import Modal from '../Modal';
import DataTable from '../DataTable';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const MOVEMENT_LABELS = { entry: 'Ingreso', waste: 'Merma', delivery: 'Entrega procesada', use: 'Uso' };

export default function InventoryPage({ user }) {
  const { inventory, settings, saveInventory, showNotice, loading } = useOperations();
  const [editingItem, setEditingItem] = useState(null);
  const [editingLink, setEditingLink] = useState(null);
  const [movementModal, setMovementModal] = useState(null); // 'entry' | 'use' | 'waste'
  const [editingMovement, setEditingMovement] = useState(null);
  const canEdit = canManageInventory(user?.role, settings.customRoles);
  const menuItems = settings.menuItems || [];

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
    showNotice('Producto guardado.');
    logAudit(isNew ? 'Producto de cocina creado' : 'Producto de cocina editado', item.name, item.id);
  }

  function handleItemDelete(item) {
    if (inventory.links.some((l) => l.inventoryId === item.id)) { showNotice('Este producto tiene vínculos de consumo. Elimínalos primero.', true); return; }
    if (!confirm(`¿Eliminar "${item.name}"?`)) return;
    saveInventory({ ...inventory, items: inventory.items.filter((i) => i.id !== item.id) });
    showNotice('Producto eliminado.');
    logAudit('Producto de cocina eliminado', item.name, item.id);
  }

  function handleLinkSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const isNew = !editingLink?.id;
    const link = { id: editingLink?.id || uid('link'), inventoryId: data.inventoryId, clientItemKey: data.clientItemKey, quantity: n(data.quantity) };
    const links = isNew ? [...inventory.links, link] : inventory.links.map((l) => (l.id === link.id ? link : l));
    saveInventory({ ...inventory, links });
    showNotice('Vínculo guardado.');
    logAudit(isNew ? 'Vínculo de consumo creado' : 'Vínculo de consumo editado', `${kitchenItem(link.inventoryId)?.name} ↔ ${menuLabel(link.clientItemKey)}`, link.id);
  }

  function handleLinkDelete(link) {
    if (!confirm('¿Eliminar este vínculo?')) return;
    saveInventory({ ...inventory, links: inventory.links.filter((l) => l.id !== link.id) });
    showNotice('Vínculo eliminado.');
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
      // Editar un movimiento manual existente: primero se revierte su
      // efecto anterior sobre el stock, luego se aplica el nuevo valor.
      const prev = editingMovement;
      const prevItem = kitchenItem(prev.inventoryId);
      const items = inventory.items.map((i) => {
        if (i.id === prevItem?.id) i = { ...i, stock: n(i.stock) - n(prev.quantity) };
        if (i.id === item.id) i = { ...i, stock: n(i.stock) + signedQty };
        return i;
      });
      const movement = { ...prev, inventoryId: item.id, quantity: signedQty, note: data.note || '' };
      saveInventory({ ...inventory, items, movements: inventory.movements.map((m) => (m.id === movement.id ? movement : m)) });
      showNotice('Movimiento actualizado.');
      logAudit('Movimiento de inventario editado', item.name, item.id, { cantidad: signedQty });
    } else {
      const movement = { id: uid('mov'), date: new Date().toISOString().slice(0, 10), inventoryId: item.id, type, quantity: signedQty, note: data.note || '' };
      saveInventory({ ...inventory, items: inventory.items.map((i) => (i.id === item.id ? { ...i, stock: n(i.stock) + signedQty } : i)), movements: [movement, ...inventory.movements] });
      showNotice('Movimiento registrado.');
      logAudit(`Inventario: ${MOVEMENT_LABELS[type]}`, item.name, item.id, { cantidad: signedQty });
    }
  }

  // Eliminar un movimiento manual (entrada/uso/merma) revierte su efecto
  // sobre el stock. Los movimientos generados al "Procesar día" (type
  // 'delivery') no se pueden editar ni eliminar desde acá.
  function handleMovementDelete(m) {
    if (m.type === 'delivery') return;
    if (!confirm('¿Eliminar este movimiento? Se revertirá su efecto sobre el stock.')) return;
    const item = kitchenItem(m.inventoryId);
    saveInventory({
      ...inventory,
      items: item ? inventory.items.map((i) => (i.id === item.id ? { ...i, stock: n(i.stock) - n(m.quantity) } : i)) : inventory.items,
      movements: inventory.movements.filter((x) => x.id !== m.id),
    });
    showNotice('Movimiento eliminado y stock ajustado.');
    logAudit('Movimiento de inventario eliminado', item?.name || m.inventoryId, m.id, { tipo: m.type, cantidad: m.quantity, motivo: m.note });
  }

  const itemColumns = [
    { key: 'name', label: 'Producto', render: (item) => (<>{<b>{item.name}</b>}{n(item.stock) <= n(item.minimum) && <span className="badge warn"> Stock bajo</span>}</>) },
    { key: 'unit', label: 'Unidad', render: (item) => item.unit || 'unidades' },
    { key: 'stock', label: 'Stock', render: (item) => n(item.stock) },
    { key: 'minimum', label: 'Mínimo', render: (item) => n(item.minimum) },
    { key: 'links', label: 'Se descuenta con', render: (item) => {
      const links = inventory.links.filter((l) => l.inventoryId === item.id);
      return links.length ? links.map((l) => `${n(l.quantity)} × ${menuLabel(l.clientItemKey)}`).join(', ') : '—';
    } },
    { key: 'id', label: 'Acciones', render: (item) => canEdit ? (
      <><button className="icon-btn info" onClick={() => setEditingItem(item)}>Editar</button><button className="icon-btn delete" onClick={() => handleItemDelete(item)}>×</button></>
    ) : '—' },
  ];

  const linkColumns = [
    { key: 'inventoryId', label: 'Producto de cocina', render: (l) => kitchenItem(l.inventoryId)?.name || 'Producto eliminado' },
    { key: 'clientItemKey', label: 'Artículo entregado', render: (l) => menuLabel(l.clientItemKey) },
    { key: 'quantity', label: 'Cantidad por entrega', render: (l) => n(l.quantity) },
    { key: 'id', label: 'Acciones', render: (l) => canEdit ? (
      <><button className="icon-btn info" onClick={() => setEditingLink(l)}>Editar</button><button className="icon-btn delete" onClick={() => handleLinkDelete(l)}>×</button></>
    ) : '—' },
  ];

  const movementColumns = [
    { key: 'date', label: 'Fecha', render: (m) => m.date },
    { key: 'inventoryId', label: 'Producto', render: (m) => kitchenItem(m.inventoryId)?.name || 'Producto eliminado' },
    { key: 'quantity', label: 'Cantidad', render: (m) => (m.quantity > 0 ? `+${n(m.quantity)}` : n(m.quantity)) },
    { key: 'type', label: 'Tipo', render: (m) => MOVEMENT_LABELS[m.type] || m.type },
    { key: 'note', label: 'Detalle', render: (m) => m.note || '—' },
    { key: 'id', label: 'Acciones', render: (m) => (canEdit && m.type !== 'delivery') ? (
      <><button className="icon-btn info" onClick={() => setEditingMovement(m)}>Editar</button><button className="icon-btn delete" onClick={() => handleMovementDelete(m)}>×</button></>
    ) : '—' },
  ];

  if (loading) return <p className="muted">Cargando inventario…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Inventario</h1><p>Controla existencias de cocina. Los vínculos descuentan insumos automáticamente al procesar pedidos activos.</p></div>
        {canEdit && (
          <div className="head-actions">
            <button className="primary" onClick={() => setEditingItem({})}>+ Producto de cocina</button>
            <button className="success" onClick={() => setMovementModal('entry')}>+ Ingreso</button>
            <button className="info" onClick={() => setMovementModal('use')}>− Uso</button>
            <button className="warning" onClick={() => setMovementModal('waste')}>− Merma</button>
            <button className="info" onClick={() => setEditingLink({})}>Vincular consumo</button>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: -10, marginBottom: 14 }}>El descuento automático ya funciona al "Procesar día" desde Día de trabajo — acá también podés cargar movimientos a mano.</p>

      <div className="two-col">
        <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>Productos de cocina</h3><DataTable columns={itemColumns} rows={inventory.items} emptyText="No hay productos registrados." resizeGroup="inventory-items" userId={user?.id} /></div>
        <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>Vínculos de consumo</h3><DataTable columns={linkColumns} rows={inventory.links} emptyText="No hay vínculos definidos." resizeGroup="inventory-links" userId={user?.id} /></div>
      </div>
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 12 }}>Últimos movimientos</h3>
        <DataTable columns={movementColumns} rows={inventory.movements.slice(0, 12)} emptyText="Sin movimientos registrados." resizeGroup="inventory-movements" userId={user?.id} />
      </div>

      <Modal title={editingItem?.id ? 'Editar producto' : 'Producto de cocina'} open={!!editingItem} onClose={() => setEditingItem(null)} onSubmit={handleItemSubmit}>
        <div className="form-grid">
          <label className="wide">Nombre *<input name="name" required defaultValue={editingItem?.name} /></label>
          <label>Unidad<input name="unit" defaultValue={editingItem?.unit} placeholder="unidades" /></label>
          <label>Stock actual<input type="number" min="0" name="stock" defaultValue={n(editingItem?.stock)} /></label>
          <label>Mínimo (alerta de stock bajo)<input type="number" min="0" name="minimum" defaultValue={n(editingItem?.minimum)} /></label>
        </div>
      </Modal>

      <Modal title={editingLink?.id ? 'Editar vínculo' : 'Vincular consumo'} open={!!editingLink} onClose={() => setEditingLink(null)} onSubmit={handleLinkSubmit}>
        <div className="form-grid">
          <label>Producto de cocina *
            <select name="inventoryId" required defaultValue={editingLink?.inventoryId || ''}>
              <option value="" disabled>Elegir…</option>
              {inventory.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label>Artículo entregado *
            <select name="clientItemKey" required defaultValue={editingLink?.clientItemKey || ''}>
              <option value="" disabled>Elegir…</option>
              {menuItems.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="wide">Cantidad usada por cada entrega *<input type="number" min="0" step="0.01" name="quantity" required defaultValue={n(editingLink?.quantity) || 1} /></label>
        </div>
      </Modal>

      <Modal title={editingMovement ? 'Editar movimiento' : movementModal === 'entry' ? 'Registrar ingreso' : movementModal === 'waste' ? 'Registrar merma' : 'Registrar uso'} open={!!movementModal || !!editingMovement} onClose={() => { setMovementModal(null); setEditingMovement(null); }} onSubmit={handleMovementSubmit}>
        <div className="form-grid">
          <label className="wide">Producto *
            <select name="inventoryId" required defaultValue={editingMovement?.inventoryId || ''}>
              <option value="" disabled>Elegir…</option>
              {inventory.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label>Cantidad *<input type="number" min="0.01" step="0.01" name="quantity" required defaultValue={editingMovement ? Math.abs(n(editingMovement.quantity)) : ''} /></label>
          <label className="wide">Detalle (opcional)<input name="note" defaultValue={editingMovement?.note} /></label>
        </div>
      </Modal>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';

// Reordenar con flechas arriba/abajo es más simple y confiable de usar
// (sobre todo en celular) que arrastrar y soltar, y logra lo mismo.
export default function ColumnsModal({ open, onClose, allColumns, hidden, order, onSave }) {
  const initialOrder = order.length ? [...order.filter((k) => allColumns.some((c) => c.key === k)), ...allColumns.map((c) => c.key).filter((k) => !order.includes(k))] : allColumns.map((c) => c.key);
  const [localOrder, setLocalOrder] = useState(initialOrder);
  const [localHidden, setLocalHidden] = useState(hidden);
  const byKey = new Map(allColumns.map((c) => [c.key, c]));
  const dialogRef = useRef(null);

  // Antes este <dialog> se renderizaba con el atributo `open` puesto a mano,
  // lo que lo deja como un elemento de flujo normal (aparece empujado debajo
  // de la tabla). Usando showModal()/close() nativos se muestra como overlay
  // encima de todo, igual que el resto de los formularios del panel (Modal.jsx).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setLocalOrder(initialOrder);
      setLocalHidden(hidden);
      dlg.showModal();
    }
    if (!open && dlg.open) dlg.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function move(index, dir) {
    const next = [...localOrder];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLocalOrder(next);
  }
  function toggle(key) {
    setLocalHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <dialog ref={dialogRef} className="panel-modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head"><h2>Columnas de la tabla</h2><button type="button" onClick={onClose}>✕</button></div>
      <div className="modal-body">
        <p className="muted" style={{ marginTop: 0 }}>Marca las columnas que querés ver, y usá las flechas para ordenarlas. Es una preferencia personal, solo para vos.</p>
        <ul className="column-list">
          {localOrder.map((key, i) => {
            const col = byKey.get(key);
            if (!col) return null;
            return (
              <li key={key} className="column-list-item">
                <label><input type="checkbox" checked={!localHidden.includes(key)} onChange={() => toggle(key)} /> {col.label}</label>
                <div className="column-list-arrows">
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === localOrder.length - 1}>▼</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="modal-foot">
        <button type="button" className="outline" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary" onClick={() => onSave(localOrder, localHidden)}>Guardar</button>
      </div>
    </dialog>
  );
}

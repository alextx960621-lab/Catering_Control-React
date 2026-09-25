import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Ancho mínimo permitido al escribirlo a mano -- mismo piso que ya usa el arrastre en…
const MIN_WIDTH = 24;

// Reordenar con flechas arriba/abajo es más simple y confiable de usar (sobre todo en…
export default function ColumnsModal({ open, onClose, allColumns, hidden, order, widths, onSave, onResetWidths }) {
  const { t } = useTranslation();
  const initialOrder = order.length ? [...order.filter((k) => allColumns.some((c) => c.key === k)), ...allColumns.map((c) => c.key).filter((k) => !order.includes(k))] : allColumns.map((c) => c.key);
  const [localOrder, setLocalOrder] = useState(initialOrder);
  const [localHidden, setLocalHidden] = useState(hidden);
  // Copia local del ancho de cada columna en px (vacío = automático, sin ancho propio…
  const [localWidths, setLocalWidths] = useState(widths || {});
  const byKey = new Map(allColumns.map((c) => [c.key, c]));
  const dialogRef = useRef(null);

  // showModal()/close() nativos (no el atributo `open` a mano): así se muestra como overlay…
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setLocalOrder(initialOrder);
      setLocalHidden(hidden);
      setLocalWidths(widths || {});
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
  function setWidth(key, raw) {
    setLocalWidths((prev) => {
      const next = { ...prev };
      if (raw === '') { delete next[key]; return next; } // vacío = volver a automático
      const n = Math.max(MIN_WIDTH, Math.round(Number(raw)) || MIN_WIDTH);
      next[key] = n;
      return next;
    });
  }

  return (
    <dialog ref={dialogRef} className="panel-modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head"><h2>{t('panel.common.tableColumns')}</h2><button type="button" onClick={onClose}>✕</button></div>
      <div className="modal-body">
        <p className="muted" style={{ marginTop: 0 }}>{t('panel.common.columnsHint')}</p>
        <ul className="column-list">
          {localOrder.map((key, i) => {
            const col = byKey.get(key);
            if (!col) return null;
            return (
              <li key={key} className="column-list-item">
                <label><input type="checkbox" checked={!localHidden.includes(key)} onChange={() => toggle(key)} /> {col.label}</label>
                <input
                  type="number" min={MIN_WIDTH} step="1" className="column-width-input"
                  placeholder="auto" title={t('panel.common.widthTitle')}
                  value={localWidths[key] ?? ''}
                  onChange={(e) => setWidth(key, e.target.value)}
                />
                <div className="column-list-arrows">
                  <button type="button" className="icon-btn info" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                  <button type="button" className="icon-btn info" onClick={() => move(i, 1)} disabled={i === localOrder.length - 1}>▼</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="modal-foot">
        <button type="button" className="warning" onClick={() => { setLocalOrder(allColumns.map((c) => c.key)); setLocalHidden([]); }}>{t('panel.common.restoreOrder')}</button>
        {onResetWidths && <button type="button" className="warning" onClick={() => { onResetWidths(); setLocalWidths({}); }} title={t('panel.common.restoreWidthsTitle')}>{t('panel.common.restoreWidths')}</button>}
        <button type="button" className="danger" onClick={onClose}>{t('panel.common.cancel')}</button>
        <button type="button" className="primary" onClick={() => onSave(localOrder, localHidden, localWidths)}>{t('common.save')}</button>
      </div>
    </dialog>
  );
}

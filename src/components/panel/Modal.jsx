import { useEffect, useRef, useState } from 'react';

// Modal genérico con <dialog> nativo. `onSubmit` puede devolver `false`
// (o una Promise que resuelva `false`) para cancelar el cierre — por
// ejemplo si una validación falla y hay que dejar el formulario abierto
// con un aviso.
export default function Modal({ title, open, onClose, onSubmit, children, hideSave, cancelLabel = 'Cancelar' }) {
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await onSubmit?.(e.target);
      if (result !== false) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="panel-modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button type="button" className="outline" onClick={onClose}>{cancelLabel}</button>
          {!hideSave && <button type="submit" className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>}
        </div>
      </form>
    </dialog>
  );
}

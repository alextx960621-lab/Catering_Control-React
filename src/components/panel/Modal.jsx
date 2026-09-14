import { useEffect, useRef, useState } from 'react';

// Modal genérico con <dialog> nativo. `onSubmit` puede devolver `false`
// (o una Promise que resuelva `false`) para cancelar el cierre — por
// ejemplo si una validación falla y hay que dejar el formulario abierto
// con un aviso.
export default function Modal({ title, open, onClose, onSubmit, children, hideSave, cancelLabel = 'Cancelar' }) {
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);

  // BUG (reportado 13 sep en Planes, pero afecta a TODOS los modales de
  // edición de la app por igual): el <dialog> de acá abajo queda montado
  // siempre -- solo se llama a showModal()/close() sobre el mismo,
  // nunca se desmonta. Como casi todos los formularios de esta app usan
  // inputs NO controlados (`defaultValue={editing?.campo}`), React solo
  // lee ese `defaultValue` la primera vez que el input se monta -- si
  // se abre el modal para el registro A y después, SIN que React vuelva
  // a montar el <input> de cero, se abre para el registro B, el campo
  // se queda mostrando lo que tenía cargado de A (o lo que la persona
  // haya escrito encima).
  //
  // Para arreglarlo en un solo lugar (en vez de acordarse de poner un
  // `key` distinto en cada una de las ~15 pantallas que usan <Modal>),
  // cada vez que `open` pasa de false a true se pisa `renderKey` -- eso
  // fuerza a React a tirar todo el `children` de adentro y montarlo de
  // cero, así los `defaultValue` se vuelven a leer con el registro
  // actual. Patrón oficial de React para "resetear estado con una key"
  // (ver "You can reset a component's state by passing a different
  // key" en la documentación), aplicado automáticamente acá adentro en
  // vez de en cada pantalla.
  const [prevOpen, setPrevOpen] = useState(open);
  const [renderKey, setRenderKey] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setRenderKey((k) => k + 1);
  }

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
        <div className="modal-body" key={renderKey}>{children}</div>
        <div className="modal-foot">
          <button type="button" className="outline" onClick={onClose}>{cancelLabel}</button>
          {!hideSave && <button type="submit" className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>}
        </div>
      </form>
    </dialog>
  );
}

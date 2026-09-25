import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { hasUploadsInFlight, subscribeUploads } from '../../services/imageUpload';

// Modal genérico con <dialog> nativo
export default function Modal({ title, open, onClose, onSubmit, children, hideSave, cancelLabel }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);
  // Con una foto a medio subir, "Guardar" escribiría la URL anterior (o ninguna) y borraría el cambio
  const uploadsInFlight = useSyncExternalStore(subscribeUploads, hasUploadsInFlight, hasUploadsInFlight);

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
        <button type="button" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body" key={renderKey}>{children}</div>
        <div className="modal-foot">
          <button type="button" className="danger" onClick={onClose}>{cancelLabel || t('panel.common.cancel')}</button>
          {!hideSave && <button type="submit" className="primary" disabled={saving || uploadsInFlight}>{uploadsInFlight ? t('panel.common.uploading') : saving ? t('panel.common.saving') : t('common.save')}</button>}
        </div>
      </form>
    </dialog>
  );
}

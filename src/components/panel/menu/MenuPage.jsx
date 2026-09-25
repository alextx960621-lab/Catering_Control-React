import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canManage } from '../../../services/panelAuth';
import { useOperations } from '../../../context/OperationsContext';
import { rpc, getSessionToken, dbInsertAudit } from '../../../services/supabaseClient';
import { MENU_DAYS as DAYS, formatMenuText } from '../../../services/menuSemanal';
import { uploadImage, removeStoredImage } from '../../../services/imageUpload';
import Modal from '../Modal';

export default function MenuPage({ user }) {
  const { t } = useTranslation();
  const { settings, showNotice } = useOperations();
  const canEdit = canManage(user?.role, settings.customRoles, 'menu');
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingDay, setEditingDay] = useState(null); // 'lun' | ..
  const [draftText, setDraftText] = useState('');
  const [draftImage, setDraftImage] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await rpc('get_menu_semanal', {});
      if (!cancelled) {
        setMenu(result || {});
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openDay(key) {
    setEditingDay(key);
    setDraftText(menu?.[key]?.text || '');
    setDraftImage(menu?.[key]?.imageUrl || '');
  }

  async function handleImageFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo después
    if (!file) return;
    setUploadingImage(true);
    const url = await uploadImage(file, 'menu', draftImage, 700);
    setUploadingImage(false);
    if (!url) { showNotice(t('panel.common.uploadFailed'), true); return; }
    setDraftImage(url);
  }

  function handleImageRemove() {
    if (draftImage) removeStoredImage(draftImage);
    setDraftImage('');
  }

  async function handleSave() {
    const key = editingDay;
    const nextMenu = {
      ...menu,
      [key]: { ...menu?.[key], text: draftText.trim(), imageUrl: draftImage, updatedAt: new Date().toISOString(), updatedBy: user?.name || '' },
    };
    const saved = await rpc('staff_save_menu_semanal', { p_token: getSessionToken(), p_payload: nextMenu });
    if (!saved) {
      showNotice(t('panel.menu.saveFailed'), true);
      return false;
    }
    setMenu(saved);
    setEditingDay(null);
    showNotice(t('panel.menu.saved'));
    dbInsertAudit({
      actor_id: user.id,
      actor_name: user.name,
      actor_role: user.role,
      action: `Editó el menú del ${DAYS.find(([k]) => k === key)?.[1] || key}`,
      entity_type: 'menu',
      entity_label: 'Menú Semanal',
      details: {},
    });
  }

  // Plaquita "Visible/Oculto" de cada día: se guarda al toque, sin pasar por el modal de…
  async function toggleHidden(key) {
    if (!canEdit) return;
    const auditLabel = DAYS.find(([k]) => k === key)?.[1] || key;
    const dayLabel = t(`common.days.${key}`);
    const nextHidden = !menu?.[key]?.hidden;
    const nextMenu = { ...menu, [key]: { ...menu?.[key], hidden: nextHidden } };
    const saved = await rpc('staff_save_menu_semanal', { p_token: getSessionToken(), p_payload: nextMenu });
    if (!saved) {
      showNotice(t('panel.menu.updateFailed'), true);
      return;
    }
    setMenu(saved);
    showNotice(nextHidden ? t('panel.menu.dayHidden', { day: dayLabel }) : t('panel.menu.dayShown', { day: dayLabel }));
    dbInsertAudit({
      actor_id: user.id,
      actor_name: user.name,
      actor_role: user.role,
      action: nextHidden ? `Ocultó el menú del ${auditLabel} (ej. feriado)` : `Volvió a mostrar el menú del ${auditLabel}`,
      entity_type: 'menu',
      entity_label: 'Menú Semanal',
      details: {},
    });
  }

  if (loading) {
    return <p className="text-secondary p-3">{t('panel.menu.loading')}</p>;
  }

  return (
    <div className="p-3">
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="h5 mb-1">{t('panel.menu.title')}</h1>
          <p className="text-secondary small mb-0">
            {t('panel.menu.description')}
          </p>
        </div>
      </div>

      <div className="row g-3">
        {DAYS.map(([key]) => {
          const day = menu?.[key];
          const hasContent = !!day?.text?.trim();
          return (
            <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={key}>
              <article className={`card shadow-sm border-0 h-100 menu-day-card${day?.hidden ? ' menu-day-card-hidden' : ''}`}>
                {day?.imageUrl && (
                  <img src={day.imageUrl} alt="" className="card-img-top" style={{ height: 120, objectFit: 'cover' }} />
                )}
                <div className="card-body d-flex flex-column">
                  <div className="d-flex align-items-center justify-content-between mb-2 gap-2">
                    <h2 className="h6 mb-0">{t(`common.days.${key}`)}</h2>
                    {canEdit && (
                      <button
                        type="button"
                        className={`icon-btn ${day?.hidden ? 'orange' : 'success'}`}
                        onClick={() => toggleHidden(key)}
                        title={day?.hidden ? t('panel.menu.hiddenTitle') : t('panel.menu.visibleTitle')}
                      >
                        {day?.hidden ? t('panel.menu.hidden') : t('panel.menu.visible')}
                      </button>
                    )}
                  </div>
                  {hasContent ? (
                    <div className="menu-day-preview flex-grow-1" dangerouslySetInnerHTML={{ __html: formatMenuText(day.text) }} />
                  ) : (
                    <p className="text-secondary small flex-grow-1 mb-0">{t('panel.menu.empty')}</p>
                  )}
                  {canEdit && (
                    <button type="button" className="icon-btn info mt-3 align-self-start" onClick={() => openDay(key)}>
                      {hasContent ? t('panel.common.edit') : t('panel.menu.loadMenu')}
                    </button>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      <Modal
        title={t('panel.menu.modalTitle', { day: editingDay ? t(`common.days.${editingDay}`) : '' })}
        open={!!editingDay}
        onClose={() => setEditingDay(null)}
        onSubmit={handleSave}
      >
        <div className="mb-3">
          <span className="form-label d-block">{t('panel.menu.photoLabel')}</span>
          <div className="d-flex align-items-center gap-3">
            <div className="image-field-preview aspect-16-9">
              {draftImage ? <img src={draftImage} alt="" /> : <span className="fs-3">🍽️</span>}
            </div>
            <div className="d-flex flex-column gap-2">
              <label className="image-field-upload mb-0">
                {uploadingImage ? t('panel.common.uploading') : draftImage ? t('panel.common.changeImage') : t('panel.common.uploadImage')}
                <input type="file" accept="image/*" onChange={handleImageFile} disabled={uploadingImage} hidden />
              </label>
              {draftImage && (
                <button type="button" className="danger" onClick={handleImageRemove} disabled={uploadingImage}>
                  {t('panel.common.removeImage')}
                </button>
              )}
            </div>
          </div>
          <small className="image-field-hint">
            {t('panel.menu.photoHint1')} <b>{t('panel.menu.photoHintBold')}</b> {t('panel.menu.photoHint2')}
          </small>
        </div>
        <div className="mb-2">
          <label className="form-label" htmlFor="menu-day-text">
            {t('panel.menu.textLabel')}
          </label>
          <textarea
            id="menu-day-text"
            className="form-control"
            rows={6}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={t('panel.menu.textPlaceholder')}
          />
        </div>
      </Modal>
    </div>
  );
}

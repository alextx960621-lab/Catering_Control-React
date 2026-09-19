import { useEffect, useState } from 'react';
import { canManage } from '../../../services/panelAuth';
import { useOperations } from '../../../context/OperationsContext';
import { rpc, getSessionToken, dbInsertAudit } from '../../../services/supabaseClient';
import { MENU_DAYS as DAYS, formatMenuText } from '../../../services/menuSemanal';
import Modal from '../Modal';

export default function MenuPage({ user }) {
  const { settings, showNotice } = useOperations();
  const canEdit = canManage(user?.role, settings.customRoles, 'menu');
  const [menu, setMenu] = useState(null); // { lun: {text, updatedAt, updatedBy}, ... }
  const [loading, setLoading] = useState(true);
  const [editingDay, setEditingDay] = useState(null); // 'lun' | ... | null
  const [draftText, setDraftText] = useState('');

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
  }

  async function handleSave() {
    const key = editingDay;
    const nextMenu = {
      ...menu,
      [key]: { text: draftText.trim(), updatedAt: new Date().toISOString(), updatedBy: user?.name || '' },
    };
    const saved = await rpc('staff_save_menu_semanal', { p_token: getSessionToken(), p_payload: nextMenu });
    if (!saved) {
      showNotice('No se pudo guardar el menú. Revisa tu internet e intenta de nuevo.', true);
      return false;
    }
    setMenu(saved);
    setEditingDay(null);
    showNotice('Menú del día guardado.');
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

  if (loading) {
    return <p className="text-secondary p-3">Cargando menú…</p>;
  }

  return (
    <div className="p-3">
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="h5 mb-1">Menú Semanal</h1>
          <p className="text-secondary small mb-0">
            Lo que escribas acá aparece formateado en la web pública del Menú Semanal, a la que los clientes
            acceden desde su portal.
          </p>
        </div>
      </div>

      <div className="row g-3">
        {DAYS.map(([key, label]) => {
          const day = menu?.[key];
          const hasContent = !!day?.text?.trim();
          return (
            <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={key}>
              <article className="card shadow-sm border-0 h-100 menu-day-card">
                <div className="card-body d-flex flex-column">
                  <h2 className="h6 mb-2">{label}</h2>
                  {hasContent ? (
                    <div className="menu-day-preview flex-grow-1" dangerouslySetInnerHTML={{ __html: formatMenuText(day.text) }} />
                  ) : (
                    <p className="text-secondary small flex-grow-1 mb-0">Sin menú cargado todavía.</p>
                  )}
                  {canEdit && (
                    <button type="button" className="btn btn-outline-secondary btn-sm mt-3" onClick={() => openDay(key)}>
                      {hasContent ? 'Editar' : 'Cargar menú'}
                    </button>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      <Modal
        title={`Menú del ${DAYS.find(([k]) => k === editingDay)?.[1] || ''}`}
        open={!!editingDay}
        onClose={() => setEditingDay(null)}
        onSubmit={handleSave}
      >
        <div className="mb-2">
          <label className="form-label" htmlFor="menu-day-text">
            Una idea por línea (ej. un plato o un ingrediente destacado por renglón)
          </label>
          <textarea
            id="menu-day-text"
            className="form-control"
            rows={6}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={'Ej.\nSopa de quinua\nPollo al horno con arroz\nEnsalada fresca'}
          />
        </div>
      </Modal>
    </div>
  );
}

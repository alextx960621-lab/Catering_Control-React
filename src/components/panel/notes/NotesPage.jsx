import { canManage } from '../../../services/panelAuth';
import config from '../../../services/config';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { dbGetDeliveryRows, dbUpsertDeliveryRows } from '../../../services/db';
import { clientWaLink } from '../../../services/dispatchHelpers';
import Modal from '../Modal';
import ComprobantesModal from './ComprobantesModal';
import { uid, fmtDate } from '../panelUtils';

// Los clientes pueden escribir cualquier texto en una nota: solo un link que apunte al…
function isOwnStorageUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === new URL(config.supabaseUrl).origin && u.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

// Los avisos que dejan los clientes desde el portal (pausa, renovación, cambio de plan) a…
function NoteText({ text }) {
  const { t } = useTranslation();
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let m;
  while ((m = urlRe.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const url = m[0].replace(/[.,;)]+$/, '');
    const isImage = isOwnStorageUrl(url) && /comprobante|\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
    nodes.push(
      <a key={key++} href={url} target="_blank" rel="noreferrer" className="note-link">
        {isImage ? <>📎 {t('panel.notes.viewReceipt')}</> : url}
      </a>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

// El texto de estas notas lo genera PlanChangeModal.jsx cuando un cliente pide renovar o…
function isPlanRequestNote(nt) {
  return !!nt.clientId && /^Solicitud de plan:/i.test(nt.text || '');
}

function renewalWaMessage({ kind, clientName, planName, days }, t) {
  const accion = kind === 'compra' ? t('panel.notes.waActionBuy') : t('panel.notes.waActionRenew');
  return t('panel.notes.waMessage', { clientName, action: accion, planName, days: t('panel.notes.waDays', { count: days }) });
}

export default function NotesPage({ user, onGoToClient, renewalByClient = {}, onConsumeRenewal }) {
  const { t } = useTranslation();
  const { notes, clients, currentDate, settings, days, saveNotes, deleteNote, showNotice, refreshNotes, loading } = useOperations();
  const [filter, setFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null=cerrado, {}=nueva, {...}=editar
  const [rescheduling, setRescheduling] = useState(null);
  const [showComprobantes, setShowComprobantes] = useState(false);

  // El aviso de una falla lo genera el servidor cuando el chofer marca "no entregado": sin
  // recargar todo el panel, el editor lo vería recién al tocar "Actualizar".
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden && !editing && !rescheduling && !showComprobantes) refreshNotes();
    }, 15000);
    return () => clearInterval(id);
  }, [refreshNotes, editing, rescheduling, showComprobantes]);

  const today = currentDate;
  const q = search.toLowerCase();

  const counts = {
    today: notes.filter((nt) => nt.status === 'pendiente' && nt.dueDate <= today).length,
    upcoming: notes.filter((nt) => nt.status === 'pendiente' && nt.dueDate > today).length,
    history: notes.filter((nt) => nt.status === 'cumplida').length,
  };

  let list = notes.filter((nt) => {
    if (filter === 'today') return nt.status === 'pendiente' && nt.dueDate <= today;
    if (filter === 'upcoming') return nt.status === 'pendiente' && nt.dueDate > today;
    if (filter === 'history') return nt.status === 'cumplida';
    return true;
  });
  if (q) list = list.filter((nt) => [nt.text, nt.clientName].join(' ').toLowerCase().includes(q));
  list = [...list].sort((a, b) => (filter === 'history' ? (b.completedAt || b.dueDate).localeCompare(a.completedAt || a.dueDate) : a.dueDate.localeCompare(b.dueDate)));

  function markDone(nt) {
    saveNotes([{ ...nt, status: 'cumplida', completedAt: currentDate, read: true }]);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Nota cumplida', entity_type: 'note', entity_label: nt.clientName || nt.createdBy || 'Nota interna', entity_id: nt.id, details: { texto: nt.text.slice(0, 60) } });

    // Si esta nota era una solicitud de renovación/compra de plan Y ya se le cargó el plan al…
    if (isPlanRequestNote(nt)) {
      const info = renewalByClient[nt.clientId];
      if (info) {
        const phone = clients.find((c) => c.id === nt.clientId)?.phone1 || info.phone;
        const link = clientWaLink(phone, renewalWaMessage({ ...info, clientName: nt.clientName || info.clientName }, t));
        if (link) {
          window.open(link, '_blank');
          showNotice(t('panel.notes.noticeDoneOpenedWa'));
        } else {
          showNotice(t('panel.notes.noticeDoneNoPhone'), true);
        }
        onConsumeRenewal?.(nt.clientId);
        return;
      }
    }
    showNotice(t('panel.notes.noticeDone'));
  }

  // Cuando la verificación automática de comprobantes aprueba un pago sola (ver…
  function avisarWhatsapp(nt) {
    const phone = clients.find((c) => c.id === nt.clientId)?.phone1;
    const link = clientWaLink(phone, renewalWaMessage({ kind: nt.waKind, clientName: nt.clientName, planName: nt.waPlanName, days: nt.waDays }, t));
    if (!link) { showNotice(t('panel.notes.noticeNoPhone'), true); return; }
    window.open(link, '_blank');
    saveNotes([{ ...nt, waPending: false }]);
  }

  function handleDelete(nt) {
    if (!confirm(t('panel.notes.confirmDeleteNote'))) return;
    deleteNote(nt.id);
    showNotice(t('panel.notes.noticeDeleted'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Nota eliminada', entity_type: 'note', entity_label: nt.clientName || nt.createdBy || 'Nota interna', entity_id: nt.id, details: {} });
  }

  // Clasifica un "no entregado" que marcó un chofer: la culpa es del cliente (el día se descuenta)…
  // o del personal (no se descuenta, aunque la carrera igual se le paga al chofer). La fecha real
  // de la entrega es `deliveryDate`: si la nota se reprograma, `dueDate` ya no coincide.
  async function decideFault(nt, fault) {
    const deliveryDate = nt.deliveryDate || nt.dueDate;
    const msg = fault === 'personal' ? t('panel.notes.confirmFaultStaff') : t('panel.notes.confirmFaultClient');
    if (!confirm(msg)) return;
    const rows = await dbGetDeliveryRows(deliveryDate);
    if (rows === null) { showNotice(t('panel.common.syncFailed'), true); return; }
    const rec = rows.find((r) => r.clientId === nt.clientId);
    if (rec?.status !== 'no_entregado') { showNotice(t('panel.notes.noticeFaultMarkGone'), true); deleteNote(nt.id); return; }
    const payload = { status: 'no_entregado', reason: rec.reason || '', fault, note: rec.note || '', image: rec.image || '', at: new Date().toISOString(), by: user.name };
    const ok = await dbUpsertDeliveryRows([{ date: deliveryDate, clientId: nt.clientId, payload }]);
    if (!ok) { showNotice(t('panel.common.syncFailed'), true); return; }
    saveNotes([{ ...nt, fault, status: 'cumplida', completedAt: currentDate, read: true }]);
    showNotice(fault === 'personal' ? t('panel.notes.noticeFaultStaff') : t('panel.notes.noticeFaultClient'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Falla de entrega clasificada', entity_type: 'delivery', entity_label: nt.clientName || nt.clientId, entity_id: nt.clientId, details: { fecha: deliveryDate, responsable: fault, motivo: nt.reason || undefined } });
  }

  function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const client = data.clientId ? clients.find((x) => x.id === data.clientId) : null;
    data.clientName = client ? client.name : '';
    const nt = editing?.id
      ? { ...editing, ...data }
      : { id: uid('n'), status: 'pendiente', source: 'staff', read: true, createdAt: new Date().toISOString(), createdBy: user.name, ...data };
    saveNotes([nt]);
    showNotice(t('panel.notes.noticeSaved'));
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: editing?.id ? 'Nota editada' : 'Nota creada', entity_type: 'note', entity_label: data.clientName || nt.createdBy, entity_id: nt.id, details: { texto: data.text.slice(0, 60), fecha: data.dueDate } });
  }

  function handleReschedule(form) {
    const data = Object.fromEntries(new FormData(form));
    saveNotes([{ ...rescheduling, text: data.text, dueDate: data.dueDate, status: 'pendiente', read: true }]);
    showNotice(t('panel.notes.noticeRescheduled'));
  }

  const emptyMsg = { today: t('panel.notes.emptyToday'), upcoming: t('panel.notes.emptyUpcoming'), history: t('panel.notes.emptyHistory'), all: t('panel.notes.emptyAll') }[filter];
  const canEdit = canManage(user?.role, settings.customRoles, 'notes');
  const canDecideFaults = canManage(user?.role, settings.customRoles, 'delivery');

  if (loading) return <p className="muted">{t('panel.notes.loadingNotes')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.notes')}</h1><p>{t('panel.notes.subtitle')}</p></div>
        {canEdit && (
          <div className="head-actions">
            <button className="violet" onClick={() => setShowComprobantes(true)}>📄 {t('panel.notes.comprobantes')}</button>
            <button className="primary" onClick={() => setEditing({})}>+ {t('panel.notes.addNote')}</button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <label className="field">{t('panel.notes.view')}
          <select id="notes-filter" name="notes-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="today">{t('panel.notes.filterToday', { count: counts.today })}</option>
            <option value="upcoming">{t('panel.notes.filterUpcoming', { count: counts.upcoming })}</option>
            <option value="history">{t('panel.notes.filterHistory', { count: counts.history })}</option>
            <option value="all">{t('panel.common.all')}</option>
          </select>
        </label>
        <input className="search" id="notes-search" name="notes-search" autoComplete="off" placeholder={t('panel.notes.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{t('panel.notes.notesCount', { count: list.length })}</span>
      </div>

      {list.length ? (
        <div className="notes-grid">
          {list.map((nt) => {
            const overdue = nt.status === 'pendiente' && nt.dueDate < today;
            const isFault = nt.kind === 'delivery-fault';
            const faultProcessed = isFault && days[nt.deliveryDate || nt.dueDate]?.processed;
            return (
              <div className={`note-card${overdue ? ' note-overdue' : ''}`} key={nt.id}>
                <div className="note-card-top">
                  <span className={`badge ${nt.status === 'cumplida' ? 'active' : overdue ? 'warn' : 'pending'}`}>{nt.status === 'cumplida' ? t('panel.notes.statusDone') : overdue ? t('panel.notes.statusOverdue') : t('panel.notes.statusPending')}</span>
                  {isFault && <span className="badge danger">{t('panel.notes.faultTag')}</span>}
                  {nt.source === 'cliente' && <span className="badge off">{t('panel.notes.fromPortal')}</span>}
                  {nt.autoApproved && <span className="badge active">✓ {t('panel.notes.autoVerified')}</span>}
                  <span className="muted note-date">{fmtDate(nt.dueDate)}</span>
                </div>
                {isFault ? (
                  <p className="note-text">
                    {t('panel.notes.faultNoteText')}
                    {nt.reason ? `\n${t('panel.notes.faultNoteReason', { reason: nt.reason })}` : ''}
                    {nt.markedBy ? `\n${t('panel.notes.faultNoteMarkedBy', { name: nt.markedBy })}` : ''}
                    {nt.fault ? `\n${t('panel.notes.faultNoteDecided', { who: nt.fault === 'personal' ? t('panel.notes.faultWhoStaff') : t('panel.notes.faultWhoClient') })}` : ''}
                  </p>
                ) : (
                  <p className="note-text"><NoteText text={nt.text} /></p>
                )}
                {nt.clientName && <p className="muted note-client">{t('panel.common.client')}: <span className="note-client-name">{nt.clientName}</span></p>}
                {canDecideFaults && isFault && nt.status !== 'cumplida' && (
                  faultProcessed ? (
                    <p className="muted" style={{ margin: 0 }}>{t('panel.notes.faultDayProcessed')}</p>
                  ) : (
                    <div className="note-actions">
                      <button className="danger" onClick={() => decideFault(nt, 'cliente')}>{t('panel.notes.faultBtnClient')}</button>
                      <button className="success" onClick={() => decideFault(nt, 'personal')}>{t('panel.notes.faultBtnStaff')}</button>
                    </div>
                  )
                )}
                {canEdit && (
                  <div className="note-actions">
                    {nt.status !== 'cumplida' ? (
                      <>
                        <button className="success" onClick={() => markDone(nt)}>✓ {t('panel.notes.statusDone')}</button>
                        <button className="warning" onClick={() => setRescheduling(nt)}>{t('panel.notes.reschedule')}</button>
                      </>
                    ) : (
                      <>
                        {nt.waPending && <button className="success" onClick={() => avisarWhatsapp(nt)}>📲 {t('panel.notes.notifyWhatsapp')}</button>}
                        <button className="warning" onClick={() => setRescheduling(nt)}>{t('panel.notes.reopen')}</button>
                      </>
                    )}
                    {nt.clientId && (
                      <>
                        <button className="info" onClick={() => onGoToClient?.(nt.clientId, 'edit')}>{t('panel.notes.editClient')}</button>
                        <button className="warning" onClick={() => onGoToClient?.(nt.clientId, 'renew')}>{t('panel.notes.renew')}</button>
                      </>
                    )}
                    <button className="icon-btn delete" onClick={() => handleDelete(nt)}>{t('panel.common.delete')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '20px 4px' }}>{emptyMsg}</p>
      )}

      <Modal title={editing?.id ? t('panel.notes.editNote') : t('panel.notes.addNote')} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="wide">{t('panel.notes.noteLabel')} *<textarea name="text" required rows="3" defaultValue={editing?.text} placeholder={t('panel.notes.textPlaceholder')} /></label>
          <label>{t('panel.notes.dueDateLabel')} *<div className="date-input-wrap"><input name="dueDate" type="date" required defaultValue={editing?.dueDate || currentDate} /></div></label>
          <label>{t('panel.notes.relatedClient')}
            <select name="clientId" defaultValue={editing?.clientId || ''}>
              <option value="">{t('panel.notes.noClient')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </Modal>

      <Modal title={t('panel.notes.rescheduleNote')} open={!!rescheduling} onClose={() => setRescheduling(null)} onSubmit={handleReschedule}>
        <div className="form-grid">
          <label className="wide">{t('panel.notes.noteLabel')}<textarea name="text" required rows="3" defaultValue={rescheduling?.text} /></label>
          <label>{t('panel.notes.newDateLabel')} *<div className="date-input-wrap"><input name="dueDate" type="date" required defaultValue={rescheduling?.dueDate} /></div></label>
        </div>
      </Modal>

      <ComprobantesModal open={showComprobantes} onClose={() => setShowComprobantes(false)} currentDate={today} showNotice={showNotice} />
    </section>
  );
}

import { canManage } from '../../../services/panelAuth';
import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { clientWaLink } from '../../../services/dispatchHelpers';
import Modal from '../Modal';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

// Los avisos que dejan los clientes desde el portal (pausa, renovación,
// cambio de plan) a veces incluyen la URL del comprobante de pago dentro
// del texto. Acá se detecta y se muestra como un link clicable en vez de
// texto plano.
function NoteText({ text }) {
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const url = m[0].replace(/[.,;)]+$/, '');
    const isImage = /comprobante|\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
    nodes.push(
      <a key={key++} href={url} target="_blank" rel="noreferrer" className="note-link">
        {isImage ? '📎 Ver comprobante' : url}
      </a>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

// El texto de estas notas lo genera PlanChangeModal.jsx cuando un cliente
// pide renovar o comprar un plan desde el portal — siempre arranca igual,
// así que sirve para reconocer automáticamente cuáles son solicitudes de
// plan y cuáles son un recordatorio cualquiera cargado por el staff.
function isPlanRequestNote(nt) {
  return !!nt.clientId && /^Solicitud de plan:/i.test(nt.text || '');
}

function renewalWaMessage({ kind, clientName, planName, days }) {
  const accion = kind === 'compra' ? 'la compra de tu nuevo plan' : 'la renovación de tu plan';
  return `Hola ${clientName}, te confirmamos ${accion} "${planName}" por ${days} día(s). ¡Gracias por seguir con nosotros! 🙌`;
}

export default function NotesPage({ user, onGoToClient, renewalByClient = {}, onConsumeRenewal }) {
  const { notes, clients, currentDate, settings, saveNotes, deleteNote, showNotice, loading } = useOperations();
  const [filter, setFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null=cerrado, {}=nueva, {...}=editar
  const [rescheduling, setRescheduling] = useState(null);

  const t = currentDate;
  const q = search.toLowerCase();

  const counts = {
    today: notes.filter((nt) => nt.status === 'pendiente' && nt.dueDate <= t).length,
    upcoming: notes.filter((nt) => nt.status === 'pendiente' && nt.dueDate > t).length,
    history: notes.filter((nt) => nt.status === 'cumplida').length,
  };

  let list = notes.filter((nt) => {
    if (filter === 'today') return nt.status === 'pendiente' && nt.dueDate <= t;
    if (filter === 'upcoming') return nt.status === 'pendiente' && nt.dueDate > t;
    if (filter === 'history') return nt.status === 'cumplida';
    return true;
  });
  if (q) list = list.filter((nt) => [nt.text, nt.clientName].join(' ').toLowerCase().includes(q));
  list = [...list].sort((a, b) => (filter === 'history' ? (b.completedAt || b.dueDate).localeCompare(a.completedAt || a.dueDate) : a.dueDate.localeCompare(b.dueDate)));

  function markDone(nt) {
    saveNotes([{ ...nt, status: 'cumplida', completedAt: currentDate, read: true }]);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Nota cumplida', entity_type: 'note', entity_label: nt.clientName || nt.createdBy || 'Nota interna', entity_id: nt.id, details: { texto: nt.text.slice(0, 60) } });

    // Si esta nota era una solicitud de renovación/compra de plan Y ya se
    // le cargó el plan al cliente desde el botón "Renovar" de acá mismo,
    // al marcarla cumplida se abre WhatsApp con el mensaje de confirmación
    // ya escrito, listo para mandarle al cliente.
    if (isPlanRequestNote(nt)) {
      const info = renewalByClient[nt.clientId];
      if (info) {
        const phone = clients.find((c) => c.id === nt.clientId)?.phone1 || info.phone;
        const link = clientWaLink(phone, renewalWaMessage({ ...info, clientName: nt.clientName || info.clientName }));
        if (link) {
          window.open(link, '_blank');
          showNotice('Nota marcada como cumplida. Abrimos WhatsApp para confirmarle al cliente.');
        } else {
          showNotice('Nota marcada como cumplida. El cliente no tiene teléfono cargado para avisarle por WhatsApp.', true);
        }
        onConsumeRenewal?.(nt.clientId);
        return;
      }
    }
    showNotice('Nota marcada como cumplida.');
  }

  function handleDelete(nt) {
    if (!confirm('¿Eliminar esta nota?')) return;
    deleteNote(nt.id);
    showNotice('Nota eliminada.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'Nota eliminada', entity_type: 'note', entity_label: nt.clientName || nt.createdBy || 'Nota interna', entity_id: nt.id, details: {} });
  }

  function handleSubmit(form) {
    const data = Object.fromEntries(new FormData(form));
    const client = data.clientId ? clients.find((x) => x.id === data.clientId) : null;
    data.clientName = client ? client.name : '';
    const nt = editing?.id
      ? { ...editing, ...data }
      : { id: uid('n'), status: 'pendiente', source: 'staff', read: true, createdAt: new Date().toISOString(), createdBy: user.name, ...data };
    saveNotes([nt]);
    showNotice('Nota guardada.');
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: editing?.id ? 'Nota editada' : 'Nota creada', entity_type: 'note', entity_label: data.clientName || nt.createdBy, entity_id: nt.id, details: { texto: data.text.slice(0, 60), fecha: data.dueDate } });
  }

  function handleReschedule(form) {
    const data = Object.fromEntries(new FormData(form));
    saveNotes([{ ...rescheduling, text: data.text, dueDate: data.dueDate, status: 'pendiente', read: true }]);
    showNotice('Nota reprogramada.');
  }

  const emptyMsg = { today: 'No hay notas pendientes para hoy. 🎉', upcoming: 'No hay notas programadas a futuro.', history: 'Todavía no hay notas cumplidas.', all: 'No hay notas.' }[filter];
  const canEdit = canManage(user?.role, settings.customRoles, 'notes');

  if (loading) return <p className="muted">Cargando notas…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Notas</h1><p>Recordatorios internos y mensajes que dejan los clientes desde su portal.</p></div>
        {canEdit && <div className="head-actions"><button className="primary" onClick={() => setEditing({})}>+ Añadir nota</button></div>}
      </div>

      <div className="toolbar">
        <label className="field">Ver
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="today">Hoy y atrasadas ({counts.today})</option>
            <option value="upcoming">Programadas a futuro ({counts.upcoming})</option>
            <option value="history">Historial (cumplidas) ({counts.history})</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <input className="search" placeholder="Buscar en las notas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <span className="muted">{list.length} notas</span>
      </div>

      {list.length ? (
        <div className="notes-grid">
          {list.map((nt) => {
            const overdue = nt.status === 'pendiente' && nt.dueDate < t;
            return (
              <div className={`note-card${overdue ? ' note-overdue' : ''}`} key={nt.id}>
                <div className="note-card-top">
                  <span className={`badge ${nt.status === 'cumplida' ? 'active' : overdue ? 'warn' : 'pending'}`}>{nt.status === 'cumplida' ? 'Cumplida' : overdue ? 'Atrasada' : 'Pendiente'}</span>
                  {nt.source === 'cliente' && <span className="badge off">Desde el portal</span>}
                  <span className="muted note-date">{nt.dueDate.split('-').reverse().join('/')}</span>
                </div>
                <p className="note-text"><NoteText text={nt.text} /></p>
                {nt.clientName && <p className="muted note-client">Cliente: <span className="note-client-name">{nt.clientName}</span></p>}
                {canEdit && (
                  <div className="note-actions">
                    {nt.status !== 'cumplida' ? (
                      <>
                        <button className="success" onClick={() => markDone(nt)}>✓ Cumplida</button>
                        <button className="warning" onClick={() => setRescheduling(nt)}>Reprogramar</button>
                      </>
                    ) : (
                      <button className="warning" onClick={() => setRescheduling(nt)}>Reabrir</button>
                    )}
                    {nt.clientId && (
                      <>
                        <button className="info" onClick={() => onGoToClient?.(nt.clientId, 'edit')}>✏️ Editar cliente</button>
                        <button className="violet" onClick={() => onGoToClient?.(nt.clientId, 'renew')}>🔄 Renovar</button>
                      </>
                    )}
                    <button className="icon-btn delete" onClick={() => handleDelete(nt)} title="Eliminar">×</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '20px 4px' }}>{emptyMsg}</p>
      )}

      <Modal title={editing?.id ? 'Editar nota' : 'Añadir nota'} open={!!editing} onClose={() => setEditing(null)} onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="wide">Nota *<textarea name="text" required rows="3" defaultValue={editing?.text} placeholder="Ej.: Llamar de nuevo a Juan Pérez para ver si renueva el plan." /></label>
          <label>Fecha para que aparezca *<input name="dueDate" type="date" required defaultValue={editing?.dueDate || currentDate} /></label>
          <label>Cliente relacionado (opcional)
            <select name="clientId" defaultValue={editing?.clientId || ''}>
              <option value="">Sin vincular a un cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </Modal>

      <Modal title="Reprogramar nota" open={!!rescheduling} onClose={() => setRescheduling(null)} onSubmit={handleReschedule}>
        <div className="form-grid">
          <label className="wide">Nota<textarea name="text" required rows="3" defaultValue={rescheduling?.text} /></label>
          <label>Nueva fecha *<input name="dueDate" type="date" required defaultValue={rescheduling?.dueDate} /></label>
        </div>
      </Modal>
    </section>
  );
}

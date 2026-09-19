import { useEffect, useState } from 'react';
import { rpc, getSessionToken, supabase } from '../../../services/supabaseClient';
import Modal from '../Modal';

const BUCKET = 'app-images';

function publicUrlFor(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path)?.data?.publicUrl || null;
}

const ESTADO_LABEL = {
  pendiente_lectura: { text: 'Leyendo…', cls: 'pending' },
  pendiente_revision: { text: 'Necesita revisión', cls: 'warn' },
  aprobado_auto: { text: 'Aprobado automático', cls: 'active' },
  aprobado_manual: { text: 'Aprobado a mano', cls: 'active' },
  rechazado: { text: 'Rechazado', cls: 'off' },
};

function isToday(iso, todayISO) {
  return (iso || '').slice(0, 10) === todayISO;
}
function isThisWeek(iso, todayISO) {
  if (!iso) return false;
  const d = new Date(iso);
  const today = new Date(todayISO);
  const diffDays = (today - d) / 86400000;
  return diffDays >= 0 && diffDays < 7;
}

// Botón "Comprobantes" de Notas: a diferencia de la lista de notas, esto
// junta los ~15 días de comprobantes que puede haber (se borran solos
// después, ver el cron de supabase-setup-comprobantes.sql) y los agrupa acá
// mismo, en vez de mandar a otra pantalla -- la cola de trabajo real es la
// pestaña "Errores" (lo que la lectura automática no pudo aprobar sola).
export default function ComprobantesModal({ open, onClose, currentDate, showNotice }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('errores');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    rpc('staff_listar_comprobantes', { p_token: getSessionToken() }).then((data) => {
      if (!cancelled) { setRows(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open]);

  async function revisar(id, aprobado) {
    setBusyId(id);
    const result = await rpc('staff_marcar_comprobante_revisado', { p_token: getSessionToken(), p_comprobante_id: id, p_aprobado: aprobado });
    setBusyId(null);
    if (!result) { showNotice?.('No se pudo procesar el comprobante.', true); return; }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, payload: result } : r)));
    showNotice?.(aprobado ? 'Comprobante aprobado y plan renovado.' : 'Comprobante rechazado.');
  }

  const list = rows.filter((r) => {
    const p = r.payload || {};
    if (tab === 'hoy') return isToday(p.createdAt, currentDate);
    if (tab === 'semana') return isThisWeek(p.createdAt, currentDate);
    if (tab === 'errores') return p.estado === 'pendiente_revision';
    return true; // 'todos' / por cliente se ve igual, ordenado
  }).sort((a, b) => (b.payload?.createdAt || '').localeCompare(a.payload?.createdAt || ''));

  const porCliente = tab === 'clientes'
    ? Object.entries(
      list.reduce((acc, r) => {
        const key = r.payload?.clientName || 'Sin cliente';
        (acc[key] = acc[key] || []).push(r);
        return acc;
      }, {})
    )
    : null;

  function Row({ r }) {
    const p = r.payload || {};
    const estado = ESTADO_LABEL[p.estado] || { text: p.estado, cls: 'pending' };
    const url = publicUrlFor(p.storagePath);
    const pendiente = p.estado === 'pendiente_revision' || p.estado === 'pendiente_lectura';
    return (
      <div className="note-card" key={r.id}>
        <div className="note-card-top">
          <span className={`badge ${estado.cls}`}>{estado.text}</span>
          <span className="muted note-date">{(p.createdAt || '').slice(0, 16).replace('T', ' ')}</span>
        </div>
        <p className="mb-1"><b>{p.clientName || 'Sin cliente'}</b> — {p.tipo === 'plan_nuevo' ? 'plan nuevo' : 'renovación'} {p.planNombre ? `(${p.planNombre})` : ''}</p>
        <p className="muted mb-1">
          Esperado: Bs {p.montoEsperado ?? '—'} · Leído: {p.montoLeido ?? '—'} {p.confianza ? `(confianza ${p.confianza})` : ''}
        </p>
        {p.motivoError && <p className="muted small mb-1">Motivo: {p.motivoError}</p>}
        <div className="note-actions">
          {url && <a className="info" href={url} target="_blank" rel="noreferrer">Ver comprobante</a>}
          {pendiente && (
            <>
              <button type="button" className="success" disabled={busyId === r.id} onClick={() => revisar(r.id, true)}>✓ Aprobar y renovar</button>
              <button type="button" className="danger" disabled={busyId === r.id} onClick={() => revisar(r.id, false)}>Rechazar</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal title="Comprobantes" open={open} onClose={onClose} hideSave cancelLabel="Cerrar">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {[['errores', 'Errores'], ['hoy', 'Hoy'], ['semana', 'Semana'], ['clientes', 'Por cliente'], ['todos', 'Todos']].map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'primary' : 'btn-outline-secondary'} onClick={() => setTab(k)} style={{ marginRight: 6 }}>
            {label}
          </button>
        ))}
      </div>
      {loading ? <p className="muted">Cargando…</p> : (
        porCliente ? (
          porCliente.length ? porCliente.map(([cliente, items]) => (
            <div key={cliente} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>{cliente}</h3>
              <div className="notes-grid">{items.map((r) => <Row key={r.id} r={r} />)}</div>
            </div>
          )) : <p className="muted">No hay comprobantes.</p>
        ) : (
          list.length ? <div className="notes-grid">{list.map((r) => <Row key={r.id} r={r} />)}</div> : <p className="muted">No hay comprobantes acá.</p>
        )
      )}
    </Modal>
  );
}

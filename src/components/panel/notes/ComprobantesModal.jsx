import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc, getSessionToken } from '../../../services/supabaseClient';
import { viewUrlForStored } from '../../../services/imageUpload';
import { useCompanyPrefs } from '../../../context/CompanyPrefsContext';
import { useOperations } from '../../../context/OperationsContext';
import Modal from '../Modal';

// El comprobante vive en un bucket privado: la URL se firma recién al abrirla y dura minutos.
async function openReceipt(path, onMissing) {
  const url = await viewUrlForStored(path);
  if (url) window.open(url, '_blank', 'noopener');
  else onMissing?.();
}

const ESTADO_LABEL = {
  pendiente_lectura: { key: 'statusReading', cls: 'pending' },
  procesando: { key: 'statusProcessing', cls: 'pending' },
  pendiente_revision: { key: 'statusNeedsReview', cls: 'warn' },
  aprobado_auto: { key: 'statusAutoApproved', cls: 'active' },
  aprobado_manual: { key: 'statusManualApproved', cls: 'active' },
  rechazado: { key: 'statusRejected', cls: 'off' },
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

// Botón "Comprobantes" de Notas: a diferencia de la lista de notas, esto junta los ~15 días…
export default function ComprobantesModal({ open, onClose, currentDate, showNotice }) {
  const { t } = useTranslation();
  const { formatMoney } = useCompanyPrefs();
  const { refreshAll } = useOperations();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('errores');
  const [busyId, setBusyId] = useState(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setLoading(true);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    rpc('staff_listar_comprobantes', { p_token: getSessionToken() }).then((data) => {
      if (!cancelled) { setRows(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open]);

  async function revisar(id, aprobado) {
    setBusyId(id);
    const result = await rpc('staff_marcar_comprobante_revisado', { p_token: getSessionToken(), p_comprobante_id: id, p_aprobado: aprobado });
    setBusyId(null);
    if (!result) { showNotice?.(t('panel.comprobantes.processFailed'), true); return; }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, payload: result } : r)));
    // Aprobar renueva el plan en la base de datos: sin traer los datos frescos, Clientes/Notas/Sueldos
    // seguirían mostrando al cliente con el plan viejo hasta recargar la página.
    if (aprobado) await refreshAll();
    showNotice?.(aprobado ? t('panel.comprobantes.approvedNotice') : t('panel.comprobantes.rejectedNotice'));
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
        const key = r.payload?.clientName || t('panel.comprobantes.noClient');
        (acc[key] = acc[key] || []).push(r);
        return acc;
      }, {})
    )
    : null;

  function Row({ r }) {
    const { t } = useTranslation();
    const p = r.payload || {};
    const meta = ESTADO_LABEL[p.estado];
    const estadoText = meta ? t(`panel.comprobantes.${meta.key}`) : p.estado;
    const estadoCls = meta ? meta.cls : 'pending';
    const pendiente = p.estado === 'pendiente_revision' || p.estado === 'pendiente_lectura';
    return (
      <div className="note-card" key={r.id}>
        <div className="note-card-top">
          <span className={`badge ${estadoCls}`}>{estadoText}</span>
          <span className="muted note-date">{(p.createdAt || '').slice(0, 16).replace('T', ' ')}</span>
        </div>
        <p className="mb-1"><b>{p.clientName || t('panel.comprobantes.noClient')}</b> — {p.tipo === 'plan_nuevo' ? t('panel.comprobantes.newPlan') : t('panel.comprobantes.renewal')} {p.planNombre ? `(${p.planNombre})` : ''}</p>
        <p className="muted mb-1">
          {t('panel.comprobantes.expected')}: {p.montoEsperado != null ? formatMoney(p.montoEsperado) : '—'} · {t('panel.comprobantes.read')}: {p.montoLeido ?? '—'} {p.confianza ? t('panel.comprobantes.confidence', { value: p.confianza }) : ''}
        </p>
        {p.motivoError && <p className="receipt-error mb-1">{t('panel.comprobantes.reason')}: {p.motivoError}</p>}
        <div className="note-actions">
          {p.storagePath && (
            <button
              type="button"
              className="info"
              onClick={() => openReceipt(p.storagePath, () => showNotice?.(t('panel.comprobantes.receiptMissing'), true))}
            >
              {t('panel.comprobantes.viewReceipt')}
            </button>
          )}
          {pendiente && (
            <>
              <button type="button" className="success" disabled={busyId === r.id} onClick={() => revisar(r.id, true)}>✓ {t('panel.comprobantes.approveAndRenew')}</button>
              <button type="button" className="danger" disabled={busyId === r.id} onClick={() => revisar(r.id, false)}>{t('panel.comprobantes.reject')}</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal title={t('panel.comprobantes.title')} open={open} onClose={onClose} hideSave cancelLabel={t('panel.common.close')}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {[['errores', t('panel.comprobantes.tabErrors')], ['hoy', t('panel.common.today')], ['semana', t('panel.common.week')], ['clientes', t('panel.comprobantes.tabByClient')], ['todos', t('panel.common.all')]].map(([k, label]) => (
          <button key={k} type="button" className={`pill-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)} style={{ marginRight: 6 }}>
            {label}
          </button>
        ))}
      </div>
      {loading ? <p className="muted">{t('panel.common.loading')}</p> : (
        porCliente ? (
          porCliente.length ? porCliente.map(([cliente, items]) => (
            <div key={cliente} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>{cliente}</h3>
              <div className="notes-grid">{items.map((r) => <Row key={r.id} r={r} />)}</div>
            </div>
          )) : <p className="muted">{t('panel.comprobantes.empty')}</p>
        ) : (
          list.length ? <div className="notes-grid">{list.map((r) => <Row key={r.id} r={r} />)}</div> : <p className="muted">{t('panel.comprobantes.emptyHere')}</p>
        )
      )}
    </Modal>
  );
}

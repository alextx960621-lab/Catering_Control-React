import { useState } from 'react';
import { dbGetAuditLog, dbGetAllAuditLog } from '../../../services/db';
import { roleLabel } from '../../../services/panelAuth';
import DataTable from '../DataTable';

export default function AuditPage({ user }) {
  const [entries, setEntries] = useState(null); // null = todavía no se cargó nada
  const [showingAll, setShowingAll] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [search, setSearch] = useState('');

  async function refresh() {
    setLoadingLog(true);
    const rows = await dbGetAuditLog(300);
    setEntries(rows || []);
    setShowingAll(false);
    setLoadingLog(false);
  }

  async function loadAll() {
    setLoadingLog(true);
    const rows = await dbGetAllAuditLog();
    setEntries(rows || []);
    setShowingAll(true);
    setLoadingLog(false);
  }

  const q = search.toLowerCase();
  const list = (entries || [])
    .filter((e) => !q || [e.actor_name, e.actor_role, e.action, e.entity_type, e.entity_label].join(' ').toLowerCase().includes(q))
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const columns = [
    { key: 'at', label: 'Fecha', render: (e) => new Date(e.at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) },
    { key: 'actor_name', label: 'Quién', render: (e) => (<>{e.actor_name || '—'}<br /><small className="muted">{roleLabel(e.actor_role)}</small></>) },
    { key: 'action', label: 'Acción', render: (e) => e.action },
    { key: 'entity_label', label: 'Registro', render: (e) => e.entity_label || e.entity_type || '—' },
    { key: 'details', label: 'Detalle', render: (e) => Object.keys(e.details || {}).length ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—' },
  ];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>Auditoría</h1>
          <p>{entries === null ? 'Historial de cambios: quién hizo qué y cuándo.' : showingAll ? 'Mostrando el historial completo guardado.' : 'Últimos 300 eventos.'}</p>
        </div>
        <div className="head-actions">
          <button className="outline" onClick={refresh} disabled={loadingLog}>{loadingLog ? 'Cargando…' : 'Actualizar'}</button>
          {!showingAll && entries !== null && <button className="outline" onClick={loadAll} disabled={loadingLog}>Ver todos los eventos guardados</button>}
        </div>
      </div>

      {entries === null ? (
        <p className="muted">Presiona "Actualizar" para cargar el historial. No se consulta la base de datos hasta entonces.</p>
      ) : (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Buscar por persona, acción o registro…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="spacer" />
            <span className="muted">{list.length} eventos{showingAll ? ' (historial completo)' : ''}</span>
          </div>
          <DataTable columns={columns} rows={list} getRowId={(e) => e.id} emptyText="No hay eventos registrados." resizeGroup="audit" userId={user?.id} />
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dbGetAuditLog, dbGetAllAuditLog } from '../../../services/db';
import { roleLabel } from '../../../services/panelAuth';
import DataTable from '../DataTable';

export default function AuditPage({ user }) {
  const { t } = useTranslation();
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
    { key: 'at', label: t('panel.common.date'), render: (e) => new Date(e.at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) },
    { key: 'actor_name', label: t('panel.audit.colWho'), render: (e) => (<>{e.actor_name || '—'}<br /><small className="muted">{roleLabel(e.actor_role)}</small></>) },
    { key: 'action', label: t('panel.audit.colAction'), render: (e) => e.action },
    { key: 'entity_label', label: t('panel.audit.colRecord'), render: (e) => e.entity_label || e.entity_type || '—' },
    { key: 'details', label: t('panel.audit.colDetail'), render: (e) => Object.keys(e.details || {}).length ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—' },
  ];

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.audit')}</h1>
          <p>{entries === null ? t('panel.audit.descInitial') : showingAll ? t('panel.audit.descAll') : t('panel.audit.descRecent')}</p>
        </div>
        <div className="head-actions">
          <button className="primary" onClick={refresh} disabled={loadingLog}>{loadingLog ? t('panel.common.loading') : t('panel.audit.refresh')}</button>
          {!showingAll && entries !== null && <button className="info" onClick={loadAll} disabled={loadingLog}>{t('panel.audit.viewAll')}</button>}
        </div>
      </div>

      {entries === null ? (
        <p className="muted">{t('panel.audit.pressRefresh', { button: t('panel.audit.refresh') })}</p>
      ) : (
        <>
          <div className="toolbar">
            <input className="search" id="audit-search" name="audit-search" autoComplete="off" placeholder={t('panel.audit.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="spacer" />
            <span className="muted">{t('panel.audit.eventsCount', { count: list.length })}{showingAll ? t('panel.audit.fullHistorySuffix') : ''}</span>
          </div>
          <DataTable columns={columns} rows={list} getRowId={(e) => e.id} emptyText={t('panel.audit.noEvents')} resizeGroup="audit" userId={user?.id} />
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLE_LABELS, canAccessPage } from '../../services/panelAuth';

const NAV_ITEMS = [
  ['dispatch', '📅'],
  ['notes', '🔔'],
  ['menu', '🍲'],
  ['publicidad', '📣'],
  ['clients', '👥'],
  ['delivery', '🚚'],
  ['drivers', '🛵'],
  ['routes', '🚦'],
  ['plans', '📝'],
  ['payroll', '💵'],
  ['inventory', '📊'],
  ['metrics', '📈'],
  ['users', '👨‍✈️'],
  ['audit', '🕘'],
  ['settings', '🛠️'],
];

const RefreshIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const LogoutIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
  </svg>
);

export default function Sidebar({ brandName, brandLogo, user, activePage, onNavigate, onLogout, collapsed, onToggleCollapse, notesCount, pendingDaysCount, onRefresh, syncStatus }) {
  const { t } = useTranslation();
  const visibleItems = NAV_ITEMS.filter(([page]) => canAccessPage(page, user?.role));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function handleNavigate(page) {
    onNavigate(page);
    setMobileOpen(false);
  }

  // En móvil el menú vive arriba de la página (dentro del <aside>), no como ventana flotante
  function toggleMobileMenu() {
    setMobileOpen((v) => {
      const next = !v;
      if (next) window.scrollTo({ top: 0, behavior: 'smooth' });
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <>
      <aside className={collapsed ? 'sidebar-collapsed' : ''}>
        <div className="aside-title">
          <div className="brand">
            <div className="brand-mark">{brandLogo ? <img src={brandLogo} alt={brandName} /> : '🍽'}</div>
            <strong>{brandName}</strong>
          </div>
          <button className="collapse-toggle" onClick={onToggleCollapse} title={collapsed ? t('panel.topbar.expandMenu') : t('panel.topbar.collapseMenu')}>
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className={mobileOpen ? 'open' : ''}>
          {visibleItems.map(([page, icon]) => (
            <button key={page} className={page === activePage ? 'active' : ''} onClick={() => handleNavigate(page)}>
              <span className="nav-icon">
                {icon}
                {page === 'notes' && notesCount > 0 && <span className="nav-badge">{notesCount}</span>}
                {page === 'dispatch' && pendingDaysCount > 0 && <span className="nav-badge" title={t('panel.topbar.daysPending')}>{pendingDaysCount}</span>}
              </span>
              <span className="nav-label">{t('panel.nav.' + page)}</span>
            </button>
          ))}
        </nav>

        <div className="aside-bottom">
          <div className="profile" title={t('panel.topbar.viewSession')}>
            <div className="avatar">{(user?.name || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{user?.name || t('panel.topbar.operations')}</b>
              <small className="muted" style={{ display: 'block', fontSize: 10 }}>{user?.role ? t('panel.roles.' + user.role, { defaultValue: ROLE_LABELS[user.role] || user.role }) : ''}</small>
            </div>
          </div>
        </div>
      </aside>

      {/* Grupo superior derecho: hamburguesa (solo en pantallas chicas) → Actualizar → puntito de… */}
      <div className="top-actions">
        <button className="menu-toggle" onClick={toggleMobileMenu} aria-label={t('panel.topbar.openMenu')}>☰</button>
        <button className="top-refresh" onClick={handleRefresh} disabled={refreshing} title={t('panel.topbar.refreshData')}>
          {RefreshIcon}<span className="btn-text">{refreshing ? t('panel.topbar.updating') : t('panel.topbar.refresh')}</span>
        </button>
        <span className={`sync-dot ${syncStatus}`} title={syncStatus === 'error' ? t('panel.topbar.syncError') : t('panel.topbar.syncOk')} />
        <button className="top-logout" onClick={onLogout} title={t('panel.topbar.logout')}>
          {LogoutIcon}<span className="btn-text"> {t('panel.topbar.logoutShort')}</span>
        </button>
      </div>
    </>
  );
}

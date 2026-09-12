import { useState } from 'react';
import { ROLE_LABELS, canAccessPage } from '../../services/panelAuth';

const NAV_ITEMS = [
  ['dispatch', '📅', 'Día de trabajo'],
  ['notes', '🔔', 'Notas'],
  ['clients', '👥', 'Clientes'],
  ['delivery', '🚚', 'Despacho'],
  ['drivers', '🛵', 'Drivers'],
  ['routes', '🚦', 'Rutas'],
  ['plans', '📝', 'Planes'],
  ['payroll', '💵', 'Sueldos'],
  ['inventory', '📊', 'Inventario'],
  ['metrics', '📈', 'Métricas'],
  ['users', '👨‍✈️', 'Usuarios'],
  ['audit', '🕘', 'Auditoría'],
  ['settings', '🛠️', 'Configuración'],
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

export default function Sidebar({ brandName, brandLogo, user, activePage, onNavigate, onLogout, collapsed, onToggleCollapse, notesCount, onRefresh, syncStatus }) {
  const visibleItems = NAV_ITEMS.filter(([page]) => canAccessPage(page, user?.role));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function handleNavigate(page) {
    onNavigate(page);
    setMobileOpen(false);
  }

  // En móvil el menú vive arriba de la página (dentro del <aside>), no
  // como ventana flotante. Si el usuario está scrolleado hacia abajo
  // (ej. leyendo la tabla de Día de trabajo) y toca la hamburguesa, el
  // menú se abre pero queda fuera de la pantalla hasta que suba a mano.
  // Por eso, al ABRIRLO (no al cerrarlo), llevamos el scroll arriba del
  // todo para que se vea directamente, sin importar en qué parte de la
  // web estaba.
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
          <button className="collapse-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expandir menú' : 'Contraer menú'}>
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className={mobileOpen ? 'open' : ''}>
          {visibleItems.map(([page, icon, label]) => (
            <button key={page} className={page === activePage ? 'active' : ''} onClick={() => handleNavigate(page)}>
              <span className="nav-icon">
                {icon}
                {page === 'notes' && notesCount > 0 && <span className="nav-badge">{notesCount}</span>}
              </span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="aside-bottom">
          <div className="profile" title="Ver sesión">
            <div className="avatar">{(user?.name || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{user?.name || 'Operaciones'}</b>
              <small className="muted" style={{ display: 'block', fontSize: 10 }}>{ROLE_LABELS[user?.role] || user?.role}</small>
            </div>
          </div>
        </div>
      </aside>

      {/* Grupo superior derecho: hamburguesa (solo en pantallas chicas) →
          Actualizar → puntito de estado → Salir. Es EL ÚNICO lugar de
          toda la app con un botón para refrescar los datos a mano — así
          no hay dos botones distintos que hagan lo mismo con nombres
          distintos ("Sincronizar" en un lado, "Actualizar" en otro). */}
      <div className="top-actions">
        <button className="menu-toggle" onClick={toggleMobileMenu} aria-label="Abrir menú">☰</button>
        <button className="top-refresh" onClick={handleRefresh} disabled={refreshing} title="Actualizar datos">
          {RefreshIcon}<span className="btn-text">{refreshing ? 'Actualizando…' : 'Actualizar'}</span>
        </button>
        <span className={`sync-dot ${syncStatus}`} title={syncStatus === 'error' ? 'Hubo un problema al sincronizar' : 'Todo sincronizado'} />
        <button className="top-logout" onClick={onLogout} title="Cerrar sesión">
          {LogoutIcon}<span className="btn-text"> Salir</span>
        </button>
      </div>
    </>
  );
}

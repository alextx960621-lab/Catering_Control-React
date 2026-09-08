const LogoutIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export default function LogoutButton({ onLogout }) {
  return (
    <button className="client-logout-btn" onClick={onLogout} title="Cerrar sesión">
      {LogoutIcon}
      <span>Salir</span>
    </button>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PanelPage.css';
import config from '../services/config';
import { readStaffSession, clearSessions } from '../services/session';
import { setSessionToken, revokeSession, joinPresence } from '../services/supabaseClient';
import { fetchBrandingRemote } from '../services/clienteData';
import { OperationsProvider, useOperations } from '../context/OperationsContext';
import { getTheme as getMyCachedTheme } from '../services/userPrefs';
import Sidebar from '../components/panel/Sidebar';
import DispatchPage from '../components/panel/dispatch/DispatchPage';
import NotesPage from '../components/panel/notes/NotesPage';
import DriversPage from '../components/panel/drivers/DriversPage';
import RoutesPage from '../components/panel/routes/RoutesPage';
import PlansPage from '../components/panel/plans/PlansPage';
import ClientsPage from '../components/panel/clients/ClientsPage';
import DeliveryPage from '../components/panel/delivery/DeliveryPage';
import UsersPage from '../components/panel/users/UsersPage';
import AuditPage from '../components/panel/audit/AuditPage';
import SettingsPage from '../components/panel/settings/SettingsPage';
import PayrollPage from '../components/panel/payroll/PayrollPage';
import InventoryPage from '../components/panel/inventory/InventoryPage';
import MetricsPage from '../components/panel/metrics/MetricsPage';
import PremiumPageLock from '../components/panel/PremiumPageLock';
import { isPagePremiumLocked } from '../services/panelAuth';

const PAGE_TITLES = {
  dispatch: 'Día de trabajo', notes: 'Notas', clients: 'Clientes', delivery: 'Despacho',
  drivers: 'Drivers', routes: 'Rutas', plans: 'Planes', payroll: 'Sueldos',
  inventory: 'Inventario', metrics: 'Métricas', users: 'Usuarios', audit: 'Auditoría', settings: 'Configuración',
};
const BUILT_PAGES = ['dispatch', 'notes', 'clients', 'delivery', 'drivers', 'routes', 'plans', 'users', 'audit', 'settings', 'payroll', 'inventory', 'metrics'];

function PagePlaceholder({ page }) {
  return (
    <section className="page active">
      <div className="page-head"><div>
        <h1>{PAGE_TITLES[page] || page}</h1>
        <p>Esta pantalla todavía no está migrada a React — próximamente.</p>
      </div></div>
    </section>
  );
}

// Todo lo de acá adentro ya puede usar useOperations() (clientes, rutas,
// drivers, planes, notas) porque vive DENTRO de <OperationsProvider>.
function PanelShell({ user, branding, theme, onThemeChange, activePage, onNavigate, onLogout, collapsed, onToggleCollapse }) {
  const { notice, refreshAll, settings, notes } = useOperations();
  // Cuántas notas están pendientes (sin cumplir) — se muestra como
  // numerito rojo en la campanita de Notas del menú, igual que las
  // notificaciones de redes sociales.
  const notesCount = notes.filter((nt) => nt.status !== 'cumplida').length;
  const isPremium = settings.plan === 'premium';
  const [pendingClientAction, setPendingClientAction] = useState(null); // { clientId, action: 'edit'|'renew' }
  // Última renovación/compra de plan confirmada por cliente, para que Notas
  // pueda armar el mensaje de WhatsApp al marcar "Cumplida" una solicitud.
  const [renewalByClient, setRenewalByClient] = useState({});

  function goToClient(clientId, action) {
    setPendingClientAction({ clientId, action });
    onNavigate('clients');
  }
  function recordRenewal(clientId, info) {
    setRenewalByClient((prev) => ({ ...prev, [clientId]: info }));
  }
  function consumeRenewal(clientId) {
    setRenewalByClient((prev) => {
      if (!(clientId in prev)) return prev;
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }

  function locked(page) {
    return isPagePremiumLocked(page, settings.premiumLockedPages) && !isPremium;
  }
  function gated(page, label, Component) {
    if (locked(page)) return <PremiumPageLock featureLabel={label} premiumWhatsapp={settings.premiumWhatsapp} />;
    return <Component user={user} />;
  }

  return (
    <div id="app" className={collapsed ? 'sidebar-collapsed' : ''}>
      <Sidebar
        brandName={branding.companyName} brandLogo={branding.logoUrl} user={user}
        activePage={activePage} onNavigate={onNavigate} onLogout={onLogout}
        collapsed={collapsed} onToggleCollapse={onToggleCollapse} notesCount={notesCount}
        onRefresh={refreshAll} syncStatus={notice?.error ? 'error' : 'ok'}
      />
      <main>
        {notice && (
          <div key={notice.key} className={`panel-toast${notice.error ? ' error' : ''}`}>{notice.text}</div>
        )}
        {activePage === 'dispatch' && <DispatchPage user={user} onGoToClient={goToClient} />}
        {activePage === 'notes' && (locked('notes') ? <PremiumPageLock featureLabel="Notas" premiumWhatsapp={settings.premiumWhatsapp} /> : <NotesPage user={user} onGoToClient={goToClient} renewalByClient={renewalByClient} onConsumeRenewal={consumeRenewal} />)}
        {activePage === 'drivers' && <DriversPage user={user} />}
        {activePage === 'routes' && <RoutesPage user={user} />}
        {activePage === 'plans' && <PlansPage user={user} />}
        {activePage === 'clients' && <ClientsPage user={user} pendingClientAction={pendingClientAction} onConsumePendingClientAction={() => setPendingClientAction(null)} onRenewalCompleted={recordRenewal} onReturnToNotes={() => onNavigate('notes')} />}
        {activePage === 'delivery' && <DeliveryPage user={user} />}
        {activePage === 'users' && <UsersPage user={user} />}
        {activePage === 'audit' && gated('audit', 'Auditoría', AuditPage)}
        {activePage === 'settings' && <SettingsPage user={user} theme={theme} onThemeChange={onThemeChange} />}
        {activePage === 'payroll' && gated('payroll', 'Sueldos', PayrollPage)}
        {activePage === 'inventory' && gated('inventory', 'Inventario', InventoryPage)}
        {activePage === 'metrics' && gated('metrics', 'Métricas', MetricsPage)}
        {!BUILT_PAGES.includes(activePage) && <PagePlaceholder page={activePage} />}
      </main>
    </div>
  );
}

// Reemplaza a panel.html. El armazón (menú lateral, roles, sesión, tema)
// ya está completo; las pantallas se van completando una por una.
export default function PanelPage() {
  const [phase, setPhase] = useState('checking'); // 'checking' | 'ready'
  const [user, setUser] = useState(null);
  const [branding, setBranding] = useState({ companyName: config.companyName, logoUrl: config.logoUrl });
  // Arranca con el tema que este mismo navegador tenga cacheado para el
  // usuario de la sesión (si hay), para no pintar "Claro" un instante y
  // después saltar al tema real -- el valor definitivo (que puede venir
  // de OTRO dispositivo) lo confirma OperationsContext al cargar
  // userPrefs del servidor, vía onThemeFromSettings.
  const [theme, setTheme] = useState(() => {
    const cachedSession = readStaffSession();
    return (cachedSession && getMyCachedTheme(cachedSession.id)) || 'light';
  });
  const [activePage, setActivePage] = useState('dispatch');
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const session = readStaffSession();
      if (!session) {
        navigate('/', { replace: true });
        return;
      }
      setSessionToken(session.sessionToken || null, 'staff');
      setUser(session);

      const freshBranding = await fetchBrandingRemote();
      if (freshBranding) setBranding(freshBranding);

      joinPresence({ id: session.id, role: session.role === 'driver' ? 'driver' : 'staff', name: session.name });
      setPhase('ready');
    })();
  }, [navigate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.bsTheme = theme === 'night' ? 'dark' : 'light';
  }, [theme]);

  function handleLogout() {
    revokeSession();
    clearSessions();
    navigate('/', { replace: true });
  }

  if (phase === 'checking') {
    return <p className="text-secondary text-center py-5">Cargando el panel…</p>;
  }

  return (
    <div className="panel-shell">
      <OperationsProvider userId={user?.id} onThemeFromSettings={setTheme}>
        <PanelShell
          user={user} branding={branding} theme={theme} onThemeChange={setTheme} activePage={activePage}
          onNavigate={setActivePage} onLogout={handleLogout}
          collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </OperationsProvider>
    </div>
  );
}

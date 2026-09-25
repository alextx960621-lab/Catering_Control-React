import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './PanelPage.css';
import config from '../services/config';
import { readStaffSession, clearSessions } from '../services/session';
import { setSessionToken, revokeSession, joinPresence, leavePresence } from '../services/supabaseClient';
import { fetchBrandingRemote } from '../services/clienteData';
import { OperationsProvider, useOperations } from '../context/OperationsContext';
import { getTheme as getMyCachedTheme } from '../services/userPrefs';
import Sidebar from '../components/panel/Sidebar';
import DispatchPage from '../components/panel/dispatch/DispatchPage';
import NotesPage from '../components/panel/notes/NotesPage';
import MenuPage from '../components/panel/menu/MenuPage';
import PublicidadPage from '../components/panel/publicidad/PublicidadPage';
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
import { canManage, isPagePremiumLocked } from '../services/panelAuth';

function PanelShell({ user, branding, theme, onThemeChange, activePage, onNavigate, onLogout, collapsed, onToggleCollapse }) {
  const { t, i18n } = useTranslation();
  const { notice, refreshAll, settings, notes, pendingDays } = useOperations();
  // La pestaña del navegador identifica en qué pantalla está (útil con varias abiertas)
  useEffect(() => {
    document.title = `${branding.companyName} · ${t(`panel.nav.${activePage}`)}`;
  }, [branding.companyName, activePage, t, i18n.language]);
  // Cuántas notas están pendientes (sin cumplir) — se muestra como numerito rojo en la…
  const notesCount = notes.filter((nt) => nt.status !== 'cumplida').length;
  const isPremium = settings.plan === 'premium';
  const [pendingClientAction, setPendingClientAction] = useState(null);
  // Última renovación/compra de plan confirmada por cliente, para que Notas pueda armar el…
  const [renewalByClient, setRenewalByClient] = useState({});

  // origin = la pantalla desde la que se pidió esto (queda "congelada" acá porque activePage…
  function goToClient(clientId, action) {
    setPendingClientAction({ clientId, action, origin: activePage });
    onNavigate('clients');
  }
  useEffect(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      try { d.close(); } catch {/* ignorar */}
    });
  }, [activePage]);

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
        pendingDaysCount={canManage(user?.role, settings.customRoles, 'dispatch') ? pendingDays.length : 0}
        onRefresh={refreshAll} syncStatus={notice?.error ? 'error' : 'ok'}
      />
      <main>
        {notice && (
          <div key={notice.key} className={`panel-toast${notice.error ? ' error' : ''}`}>{notice.text}</div>
        )}
        <div style={{ display: activePage === 'dispatch' ? '' : 'none' }}>
          <DispatchPage user={user} onGoToClient={goToClient} />
        </div>
        {locked('notes')
          ? (activePage === 'notes' && <PremiumPageLock featureLabel={t('panel.nav.notes')} premiumWhatsapp={settings.premiumWhatsapp} />)
          : (
            <div style={{ display: activePage === 'notes' ? '' : 'none' }}>
              <NotesPage user={user} onGoToClient={goToClient} renewalByClient={renewalByClient} onConsumeRenewal={consumeRenewal} />
            </div>
          )}
        {activePage === 'drivers' && <DriversPage user={user} />}
        {activePage === 'routes' && <RoutesPage user={user} />}
        {activePage === 'plans' && <PlansPage user={user} />}
        {activePage === 'menu' && <MenuPage user={user} />}
        {activePage === 'publicidad' && <PublicidadPage />}
        <div style={{ display: activePage === 'clients' ? '' : 'none' }}>
          <ClientsPage user={user} pendingClientAction={pendingClientAction} onConsumePendingClientAction={() => setPendingClientAction(null)} onRenewalCompleted={recordRenewal} onReturnToOrigin={(origin) => onNavigate(origin || 'notes')} />
        </div>
        {activePage === 'delivery' && <DeliveryPage user={user} />}
        {activePage === 'users' && <UsersPage user={user} />}
        {activePage === 'audit' && gated('audit', t('panel.nav.audit'), AuditPage)}
        {activePage === 'settings' && <SettingsPage user={user} theme={theme} onThemeChange={onThemeChange} />}
        {activePage === 'payroll' && gated('payroll', t('panel.nav.payroll'), PayrollPage)}
        {activePage === 'inventory' && gated('inventory', t('panel.nav.inventory'), InventoryPage)}
        {activePage === 'metrics' && gated('metrics', t('panel.nav.metrics'), MetricsPage)}
      </main>
    </div>
  );
}

// Reemplaza a panel.html: arma el menú lateral (roles, sesión, tema) y muestra la pantalla…
export default function PanelPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState('checking'); // 'checking' | 'ready'
  const [user, setUser] = useState(null);
  const [branding, setBranding] = useState({ companyName: config.companyName, logoUrl: config.logoUrl });
  // Arranca con el tema que este mismo navegador tenga cacheado para el usuario de la sesión…
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
    leavePresence();
    revokeSession();
    clearSessions();
    navigate('/', { replace: true });
  }

  if (phase === 'checking') {
    return <p className="text-secondary text-center py-5">{t('panel.loadingPanel')}</p>;
  }

  return (
    <div className="panel-shell">
      <OperationsProvider userId={user?.id} user={user} onThemeFromSettings={setTheme}>
        <PanelShell
          user={user} branding={branding} theme={theme} onThemeChange={setTheme} activePage={activePage}
          onNavigate={setActivePage} onLogout={handleLogout}
          collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </OperationsProvider>
    </div>
  );
}

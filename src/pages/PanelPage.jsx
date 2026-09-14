import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  // origin = la pantalla desde la que se pidió esto (queda "congelada" acá
  // porque activePage ya cambió a 'clients' para cuando el formulario se
  // cierra) -- así al guardar/cancelar se puede volver exactamente a Día
  // de trabajo o a Notas, según desde dónde se haya abierto, en vez de
  // mandar siempre a Notas sin importar el origen real.
  function goToClient(clientId, action) {
    setPendingClientAction({ clientId, action, origin: activePage });
    onNavigate('clients');
  }
  // BUG GRAVE (reportado 13 sep: "la PWA se quedó colgada, solo se movía
  // arriba/abajo la pantalla pero ningún botón funcionaba"): Día de
  // trabajo, Notas y Clientes quedan SIEMPRE montadas (ver más abajo,
  // solo se ocultan con display:none) para no perder el scroll/filtros al
  // volver -- pero sus modales (<dialog> nativo, en Modal.jsx) TAMBIÉN
  // quedan siempre montados. Si alguien deja un modal ABIERTO en, por
  // ejemplo, Clientes, y navega a otra pantalla por el menú lateral, ese
  // <dialog> se queda "showModal()"eado (técnicamente abierto) debajo de
  // un contenedor ahora en display:none -- en algunos navegadores/celus
  // eso deja su ::backdrop invisible pero SIGUE capturando todos los
  // clics de la pantalla que sí se ve, porque el modal nativo sigue
  // siendo "el tope" aunque esté oculto. Por eso solo respondía el
  // scroll (que es del navegador, no de un click) y ningún botón.
  // Se cierra cualquier <dialog> que haya quedado abierto cada vez que
  // se cambia de pantalla -- dialog.close() dispara el evento nativo
  // "close", que Modal.jsx ya tiene conectado a onClose, así que esto
  // también limpia el estado de React de la pantalla de origen (ej.
  // `editing` vuelve a null), no es solo un cierre visual.
  useEffect(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      try { d.close(); } catch (_) { /* ignorar */ }
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
        onRefresh={refreshAll} syncStatus={notice?.error ? 'error' : 'ok'}
      />
      <main>
        {notice && (
          <div key={notice.key} className={`panel-toast${notice.error ? ' error' : ''}`}>{notice.text}</div>
        )}
        {/* Antes estas 3 pantallas solo estaban en el DOM mientras eran la
            página activa (montaje condicional) -- cada vez que alguien
            editaba un cliente desde Día de trabajo o Notas y volvía, React
            las desmontaba y volvía a montar de cero, perdiendo la búsqueda,
            los filtros, el orden de columnas y el scroll de la tabla (quedaba
            "como recién entrado"). Ahora quedan siempre montadas (ocultas
            con display:none cuando no son la activa) para que todo ese
            estado -- y el scroll de `.sheet`, que tiene su propio contenedor
            con overflow propio -- se mantenga tal cual se dejó. */}
        <div style={{ display: activePage === 'dispatch' ? '' : 'none' }}>
          <DispatchPage user={user} onGoToClient={goToClient} />
        </div>
        {locked('notes')
          ? (activePage === 'notes' && <PremiumPageLock featureLabel="Notas" premiumWhatsapp={settings.premiumWhatsapp} />)
          : (
            <div style={{ display: activePage === 'notes' ? '' : 'none' }}>
              <NotesPage user={user} onGoToClient={goToClient} renewalByClient={renewalByClient} onConsumeRenewal={consumeRenewal} />
            </div>
          )}
        {activePage === 'drivers' && <DriversPage user={user} />}
        {activePage === 'routes' && <RoutesPage user={user} />}
        {activePage === 'plans' && <PlansPage user={user} />}
        <div style={{ display: activePage === 'clients' ? '' : 'none' }}>
          <ClientsPage user={user} pendingClientAction={pendingClientAction} onConsumePendingClientAction={() => setPendingClientAction(null)} onRenewalCompleted={recordRenewal} onReturnToOrigin={(origin) => onNavigate(origin || 'notes')} />
        </div>
        {activePage === 'delivery' && <DeliveryPage user={user} />}
        {activePage === 'users' && <UsersPage user={user} />}
        {activePage === 'audit' && gated('audit', 'Auditoría', AuditPage)}
        {activePage === 'settings' && <SettingsPage user={user} theme={theme} onThemeChange={onThemeChange} />}
        {activePage === 'payroll' && gated('payroll', 'Sueldos', PayrollPage)}
        {activePage === 'inventory' && gated('inventory', 'Inventario', InventoryPage)}
        {activePage === 'metrics' && gated('metrics', 'Métricas', MetricsPage)}
      </main>
    </div>
  );
}

// Reemplaza a panel.html: arma el menú lateral (roles, sesión, tema) y
// muestra la pantalla que corresponda según activePage.
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
    leavePresence();
    revokeSession();
    clearSessions();
    navigate('/', { replace: true });
  }

  if (phase === 'checking') {
    return <p className="text-secondary text-center py-5">Cargando el panel…</p>;
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

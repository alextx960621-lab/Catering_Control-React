import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ClientePage.css';
import config from '../services/config';
import { readClientSession, clearSessions } from '../services/session';
import { readOperations, writeOperations, readClientRow, writeClientRow, readCachedBranding, getClientTheme, saveClientTheme } from '../services/clienteStorage';
import { fetchBrandingRemote, fetchIsPremium, fetchServerSync, saveClient } from '../services/clienteData';
import { setSessionToken, dbGetClientRow, dbSaveOwnClientProfile, joinPresence, revokeSession } from '../services/supabaseClient';
import Portal from '../components/cliente/Portal';
import PremiumLock from '../components/cliente/PremiumLock';

// Reemplaza a cliente.html. Tres fases:
//   'checking' → validando la sesión y trayendo los datos (spinner de texto)
//   'locked'   → la empresa no tiene el plan Premium que desbloquea el portal
//   'portal'   → todo listo, se muestra Portal.jsx
export default function ClientePage() {
  const [phase, setPhase] = useState('checking');
  const [data, setData] = useState(null);
  const [client, setClient] = useState(null);
  const [branding, setBranding] = useState(() => readCachedBranding());
  const [theme, setTheme] = useState('light');
  const navigate = useNavigate();
  const sessionRef = useRef(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    (async () => {
      const session = readClientSession();
      if (!session) {
        navigate('/', { replace: true });
        return;
      }
      sessionRef.current = session;
      setSessionToken(session.sessionToken || null, 'cliente');

      let localData = readOperations();
      localData.days || (localData.days = {});
      let localClient = readClientRow();
      const needsClientFetch = !localClient || localClient.id !== session.id;

      const [fetchedClient, freshBranding, isPremium] = await Promise.all([
        needsClientFetch ? dbGetClientRow(session.id) : Promise.resolve(localClient),
        fetchBrandingRemote(),
        fetchIsPremium(),
      ]);

      if (needsClientFetch) {
        if (!fetchedClient) {
          navigate('/', { replace: true });
          return;
        }
        localClient = fetchedClient;
        writeClientRow(localClient);
      }

      setData(localData);
      setClient(localClient);
      // Si el cliente ya eligió un tema desde ALGÚN dispositivo, ese es
      // el que manda (uiTheme viaja con su propia fila — ver
      // supabase-setup-final-v2.sql sección 15); si nunca eligió
      // ninguno, se usa el último visto en este navegador como default.
      setTheme(localClient.uiTheme || getClientTheme(session.id));
      if (freshBranding) setBranding(freshBranding);

      if (!isPremium) {
        setPhase('locked');
        return;
      }
      setPhase('portal');
      joinPresence({ id: localClient.id, role: 'cliente', name: localClient.name });

      // Segunda pasada: refresca en segundo plano con lo último del
      // servidor (por si algo cambió desde el panel mientras tanto).
      const [{ remoteMeta, remoteClient }, freshBranding2] = await Promise.all([fetchServerSync(session.id), fetchBrandingRemote()]);
      if (remoteMeta) {
        const merged = { ...localData, plans: remoteMeta.plans ?? localData.plans, days: remoteMeta.days ?? localData.days, currentDate: remoteMeta.currentDate ?? localData.currentDate };
        writeOperations(merged);
        localData = merged;
        setData(merged);
      }
      if (remoteClient) {
        writeClientRow(remoteClient);
        setClient(remoteClient);
        if (remoteClient.uiTheme) setTheme(remoteClient.uiTheme);
      }
      if (freshBranding2) setBranding(freshBranding2);
      if (!(await fetchIsPremium())) setPhase('locked');
    })();
  }, [navigate]);

  // El tema (y el modo claro/oscuro de Bootstrap) se aplica a <html>.
  useEffect(() => {
    if (phase === 'locked') {
      document.documentElement.dataset.bsTheme = 'light';
      document.documentElement.dataset.theme = 'light';
    } else if (phase === 'portal') {
      document.documentElement.dataset.bsTheme = theme === 'night' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
    }
  }, [phase, theme]);

  function handleThemeChange(newTheme) {
    if (sessionRef.current) {
      saveClientTheme(sessionRef.current.id, newTheme); // cache local, instantáneo
      dbSaveOwnClientProfile(sessionRef.current.id, { uiTheme: newTheme }); // viaja con la cuenta a otros dispositivos
    }
    setClient((prev) => (prev ? { ...prev, uiTheme: newTheme } : prev));
    setTheme(newTheme);
  }

  // onLocalUpdateOnly=true: el cambio ya se guardó server-side por otro
  // camino (ver handleAddressOverride en Portal.jsx) — acá solo se
  // refleja en pantalla, sin volver a llamar a guardar.
  async function handleSaveClient(updated, onLocalUpdateOnly) {
    if (onLocalUpdateOnly) {
      setClient(updated);
      return true;
    }
    const saved = await saveClient(updated);
    if (saved) setClient(updated);
    return saved;
  }

  function handleLogout() {
    revokeSession();
    clearSessions();
    navigate('/', { replace: true });
  }

  if (phase === 'checking') {
    return (
      <div className="text-secondary text-center py-5">
        <div className="spinner-border mb-2" role="status" style={{ width: '1.8rem', height: '1.8rem' }}>
          <span className="visually-hidden">Cargando…</span>
        </div>
        <p className="mb-0">Cargando tu portal…</p>
      </div>
    );
  }

  return (
    <main className="container portal py-3 py-md-4">
      {phase === 'locked' ? (
        <PremiumLock branding={branding} appConfig={config} onLogout={handleLogout} />
      ) : (
        <Portal
          data={data}
          client={client}
          appConfig={config}
          branding={branding}
          theme={theme}
          onThemeChange={handleThemeChange}
          onSaveClient={handleSaveClient}
          onLogout={handleLogout}
        />
      )}
    </main>
  );
}

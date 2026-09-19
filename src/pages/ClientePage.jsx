import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ClientePage.css';
import config from '../services/config';
import { readClientSession, clearSessions } from '../services/session';
import { readOperations, writeOperations, readClientRow, writeClientRow, readCachedBranding, readCachedIsPremium, getClientTheme, saveClientTheme } from '../services/clienteStorage';
import { fetchBrandingRemote, fetchIsPremium, fetchServerSync, saveClient } from '../services/clienteData';
import { setSessionToken, dbGetClientRow, dbSaveOwnClientProfile, dbGetOwnDriver, joinPresence, leavePresence, revokeSession } from '../services/supabaseClient';
import Portal from '../components/cliente/Portal';
import PremiumLock from '../components/cliente/PremiumLock';
import { usePageBodyClass } from '../hooks/usePageBodyClass';

// Reemplaza a cliente.html. Tres fases:
//   'checking' → validando la sesión y trayendo los datos (spinner de texto)
//   'locked'   → la empresa no tiene el plan Premium que desbloquea el portal
//   'portal'   → todo listo, se muestra Portal.jsx
export default function ClientePage() {
  const [phase, setPhase] = useState('checking');
  const [data, setData] = useState(null);
  const [client, setClient] = useState(null);
  const [driver, setDriver] = useState(null);
  const [branding, setBranding] = useState(() => readCachedBranding());
  const [theme, setTheme] = useState('light');
  const navigate = useNavigate();
  const sessionRef = useRef(null);
  const bootedRef = useRef(false);
  usePageBodyClass('page-cliente');

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
      const cachedBranding = readCachedBranding();
      const cachedIsPremium = readCachedIsPremium();
      const hasFullCache = localClient && localClient.id === session.id && cachedBranding?.companyName && cachedIsPremium !== null;

      // Camino rápido: ya lo abrió antes en este dispositivo y quedó todo
      // cacheado (el caso típico de la PWA instalada, ya logueada). Se
      // pinta el portal DE UNA con lo que ya hay guardado, sin esperar
      // ninguna vuelta de red -- antes acá esperábamos igual a
      // get_branding + get_plan_status aunque el cliente ya estuviera en
      // caché, y esos dos viajes de red eran justamente la lentitud.
      // Después, dos líneas más abajo, se refresca todo en segundo plano
      // igual que siempre (incluida la revalidación real de Premium).
      if (hasFullCache) {
        setData(localData);
        setClient(localClient);
        setTheme(localClient.uiTheme || getClientTheme());
        setBranding(cachedBranding);
        setPhase(cachedIsPremium ? 'portal' : 'locked');
        if (cachedIsPremium) joinPresence({ id: localClient.id, role: 'cliente', name: localClient.name });
      }

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

      localData = readOperations();
      localData.days || (localData.days = {});
      setData(localData);
      setClient(localClient);
      // Si el cliente ya eligió un tema desde ALGÚN dispositivo, ese es
      // el que manda (uiTheme viaja con su propia fila — ver
      // supabase-setup-final-v2.sql sección 15); si nunca eligió
      // ninguno, se usa el último visto en este navegador como default.
      setTheme(localClient.uiTheme || getClientTheme());
      if (freshBranding) setBranding(freshBranding);

      // isPremium === null → la red falló (get_plan_status no respondió).
      // Si ya lo habíamos mostrado por el camino rápido de arriba, se deja
      // como estaba en vez de tirarlo a "locked" por un problema de red;
      // si no había caché, es la primera carga y ahí sí hay que decidir.
      if (isPremium === false || (isPremium === null && !hasFullCache)) {
        if (hasFullCache && cachedIsPremium) leavePresence();
        setPhase('locked');
        return;
      }
      if (isPremium !== null || !hasFullCache) setPhase('portal');
      if (!hasFullCache) joinPresence({ id: localClient.id, role: 'cliente', name: localClient.name });

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
      const stillPremium = await fetchIsPremium();
      if (stillPremium === false) setPhase('locked');
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

  // "Tu repartidor": se vuelve a pedir cada vez que cambia la dirección
  // activa O la ruta de esa dirección (ej. si el staff reasigna la ruta
  // de una dirección existente), no solo una vez al entrar.
  const activeRouteId = client?.addresses?.find((a) => a.id === client.activeAddressId)?.routeId || '';
  useEffect(() => {
    if (!client?.id || !activeRouteId) { setDriver(null); return; }
    let cancelled = false;
    dbGetOwnDriver(client.id).then((d) => { if (!cancelled) setDriver(d); });
    return () => { cancelled = true; };
  }, [client?.id, activeRouteId]);

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
    leavePresence();
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
          driver={driver}
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

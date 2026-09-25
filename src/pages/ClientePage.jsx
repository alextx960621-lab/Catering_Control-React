import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './ClientePage.css';
import config from '../services/config';
import { readClientSession, clearSessions } from '../services/session';
import { readOperations, writeOperations, readClientRow, writeClientRow, readCachedBranding, readCachedIsPremium, getClientTheme, saveClientTheme } from '../services/clienteStorage';
import { fetchBrandingRemote, fetchIsPremium, fetchServerSync, saveClient } from '../services/clienteData';
import { setSessionToken, dbGetClientRow, dbSaveOwnClientProfile, dbGetOwnDriver, joinPresence, leavePresence, revokeSession } from '../services/supabaseClient';
import Portal from '../components/cliente/Portal';
import PremiumLock from '../components/cliente/PremiumLock';
import { usePageBodyClass } from '../hooks/usePageBodyClass';

// Reemplaza a cliente.html
export default function ClientePage() {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState('checking');
  const [data, setData] = useState(null);
  const [client, setClient] = useState(null);
  const [fetchedDriver, setDriver] = useState(null);
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
      if (!localData.days) localData.days = {};
      let localClient = readClientRow();
      const cachedBranding = readCachedBranding();
      const cachedIsPremium = readCachedIsPremium();
      const hasFullCache = localClient && localClient.id === session.id && cachedBranding?.companyName && cachedIsPremium !== null;

      // Camino rápido: ya lo abrió antes en este dispositivo y quedó todo cacheado (el caso…
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
      if (!localData.days) localData.days = {};
      setData(localData);
      setClient(localClient);
      // Si el cliente ya eligió un tema desde ALGÚN dispositivo, ese es el que manda (uiTheme…
      setTheme(localClient.uiTheme || getClientTheme());
      if (freshBranding) setBranding(freshBranding);

      // isPremium === null → la red falló (get_plan_status no respondió)
      if (isPremium === false || (isPremium === null && !hasFullCache)) {
        if (hasFullCache && cachedIsPremium) leavePresence();
        setPhase('locked');
        return;
      }
      if (isPremium !== null || !hasFullCache) setPhase('portal');
      if (!hasFullCache) joinPresence({ id: localClient.id, role: 'cliente', name: localClient.name });

      // Segunda pasada: refresca en segundo plano con lo último del servidor (por si algo cambió…
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

  // La fecha operativa del portal viene del servidor y cambia todos los días: si la app quedó…
  useEffect(() => {
    if (phase !== 'portal') return undefined;
    let lastSync = Date.now();
    async function resync() {
      const session = sessionRef.current;
      if (!session) return;
      lastSync = Date.now();
      const { remoteMeta, remoteClient } = await fetchServerSync(session.id);
      if (remoteMeta) {
        const local = readOperations();
        const merged = { ...local, plans: remoteMeta.plans ?? local.plans, days: remoteMeta.days ?? local.days, currentDate: remoteMeta.currentDate ?? local.currentDate };
        writeOperations(merged);
        setData(merged);
      }
      if (remoteClient) {
        writeClientRow(remoteClient);
        setClient(remoteClient);
      }
    }
    function onVisible() {
      if (!document.hidden && Date.now() - lastSync > 5 * 60 * 1000) resync();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase]);

  // El tema (y el modo claro/oscuro de Bootstrap) se aplica a <html>
  useEffect(() => {
    if (phase === 'locked') {
      document.documentElement.dataset.bsTheme = 'light';
      document.documentElement.dataset.theme = 'light';
    } else if (phase === 'portal') {
      document.documentElement.dataset.bsTheme = theme === 'night' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
    }
  }, [phase, theme]);

  // El título de la pestaña: con varias ventanas abiertas, dice de qué empresa es el portal
  useEffect(() => {
    document.title = `${branding?.companyName || config.companyName} · ${t('portal.header.subtitle')}`;
  }, [branding, t, i18n.language]);

  // "Tu repartidor": se vuelve a pedir cada vez que cambia la dirección activa O la ruta de…
  const activeRouteId = client?.addresses?.find((a) => a.id === client.activeAddressId)?.routeId || '';
  const driver = client?.id && activeRouteId ? fetchedDriver : null;
  useEffect(() => {
    if (!client?.id || !activeRouteId) return;
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

  // onLocalUpdateOnly=true: el cambio ya se guardó server-side por otro camino (ver…
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

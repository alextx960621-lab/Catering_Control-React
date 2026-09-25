import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { dbGet, dbSet, dbGetClientRows, dbGetFields, dbSetFields, dbUpsertClientRows, dbDeleteClientRows, dbGetNoteRows, dbUpsertNoteRows, dbDeleteNoteRows, dbInsertAuditBulk, dbGetAllDeliveryStatus } from '../services/db';
import { rpc } from '../services/supabaseClient';
import { normalizeClient, normalizeSettings, openRoutes } from '../services/normalize';
import { pendingDaysBefore, leadingNonWorkingDays } from '../services/dispatchHelpers';
import { getWorkViewDate, setWorkViewDate } from '../services/workViewDate';
import { hydrateFromServer as hydrateUserPrefsFromServer, getTheme as getMyTheme } from '../services/userPrefs';
import { cleanupOldProofImages, cleanupOldDeliveryPhotos, findInactiveClientsToDelete } from '../services/dataCleanup';
import { canManage, canManageDelivery } from '../services/panelAuth';

// "Operaciones" son los datos que casi todas las pantallas del Panel necesitan al mismo…
const OperationsContext = createContext(null);

// Por qué existe `confirmed` Si la carga inicial de un campo (drivers, plans, settings…
const BLOCK_FIELDS = ['plans', 'days', 'drivers', 'routes', 'settings', 'staffUsers', 'inventory'];

// Compara dos datos JSON sin importar el orden de las claves
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const isDateText = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
let businessDateFnMissing = false; // la base todavía no tiene get_business_date (falta correr el…

// El "hoy" operativo lo define el servidor: la fecha real en la zona horaria de la empresa…
async function fetchBusinessDate() {
  if (!businessDateFnMissing) {
    const d = await rpc('get_business_date', {});
    if (isDateText(d)) return d.slice(0, 10);
  }
  const calendarDate = await rpc('get_server_date', {});
  if (isDateText(calendarDate)) {
    // Responde get_server_date pero no get_business_date: falta correr el SQL nuevo; mientras…
    businessDateFnMissing = true;
    return calendarDate.slice(0, 10);
  }
  return null;
}

// Si el plan Premium venció, lo baja a Básico solo
function applyPremiumExpiry(settingsIn, refDate) {
  if (settingsIn.plan === 'premium' && settingsIn.premiumUntil && settingsIn.premiumUntil < refDate) {
    return { settings: { ...settingsIn, plan: 'basico', premiumUntil: '' }, settingsChanged: true };
  }
  return { settings: settingsIn, settingsChanged: false };
}

export function OperationsProvider({ children, userId, user, onThemeFromSettings }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [days, setDays] = useState({});
  const [notes, setNotes] = useState([]);
  const [inventory, setInventory] = useState({ items: [], links: [], movements: [] });
  const [settings, setSettings] = useState(normalizeSettings({}));
  const [staffUsers, setStaffUsers] = useState([]);
  // serverToday = el "hoy" operativo del servidor (cambia a la hora de corte)
  const [serverToday, setServerToday] = useState(new Date().toISOString().slice(0, 10));
  // Día que este usuario eligió mirar en Día de trabajo cuando no es el de hoy (por ejemplo…
  const [viewOverride, setViewOverride] = useState(null);
  const [notice, setNoticeState] = useState(null);
  const noticeTimer = useRef(null);
  const booted = useRef(false);
  const confirmed = useRef(Object.fromEntries(BLOCK_FIELDS.map((k) => [k, false])));
  const clientsConfirmed = useRef(false);
  const notesConfirmed = useRef(false);

  useEffect(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (!notice) return;
    noticeTimer.current = setTimeout(() => setNoticeState(null), 4000);
    return () => clearTimeout(noticeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.key]);

  const showNotice = useCallback((text, error = false) => {
    setNoticeState({ text, error, key: Date.now() });
  }, []);

  const notConfirmedNotice = useCallback(() => {
    showNotice(t('panel.common.notConfirmedYet'), true);
  }, [showNotice, t]);

  // Guarda uno o más campos del bloque "clientes" (plans/days) o "personal"…
  const saveClientesFields = useCallback((fields) => {
    if (!Object.keys(fields).every((k) => confirmed.current[k])) { notConfirmedNotice(); return Promise.resolve(false); }
    return dbSetFields('clientes', fields);
  }, [notConfirmedNotice]);

  const savePersonalFields = useCallback((fields) => {
    if (!Object.keys(fields).every((k) => confirmed.current[k])) { notConfirmedNotice(); return Promise.resolve(false); }
    return dbSetFields('personal', fields);
  }, [notConfirmedNotice]);

  // Elegir qué día mirar en Día de trabajo
  const setCurrentDate = useCallback((date) => {
    if (!date || user?.role === 'driver') return;
    const entry = date === serverToday ? null : { date, setOn: serverToday };
    setViewOverride(entry);
    if (userId) setWorkViewDate(userId, entry);
  }, [serverToday, userId, user?.role]);

  // Los días también los puede cerrar solo el servidor: mientras se guarda uno no se pisa con lo que baje del servidor
  const daysRef = useRef(days);
  daysRef.current = days;
  const daysSaving = useRef(0);
  const saveDays = useCallback((newDays) => {
    setDays(newDays);
    daysSaving.current += 1;
    return Promise.resolve(saveClientesFields({ days: newDays })).finally(() => { daysSaving.current -= 1; });
  }, [saveClientesFields]);

  const syncDays = useCallback(async () => {
    if (daysSaving.current || !confirmed.current.days) return;
    const fields = await dbGetFields('clientes', ['days']);
    const remote = fields?.days;
    if (daysSaving.current || !remote || typeof remote !== 'object') return;
    if (sameJson(remote, daysRef.current)) return;
    // Si se cerró un día en otro lado (cierre automático u otra persona) también cambiaron los días consumidos y el inventario
    const cerradoAfuera = Object.keys(remote).some((d) => remote[d]?.processed && !daysRef.current[d]?.processed);
    setDays(remote);
    if (!cerradoAfuera) return;
    const [rows, inv] = await Promise.all([dbGetClientRows(), dbGet('inventario')]);
    if (rows !== null) setClients(rows.map(normalizeClient));
    if (inv !== null) setInventory({ items: inv?.items || [], links: inv?.links || [], movements: inv?.movements || [] });
  }, []);

  // "Hoy" para todas las pantallas: el día operativo, salvo que este usuario haya elegido…
  const currentDate = viewOverride && viewOverride.setOn === serverToday ? viewOverride.date : serverToday;

  // Días anteriores a hoy que nadie procesó
  const pendingDays = useMemo(() => pendingDaysBefore(days, serverToday), [days, serverToday]);

  // Los días no laborables que vienen seguidos después del último procesado se cierran solos…
  const canCloseDays = canManage(user?.role, settings.customRoles, 'dispatch');
  useEffect(() => {
    if (loading || !confirmed.current.days || !canCloseDays) return;
    const toClose = leadingNonWorkingDays(days, serverToday);
    if (!toClose.length) return;
    const patched = { ...days };
    toClose.forEach((d) => { patched[d] = { ...patched[d], processed: true, processedClientIds: [], payrollSnapshot: [] }; });
    saveDays(patched);
  }, [loading, days, serverToday, canCloseDays, saveDays]);

  // El día operativo puede cambiar con el Panel abierto (pasa la hora de corte): se vuelve a…
  const syncToday = useCallback(async () => {
    const d = await fetchBusinessDate();
    if (d) setServerToday((prev) => (prev === d ? prev : d));
  }, []);
  useEffect(() => {
    if (loading) return undefined;
    const tick = () => { if (!document.hidden) { syncToday(); syncDays(); } };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [loading, syncToday, syncDays]);

  // Sube SOLO los clientes de la lista que cambiaron (identificados por id) -- evita mandar…
  const saveClients = useCallback((updatedClients) => {
    if (!clientsConfirmed.current) { notConfirmedNotice(); return Promise.resolve(false); }
    setClients((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      updatedClients.forEach((c) => byId.set(c.id, c));
      return [...byId.values()];
    });
    return dbUpsertClientRows(updatedClients);
  }, [notConfirmedNotice]);

  const saveNotes = useCallback((updatedNotes) => {
    if (!notesConfirmed.current) { notConfirmedNotice(); return Promise.resolve(false); }
    setNotes((prev) => {
      const byId = new Map(prev.map((nt) => [nt.id, nt]));
      updatedNotes.forEach((nt) => byId.set(nt.id, nt));
      return [...byId.values()];
    });
    return dbUpsertNoteRows(updatedNotes);
  }, [notConfirmedNotice]);

  const deleteNote = useCallback((id) => {
    if (!notesConfirmed.current) { notConfirmedNotice(); return Promise.resolve(false); }
    setNotes((prev) => prev.filter((nt) => nt.id !== id));
    return dbDeleteNoteRows([id]);
  }, [notConfirmedNotice]);

  // Solo notas, sin avisos ni recargar todo: así el editor ve el aviso nuevo de un chofer sin…
  // tener que tocar "Actualizar" (ver NotesPage).
  const refreshNotes = useCallback(async () => {
    const noteRows = await dbGetNoteRows();
    if (noteRows === null) return false;
    setNotes(noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt })));
    notesConfirmed.current = true;
    return true;
  }, []);

  const deleteClients = useCallback((ids) => {
    if (!clientsConfirmed.current) { notConfirmedNotice(); return Promise.resolve(false); }
    setClients((prev) => prev.filter((c) => !ids.includes(c.id)));
    return dbDeleteClientRows(ids);
  }, [notConfirmedNotice]);

  // Reglas de retención de datos (ver services/dataCleanup.js): comprobantes de pago y fotos…
  const runDataCleanup = useCallback(async ({ clientsList, notesList, daysMap, refDate, customRoles }) => {
    const role = user?.role;
    try {
      if (canManage(role, customRoles, 'notes')) {
        const updatedNotes = cleanupOldProofImages(notesList);
        if (updatedNotes?.length) {
          const ok = await saveNotes(updatedNotes);
          if (!ok) console.warn('[limpieza] No se pudo guardar la limpieza de comprobantes de pago vencidos.');
        }
      }
    } catch (err) {
      console.warn('[limpieza] Error limpiando comprobantes de pago vencidos:', err);
    }

    const needsDeliveryHistory = canManageDelivery(role, customRoles) || (canManage(role, customRoles, 'clients') && refDate);
    let deliveryHistory = null;
    if (needsDeliveryHistory) {
      try {
        deliveryHistory = await dbGetAllDeliveryStatus(null);
      } catch (err) {
        console.warn('[limpieza] No se pudo traer el historial de entregas para la limpieza automática:', err);
      }
    }

    try {
      if (canManageDelivery(role, customRoles)) await cleanupOldDeliveryPhotos(deliveryHistory);
    } catch (err) {
      console.warn('[limpieza] Error limpiando fotos de entrega vencidas:', err);
    }

    try {
      if (canManage(role, customRoles, 'clients') && refDate) {
        const toDelete = await findInactiveClientsToDelete(clientsList, daysMap, refDate, deliveryHistory);
        if (toDelete.length) {
          const ok = await deleteClients(toDelete.map((c) => c.id));
          if (ok) {
            await dbInsertAuditBulk(toDelete.map((c) => ({
              actor_id: user?.id, actor_name: user?.name, actor_role: user?.role,
              action: 'Cliente eliminado automáticamente', entity_type: 'client', entity_label: c.name, entity_id: c.id,
              details: { motivo: '2 años sin entregas ni renovación de plan (Retorno pendiente)' },
            })));
          } else {
            console.warn('[limpieza] No se pudo borrar automáticamente a los clientes inactivos.');
          }
        }
      }
    } catch (err) {
      console.warn('[limpieza] Error borrando clientes inactivos:', err);
    }
  }, [user, saveNotes, deleteClients]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const [clientRows, clientesFields, personalFields, businessDate, noteRows, inventoryBlock] = await Promise.all([
        dbGetClientRows(),
        dbGetFields('clientes', ['plans', 'days']),
        dbGetFields('personal', ['drivers', 'routes', 'settings', 'staffUsers', 'userPrefs']),
        fetchBusinessDate(),
        dbGetNoteRows(),
        dbGet('inventario'),
      ]);

      // null = la llamada falló de verdad
      if (clientRows !== null) { setClients(clientRows.map(normalizeClient)); clientsConfirmed.current = true; }
      if (noteRows !== null) { setNotes(noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt }))); notesConfirmed.current = true; }
      if (inventoryBlock !== null) { setInventory({ items: inventoryBlock?.items || [], links: inventoryBlock?.links || [], movements: inventoryBlock?.movements || [] }); confirmed.current.inventory = true; }
      const normalizedClients = clientRows !== null ? clientRows.map(normalizeClient) : null;
      const normalizedNotes = noteRows !== null ? noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt })) : null;
      const days = clientesFields?.days || {};
      let settingsNormalized = normalizeSettings(personalFields?.settings);

      if (clientesFields !== null) {
        setPlans(clientesFields.plans || []);
        confirmed.current.plans = true;
        confirmed.current.days = true;
      }

      if (personalFields !== null) {
        setDrivers(personalFields.drivers || []);
        setRoutes(personalFields.routes?.length ? personalFields.routes : openRoutes());
        setStaffUsers(personalFields.staffUsers || []);
        // Preferencias PERSONALES (tema + columnas): se confirman con el servidor acá…
        if (userId) hydrateUserPrefsFromServer(userId, personalFields.userPrefs?.[userId]);
        const myTheme = userId ? getMyTheme(userId) : null;
        if (myTheme) onThemeFromSettings?.(myTheme);
        else if (personalFields.settings?.theme) onThemeFromSettings?.(personalFields.settings.theme);
        confirmed.current.drivers = true;
        confirmed.current.routes = true;
        confirmed.current.settings = true;
        confirmed.current.staffUsers = true;
      } else {
        // Sin esto no hay ni rutas ni drivers reales: al menos deja la ruta abierta para que la app…
        setRoutes(openRoutes());
      }

      const refDate = businessDate;
      if (refDate) {
        setServerToday(refDate);
        if (userId && user?.role !== 'driver') {
          const savedView = getWorkViewDate(userId, refDate);
          if (savedView) setViewOverride(savedView);
        }
      }

      // El vencimiento de Premium solo se aplica si la configuración y la fecha del servidor se…
      if (personalFields !== null && refDate) {
        const fixed = applyPremiumExpiry(settingsNormalized, refDate);
        settingsNormalized = fixed.settings;
        if (fixed.settingsChanged) dbSetFields('personal', { settings: settingsNormalized });
      }
      setDays(days);
      setSettings(settingsNormalized);

      const anyFailed = clientRows === null || noteRows === null || inventoryBlock === null || clientesFields === null || personalFields === null;
      if (anyFailed) showNotice(t('panel.common.syncIncomplete'), true);

      // Nunca se espera (sin await): no debe demorar el arranque normal de la app por la vuelta…
      if (normalizedClients !== null && normalizedNotes !== null) {
        runDataCleanup({ clientsList: normalizedClients, notesList: normalizedNotes, daysMap: days, refDate, customRoles: settingsNormalized.customRoles });
      }

      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveInventory = useCallback((inv) => {
    if (!confirmed.current.inventory) { notConfirmedNotice(); return Promise.resolve(false); }
    setInventory(inv);
    return dbSet('inventario', inv);
  }, [notConfirmedNotice]);

  // Trae todo de nuevo desde el servidor (botón "Actualizar" del menú)
  const refreshAll = useCallback(async () => {
    const [clientRows, clientesFields, personalFields, businessDate, noteRows, inventoryBlock] = await Promise.all([
      dbGetClientRows(),
      dbGetFields('clientes', ['plans', 'days']),
      dbGetFields('personal', ['drivers', 'routes', 'settings', 'staffUsers']),
      fetchBusinessDate(),
      dbGetNoteRows(),
      dbGet('inventario'),
    ]);
    if (clientRows !== null) { setClients(clientRows.map(normalizeClient)); clientsConfirmed.current = true; }
    if (noteRows !== null) { setNotes(noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt }))); notesConfirmed.current = true; }
    if (inventoryBlock !== null) { setInventory({ items: inventoryBlock?.items || [], links: inventoryBlock?.links || [], movements: inventoryBlock?.movements || [] }); confirmed.current.inventory = true; }
    const normalizedClients = clientRows !== null ? clientRows.map(normalizeClient) : null;
    const normalizedNotes = noteRows !== null ? noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt })) : null;
    let refreshedDays = null;
    let refreshedCustomRoles = null;
    if (clientesFields !== null) {
      setPlans(clientesFields.plans || []);
      setDays(clientesFields.days || {});
      refreshedDays = clientesFields.days || {};
      confirmed.current.plans = true; confirmed.current.days = true;
    }
    if (personalFields !== null) {
      setDrivers(personalFields.drivers || []);
      if (personalFields.routes?.length) setRoutes(personalFields.routes);
      const normalizedSettings = normalizeSettings(personalFields.settings);
      setSettings(normalizedSettings);
      refreshedCustomRoles = normalizedSettings.customRoles;
      setStaffUsers(personalFields.staffUsers || []);
      confirmed.current.drivers = true; confirmed.current.routes = true; confirmed.current.settings = true; confirmed.current.staffUsers = true;
    }
    const refreshedDate = businessDate;
    if (refreshedDate) setServerToday(refreshedDate);
    const anyFailed = clientRows === null || noteRows === null || inventoryBlock === null || clientesFields === null || personalFields === null;
    showNotice(anyFailed ? t('panel.common.syncFailed') : t('panel.common.dataUpdated'), anyFailed);
    if (normalizedClients !== null && normalizedNotes !== null && clientesFields !== null && personalFields !== null && refreshedDate) {
      // Ojo: refreshAll está memoizada con deps=[showNotice] (fijas), así que NO puede confiar en…
      runDataCleanup({ clientsList: normalizedClients, notesList: normalizedNotes, daysMap: refreshedDays, refDate: refreshedDate, customRoles: refreshedCustomRoles || [] });
    }
    return !anyFailed;
  }, [showNotice, runDataCleanup, t]);

  const value = {
    loading, clients, routes, drivers, plans, days, notes, inventory, currentDate, settings, staffUsers, serverToday, pendingDays, notice, showNotice, refreshAll, syncToday,
    setCurrentDate, saveDays, saveClients, deleteClients, saveNotes, deleteNote, refreshNotes, saveInventory,
    saveStaffUsers: (u) => { setStaffUsers(u); return savePersonalFields({ staffUsers: u }); },
    saveSettings: (s) => { setSettings(s); return savePersonalFields({ settings: s }); },
    saveRoutes: (r) => { setRoutes(r); return savePersonalFields({ routes: r }); },
    saveDrivers: (d) => { setDrivers(d); return savePersonalFields({ drivers: d }); },
    savePlans: (p) => { setPlans(p); return saveClientesFields({ plans: p }); },
  };

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error('useOperations() tiene que usarse dentro de <OperationsProvider>');
  return ctx;
}

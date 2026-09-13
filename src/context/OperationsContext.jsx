import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { dbGet, dbSet, dbGetClientRows, dbGetFields, dbSetFields, dbUpsertClientRows, dbDeleteClientRows, dbGetNoteRows, dbUpsertNoteRows, dbDeleteNoteRows, dbInsertAuditBulk, dbGetAllDeliveryStatus } from '../services/db';
import { rpc } from '../services/supabaseClient';
import { DEFAULT_MENU_ITEMS, addDays } from '../services/planHelpers';
import { lastProcessedDate } from '../services/dispatchHelpers';
import { hydrateFromServer as hydrateUserPrefsFromServer, getTheme as getMyTheme } from '../services/userPrefs';
import { cleanupOldProofImages, cleanupOldDeliveryPhotos, findInactiveClientsToDelete } from '../services/dataCleanup';
import { canManage, canManageDelivery } from '../services/panelAuth';

// "Operaciones" son los datos que casi todas las pantallas del Panel
// necesitan al mismo tiempo: clientes, rutas, drivers, planes, el
// calendario de días laborables/procesados, y la configuración general.
// Se cargan UNA VEZ acá (no en cada pantalla) y se comparten por Contexto,
// igual que el objeto `state` global que tenía panel.html, pero
// reaccionando a cambios como corresponde en React.
const OperationsContext = createContext(null);

function normalizeClient(c) {
  c.items ||= {};
  c.order ??= '';
  c.status ||= 'Activo';
  c.paidDays ??= 0;
  c.consumedDays ??= 0;
  if (c.status !== 'Programado' && c.returnDate) c.returnDate = '';
  if (!Array.isArray(c.addresses) || !c.addresses.length) {
    c.addresses = c.address1
      ? [{ id: 'a_' + c.id, address: c.address1, maps: c.maps || '', routeId: c.routeId || '', driverId: c.driverId || '', order: c.order ?? '' }]
      : [];
    c.activeAddressId = c.addresses[0]?.id || '';
  }
  c.addressOverrides ||= [];
  c.schedule ||= [];
  return c;
}

function normalizeSettings(settings) {
  const s = settings || {};
  s.theme ||= 'light';
  s.menuItems = Array.isArray(s.menuItems) && s.menuItems.length ? s.menuItems : DEFAULT_MENU_ITEMS.map(([key, label]) => ({ key, label }));
  s.customRoles = Array.isArray(s.customRoles) ? s.customRoles : [];
  s.plan = s.plan === 'premium' ? 'premium' : 'basico';
  s.premiumLockedPages ||= {};
  s.hiddenColumns ||= [];
  s.dispatchColumnOrder ||= [];
  s.premiumWhatsapp ||= '';
  s.paymentQrUrl ||= '';
  return s;
}

// ----------------------------------------------------------------------
// Por qué existe `confirmed`
// ----------------------------------------------------------------------
// Si la carga inicial de un campo (drivers, plans, settings, etc.) falla
// por un problema de red, NO hay que guardar nada de ese campo hasta que
// se confirme con éxito contra el servidor -- ni siquiera lo que ya
// estaba en pantalla. Si se guardara igual, se subiría el valor "vacío"
// o "por defecto" con el que arrancó React, pisando los datos reales que
// tiene el servidor para TODO el equipo, sin ningún aviso (no pasa por
// Auditoría). Por eso cada campo se marca como "confirmado" recién
// cuando la carga inicial responde bien -- y toda función de guardado se
// niega a subir nada si su campo todavía no fue confirmado.
const BLOCK_FIELDS = ['plans', 'days', 'currentDate', 'drivers', 'routes', 'settings', 'staffUsers', 'inventory'];

export function OperationsProvider({ children, userId, user, onThemeFromSettings }) {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [days, setDays] = useState({});
  const [notes, setNotes] = useState([]);
  const [inventory, setInventory] = useState({ items: [], links: [], movements: [] });
  const [currentDate, setCurrentDateState] = useState(new Date().toISOString().slice(0, 10));
  const [settings, setSettings] = useState(normalizeSettings({}));
  const [staffUsers, setStaffUsers] = useState([]);
  const [serverToday, setServerToday] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNoticeState] = useState(null); // { text, error }
  const booted = useRef(false);
  const confirmed = useRef(Object.fromEntries(BLOCK_FIELDS.map((k) => [k, false])));
  const clientsConfirmed = useRef(false);
  const notesConfirmed = useRef(false);

  const showNotice = useCallback((text, error = false) => {
    setNoticeState({ text, error, key: Date.now() });
  }, []);

  const notConfirmedNotice = useCallback(() => {
    showNotice('No se pudo guardar: este dato todavía no se confirmó con la base de datos. Recargá la página e intentá de nuevo.', true);
  }, [showNotice]);

  // Si el plan Premium venció, lo baja a Básico solo. Si el negocio se
  // saltó días sin abrir la app, los cierra solos como "sin actividad"
  // (sin tocar inventario ni días consumidos) para que lastProcessedDate()
  // no quede atascada en el pasado bloqueando la fecha de trabajo.
  function applyBackfillAndPremiumExpiry(daysIn, settingsIn, refDate) {
    let settingsOut = settingsIn;
    if (settingsIn.plan === 'premium' && settingsIn.premiumUntil && settingsIn.premiumUntil < refDate) {
      settingsOut = { ...settingsIn, plan: 'basico', premiumUntil: '' };
    }
    let daysOut = daysIn;
    const last = lastProcessedDate(daysIn);
    if (last) {
      let d = addDays(last, 1);
      let changed = false;
      const patched = { ...daysIn };
      let guard = 0;
      while (d < refDate && guard++ < 400) {
        if (!patched[d]?.processed) { patched[d] = { ...(patched[d] || { laborable: true }), processed: true, processedClientIds: [] }; changed = true; }
        d = addDays(d, 1);
      }
      if (changed) daysOut = patched;
    }
    return { settings: settingsOut, settingsChanged: settingsOut !== settingsIn, days: daysOut, daysChanged: daysOut !== daysIn };
  }


  // Guarda uno o más campos del bloque "clientes" (plans/days/currentDate)
  // o "personal" (drivers/routes/settings/staffUsers) -- solo lo que
  // cambió, no todo el bloque, para no pisar cambios de otra persona
  // usando el Panel al mismo tiempo. `fields` es un objeto { clave:
  // valor }; TODAS sus claves tienen que estar confirmadas o no se
  // guarda nada (evita guardar una mezcla de campo confirmado + campo
  // no confirmado en la misma llamada).
  const saveClientesFields = useCallback((fields) => {
    if (!Object.keys(fields).every((k) => confirmed.current[k])) { notConfirmedNotice(); return Promise.resolve(false); }
    return dbSetFields('clientes', fields);
  }, [notConfirmedNotice]);

  const savePersonalFields = useCallback((fields) => {
    if (!Object.keys(fields).every((k) => confirmed.current[k])) { notConfirmedNotice(); return Promise.resolve(false); }
    return dbSetFields('personal', fields);
  }, [notConfirmedNotice]);

  const setCurrentDate = useCallback((date) => {
    setCurrentDateState(date);
    saveClientesFields({ currentDate: date });
  }, [saveClientesFields]);

  const saveDays = useCallback((newDays) => {
    setDays(newDays);
    return saveClientesFields({ days: newDays });
  }, [saveClientesFields]);

  // Sube SOLO los clientes de la lista que cambiaron (identificados por
  // id) -- evita mandar los miles de clientes enteros por cada tecla.
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

  const deleteClients = useCallback((ids) => {
    if (!clientsConfirmed.current) { notConfirmedNotice(); return Promise.resolve(false); }
    setClients((prev) => prev.filter((c) => !ids.includes(c.id)));
    return dbDeleteClientRows(ids);
  }, [notConfirmedNotice]);

  // Reglas de retención de datos (ver services/dataCleanup.js): comprobantes
  // de pago y fotos de entrega de más de 7 días, y clientes sin actividad
  // hace 2 años. Corre sola al cargar el Panel y cada vez que se toca
  // "Actualizar" -- nadie tiene que acordarse de hacerlo a mano, e
  // igual que en la vanilla (panel.html), cada rutina se salta sola si
  // el rol de quien está logueado no tiene permiso de editar esa
  // pantalla (un driver, por ejemplo, no dispara el borrado de
  // clientes). Nunca debe poder romper la carga normal de la app --
  // por eso cada parte tiene su propio try/catch, y nunca se espera
  // (await) desde quien la llama.
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

    // Antes cleanupOldDeliveryPhotos() y findInactiveClientsToDelete()
    // pedían CADA UNA por su lado todo el historial de
    // db_delivery_status -- si las 2 corrían (alguien con permiso de
    // Despacho Y de Clientes), se pedía 2 veces seguidas exactamente lo
    // mismo. Ahora se pide una sola vez acá y se comparte con las 2.
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
      const [clientRows, clientesFields, personalFields, srvDate, noteRows, inventoryBlock] = await Promise.all([
        dbGetClientRows(),
        dbGetFields('clientes', ['plans', 'days', 'currentDate']),
        dbGetFields('personal', ['drivers', 'routes', 'settings', 'staffUsers', 'userPrefs']),
        rpc('get_server_date', {}),
        dbGetNoteRows(),
        dbGet('inventario'),
      ]);

      // null = la llamada falló de verdad. Si falló, NO se toca el
      // estado (se queda con los valores por defecto en memoria) y NO se
      // marca como confirmado -- así ningún saveX() de ese campo va a
      // subir nada hasta que se recargue con éxito.
      if (clientRows !== null) { setClients(clientRows.map(normalizeClient)); clientsConfirmed.current = true; }
      if (noteRows !== null) { setNotes(noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt }))); notesConfirmed.current = true; }
      if (inventoryBlock !== null) { setInventory({ items: inventoryBlock?.items || [], links: inventoryBlock?.links || [], movements: inventoryBlock?.movements || [] }); confirmed.current.inventory = true; }
      const normalizedClients = clientRows !== null ? clientRows.map(normalizeClient) : null;
      const normalizedNotes = noteRows !== null ? noteRows.map((nt) => ({ status: 'pendiente', dueDate: new Date().toISOString().slice(0, 10), source: 'staff', ...nt })) : null;
      let days = clientesFields?.days || {};
      let settingsNormalized = normalizeSettings(personalFields?.settings);

      if (clientesFields !== null) {
        setPlans(clientesFields.plans || []);
        if (clientesFields.currentDate) setCurrentDateState(clientesFields.currentDate);
        confirmed.current.plans = true;
        confirmed.current.days = true;
        confirmed.current.currentDate = true;
      }

      if (personalFields !== null) {
        setDrivers(personalFields.drivers || []);
        setRoutes(personalFields.routes?.length ? personalFields.routes : [{ id: 'r_open', name: 'Ruta abierta', description: 'Drivers disponibles sin ruta de trabajo', open: true, order: 0 }]);
        setStaffUsers(personalFields.staffUsers || []);
        // Preferencias PERSONALES (tema + columnas): se confirman con el
        // servidor acá (hydrateFromServer), lo que además habilita que de
        // ahora en más los cambios de este usuario se empiecen a
        // sincronizar (ver services/userPrefs.js). El tema propio, si
        // existe, tiene prioridad sobre el tema de empresa (settings.theme,
        // que sigue siendo el default para quien nunca eligió uno propio).
        if (userId) hydrateUserPrefsFromServer(userId, personalFields.userPrefs?.[userId]);
        const myTheme = userId ? getMyTheme(userId) : null;
        if (myTheme) onThemeFromSettings?.(myTheme);
        else if (personalFields.settings?.theme) onThemeFromSettings?.(personalFields.settings.theme);
        confirmed.current.drivers = true;
        confirmed.current.routes = true;
        confirmed.current.settings = true;
        confirmed.current.staffUsers = true;
      } else {
        // Sin esto no hay ni rutas ni drivers reales: al menos deja la
        // ruta abierta para que la app no se vea completamente vacía,
        // aunque esto NUNCA se guarda (confirmed.routes sigue en false).
        setRoutes([{ id: 'r_open', name: 'Ruta abierta', description: 'Drivers disponibles sin ruta de trabajo', open: true, order: 0 }]);
      }

      let refDate = null;
      if (typeof srvDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(srvDate)) { refDate = srvDate.slice(0, 10); setServerToday(refDate); }

      // El backfill/vencimiento de Premium solo se aplica si los dos
      // bloques de los que depende (días y configuración) y la fecha del
      // servidor se confirmaron -- si algo de eso falló, mejor no tocar
      // nada a ciegas.
      if (clientesFields !== null && personalFields !== null && refDate) {
        const fixed = applyBackfillAndPremiumExpiry(days, settingsNormalized, refDate);
        days = fixed.days;
        settingsNormalized = fixed.settings;
        if (fixed.daysChanged) dbSetFields('clientes', { days });
        if (fixed.settingsChanged) dbSetFields('personal', { settings: settingsNormalized });
      }
      setDays(days);
      setSettings(settingsNormalized);

      const anyFailed = clientRows === null || noteRows === null || inventoryBlock === null || clientesFields === null || personalFields === null;
      if (anyFailed) showNotice('No se pudo sincronizar todo con la base de datos. Algunos cambios no se guardarán hasta reconectar (recargá la página).', true);

      // Nunca se espera (sin await): no debe demorar el arranque normal
      // de la app por la vuelta de red a Storage/Nominatim/etc.
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

  // Trae todo de nuevo desde el servidor (botón "Actualizar" del menú).
  // Usa la misma lógica que el arranque: si algo falla, no pisa lo que
  // ya está en pantalla y avisa en vez de fallar en silencio.
  const refreshAll = useCallback(async () => {
    const [clientRows, clientesFields, personalFields, srvDate, noteRows, inventoryBlock] = await Promise.all([
      dbGetClientRows(),
      dbGetFields('clientes', ['plans', 'days', 'currentDate']),
      dbGetFields('personal', ['drivers', 'routes', 'settings', 'staffUsers']),
      rpc('get_server_date', {}),
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
      if (clientesFields.currentDate) setCurrentDateState(clientesFields.currentDate);
      confirmed.current.plans = true; confirmed.current.days = true; confirmed.current.currentDate = true;
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
    let refreshedDate = null;
    if (typeof srvDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(srvDate)) { refreshedDate = srvDate.slice(0, 10); setServerToday(refreshedDate); }
    const anyFailed = clientRows === null || noteRows === null || inventoryBlock === null || clientesFields === null || personalFields === null;
    showNotice(anyFailed ? 'No se pudo sincronizar todo. Revisa tu internet e intenta de nuevo.' : 'Datos actualizados.', anyFailed);
    if (normalizedClients !== null && normalizedNotes !== null && clientesFields !== null && personalFields !== null && refreshedDate) {
      // Ojo: refreshAll está memoizada con deps=[showNotice] (fijas), así
      // que NO puede confiar en las variables de estado (days/settings/
      // serverToday) para nada que dependa del valor más reciente -- ese
      // closure quedaría pegado para siempre al primer render. Por eso
      // solo se corre la limpieza automática cuando ESTE refresh trajo
      // los 3 datos que necesita de cero (clientesFields, personalFields
      // y la fecha del servidor), nunca mezclando con el estado viejo.
      runDataCleanup({ clientsList: normalizedClients, notesList: normalizedNotes, daysMap: refreshedDays, refDate: refreshedDate, customRoles: refreshedCustomRoles || [] });
    }
    return !anyFailed;
  }, [showNotice, runDataCleanup]);

  const value = {
    loading, clients, routes, drivers, plans, days, notes, inventory, currentDate, settings, staffUsers, serverToday, notice, showNotice, refreshAll,
    setCurrentDate, saveDays, saveClients, deleteClients, saveNotes, deleteNote, saveInventory,
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

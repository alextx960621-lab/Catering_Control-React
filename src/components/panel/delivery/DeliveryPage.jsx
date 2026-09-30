import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { dbGetDeliveryRows, dbUpsertDeliveryRows, storageUploadImage } from '../../../services/db';
import { removeStoredImage } from '../../../services/imageUpload';
import { isOnline, loadDaySnapshot, saveDaySnapshot, queueMark, listQueuedMarks, removeQueuedMarks, loadLocalPhoto, removeLocalPhoto } from '../../../services/offlineDay';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveOrder, effectiveAddress, dispatchStatus, myRouteIds, driverForRoute } from '../../../services/dispatchHelpers';
import { canManageDelivery } from '../../../services/panelAuth';
import Modal from '../Modal';
import DataTable from '../DataTable';
import RouteMapModal from './RouteMapModal';
import ImageField from '../ImageField';
import StoredImage from '../StoredImage';
import { fmtDate } from '../panelUtils';

// Estado de las entregas del día: quién fue marcado entregado/no entregado, con motivo/foto…
export default function DeliveryPage({ user }) {
  const { t } = useTranslation();
  const { clients, routes, drivers, days, currentDate, settings, showNotice, saveClients } = useOperations();
  const [records, setRecords] = useState([]);
  // Marcas hechas sin señal que aún esperan sincronía; se montan sobre lo que vino del servidor.
  const [pending, setPending] = useState([]);
  const [cachedDay, setCachedDay] = useState(null); // { clients, records } guardado en el teléfono
  const [online, setOnline] = useState(isOnline());
  const [marking, setMarking] = useState(null);
  const [viewing, setViewing] = useState(null); // client (para el detalle)
  const [mapRouteId, setMapRouteId] = useState(null);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const pollRef = useRef(null);
  const syncingRef = useRef(false);
  // El poll vive en un closure del arranque: sin ref, "hay un modal abierto" se lee siempre como no.
  const modalAbiertoRef = useRef(false);
  modalAbiertoRef.current = !!(marking || viewing);

  const isDriver = user?.role === 'driver';
  const canEdit = canManageDelivery(user?.role, settings.customRoles);
  const date = currentDate;
  const dayInfo = days[date] || { laborable: true };
  const myRoutes = useMemo(() => myRouteIds(user, drivers), [user, drivers]);

  async function load() {
    const rows = await dbGetDeliveryRows(date);
    if (rows) {
      setRecords(rows);
    } else if (user?.id) {
      // Sin respuesta del servidor: la única cara que se le puede mostrar al chofer es la copia que
      // IndexedDB guardó la última vez que hubo señal.
      const snap = await loadDaySnapshot(user.id, date);
      if (snap) { setCachedDay(snap); setRecords(snap.records); }
    }
    setLoadingRecords(false);
  }

  async function refreshPending() {
    if (!user?.id) return;
    setPending(await listQueuedMarks(user.id, date));
  }

  // Recupera señal → sincronía inmediata; la pérdida de señal se refleja en el banner.
  useEffect(() => {
    const onOnline = () => { setOnline(true); load(); syncPending(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, user?.id]);

  useEffect(() => {
    refreshPending();
    load();
    pollRef.current = setInterval(() => {
      if (document.hidden || modalAbiertoRef.current) return;
      // navigator.onLine miente a favor (red cautiva), así que el intento real es el propio load().
      if (isOnline()) { load(); syncPending(); } else setOnline(false);
    }, 12000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, user?.id]);

  // La copia del día se refresca desde un effect con los datos vivos: el poll congela el closure de
  // `clients`, y en el arranque ese array todavía está vacío (guardaría una copia vacía).
  useEffect(() => {
    if (!isDriver || !user?.id || !isOnline()) return;
    const list = listForRoutes(myRoutes);
    // Solo se sobreescribe con una lista real: sin clientes en memoria la copia buena se perdería.
    if (list.length) saveDaySnapshot(user.id, date, { clients: list, records });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, records, routes, days, myRoutes, isDriver, user?.id, date]);

  // Sube las marcas en cola, en el orden en que se hicieron, junto con sus fotos locales.
  async function syncPending() {
    if (!user?.id || syncingRef.current || !isOnline()) return;
    const marks = await listQueuedMarks(user.id, date);
    if (!marks.length) { setPending([]); return; }
    syncingRef.current = true;
    const done = [];
    let fallo = false;
    try {
      for (const m of marks) {
        const payload = { ...m.payload };
        if (payload.image && !/^https?:/i.test(payload.image)) {
          const blob = await loadLocalPhoto(payload.image);
          // Sin blob local la ruta ya está en Storage: se cayó la marca, no la foto.
          if (blob) {
            const subido = await storageUploadImage(payload.image, blob, 'image/jpeg');
            if (!subido) { fallo = true; break; }
            removeLocalPhoto(payload.image);
            payload.image = subido;
          }
        }
        const ok = await dbUpsertDeliveryRows([{ date, clientId: m.clientId, payload }]);
        if (!ok) { fallo = true; break; } // la señal se volvió a caer: se reintenta en el próximo tick
        done.push(m.key);
      }
    } finally {
      syncingRef.current = false;
    }
    if (done.length) {
      await removeQueuedMarks(done);
      await load();
    }
    setPending(await listQueuedMarks(user.id, date));
    if (done.length) showNotice(t('panel.delivery.offlineSynced', { count: done.length }));
    else if (fallo) showNotice(t('panel.delivery.offlineSyncFailed'), true);
  }

  function recordFor(clientId) {
    const local = pending.find((m) => m.clientId === clientId);
    if (local) return { clientId, ...local.payload, offlinePending: true };
    return records.find((r) => r.clientId === clientId) || null;
  }

  // "No entregado" por falla del personal no descuenta el día de servicio (la carrera sí se paga)
  function faultText(rec) {
    if (rec?.status !== 'no_entregado') return '';
    if (rec.fault === 'cliente') return t('panel.delivery.faultClient');
    if (rec.fault === 'personal') return t('panel.delivery.faultStaff');
    return t('panel.delivery.faultUnset');
  }

  function faultHint(rec) {
    if (rec?.fault === 'personal') return t('panel.delivery.faultStaffHint');
    if (rec?.fault === 'cliente') return t('panel.delivery.faultClientHint');
    return t('panel.delivery.faultUnsetHint');
  }

  function routeName(id) { return routes.find((r) => r.id === id)?.name || t('panel.delivery.noRoute'); }

  function listForRoutes(routeIds) {
    const ids = Array.isArray(routeIds) ? routeIds : [routeIds];
    return clients
      .filter((c) => ids.includes(effectiveRouteId(c, date)) && dispatchStatus(c, date, dayInfo) === 'Activo')
      .sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999) || a.name.localeCompare(b.name));
  }

  async function saveRecord(clientId, payload) {
    const record = { clientId, ...payload };
    setRecords((prev) => {
      const list = [...prev];
      const idx = list.findIndex((r) => r.clientId === clientId);
      if (idx >= 0) list[idx] = record; else list.push(record);
      return list;
    });
    if (isOnline()) {
      const ok = await dbUpsertDeliveryRows([{ date, clientId, payload }]);
      if (ok) return true;
      // Se cayó la red a mitad del reparto: el dato no se pierde, pasa a la cola del teléfono.
    }
    await queueMark({ userId: user?.id, date, clientId, payload });
    setPending(await listQueuedMarks(user?.id, date));
    showNotice(t('panel.delivery.offlineQueued'));
    return true;
  }

  async function handleMarkSubmit(form, photoUrl) {
    const { client, kind } = marking;
    if (dayInfo.processed) { showNotice(t('panel.delivery.dayProcessedNoMark'), true); return false; }
    const data = Object.fromEntries(new FormData(form));
    const reason = (data.reason || '').trim();
    // El chofer no clasifica la falla: conserva la decisión que ya haya tomado un editor en Avisos
    const fault = kind === 'no_entregado' ? (recordFor(client.id)?.fault || '') : '';
    if (kind === 'no_entregado' && !reason) return false;
    const payload = { status: kind, reason: kind === 'no_entregado' ? reason : '', fault, note: (data.note || '').trim(), image: photoUrl || '', at: new Date().toISOString(), by: user?.name };
    const ok = await saveRecord(client.id, payload);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: kind === 'no_entregado' ? 'Pedido marcado no entregado' : 'Pedido marcado entregado', entity_type: 'delivery', entity_label: client.name, entity_id: client.id, details: { fecha: date, motivo: payload.reason || undefined, responsable: fault || (kind === 'no_entregado' ? 'sin clasificar' : undefined) } });
    if (!ok) return false;
  }

  async function clearRecord(client) {
    if (dayInfo.processed) { showNotice(t('panel.delivery.dayProcessedNoModify'), true); return; }
    if (!confirm(t('panel.delivery.confirmClearMark'))) return;
    // La foto de respaldo pierde sentido al quitar la marca: si no se borra queda huérfana en Storage
    removeStoredImage(recordFor(client.id)?.image);
    await saveRecord(client.id, { status: 'pendiente', reason: '', fault: '', note: '', image: '', at: new Date().toISOString(), by: user?.name });
    setViewing(null);
  }

  if (loadingRecords) return <p className="muted">{t('panel.delivery.loadingState')}</p>;

  const banner = (!online || pending.length > 0) && (
    <p className={`offline-banner${online ? ' syncing' : ' offline'}`}>
      <span>{online ? t('panel.delivery.offlinePending', { count: pending.length }) : t('panel.delivery.offlineBanner')}</span>
      {!online && cachedDay && <small>· {t('panel.delivery.offlineCached')}</small>}
    </p>
  );

  if (isDriver) {
    const live = listForRoutes(myRoutes);
    // Sin señal no hay clientes en memoria: se muestran las paradas de la copia del teléfono.
    const list = live.length ? live : (cachedDay?.clients || []);
    const delivered = list.filter((c) => recordFor(c.id)?.status === 'entregado').length;
    const columns = [
      { key: 'order', label: t('panel.delivery.order'), render: (c) => n(effectiveOrder(c, date)) || '' },
      { key: 'name', label: t('panel.common.client'), render: (c) => (<><b>{c.name}</b><br /><small className="muted">{effectiveAddress(c, date)}</small></>) },
      ...(myRoutes.length > 1 ? [{ key: 'route', label: t('panel.common.route'), render: (c) => routeName(effectiveRouteId(c, date)) }] : []),
      { key: 'status', label: t('panel.delivery.deliveryStatus'), render: (c) => {
        const rec = recordFor(c.id);
        const st = rec?.status;
        const badge = st === 'entregado' ? <span className="badge active">{t('panel.delivery.delivered')}</span> : st === 'no_entregado' ? <span className="badge danger">{t('panel.delivery.notDelivered')}</span> : <span className="badge off">{t('panel.delivery.pending')}</span>;
        const bits = [rec?.at && new Date(rec.at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }), rec?.reason, rec?.note].filter(Boolean);
        return <>{badge}{rec?.offlinePending && <> <span className="badge warn">{t('panel.delivery.offlineBadge')}</span></>}{bits.length > 0 && <><br /><small className="muted">{bits.join(' · ')}</small></>}</>;
      } },
      { key: 'id', label: t('panel.common.actions'), render: (c) => {
        if (!canEdit) return '—';
        const st = recordFor(c.id)?.status;
        return st === 'entregado' || st === 'no_entregado' ? (
          <><button className="icon-btn info" onClick={() => setMarking({ client: c, kind: st })}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => clearRecord(c)}>{t('panel.delivery.remove')}</button></>
        ) : (
          <><button className="success" onClick={() => setMarking({ client: c, kind: 'entregado' })}>{t('panel.delivery.delivered')}</button> <button className="orange" onClick={() => setMarking({ client: c, kind: 'no_entregado' })}>{t('panel.delivery.notDelivered')}</button></>
        );
      } },
    ];
    return (
      <section className="page active">
        <div className="page-head">
          <div><h1>{t('panel.nav.delivery')}</h1><p>{myRoutes.length > 1 ? t('panel.delivery.yourRoutes') : t('panel.delivery.yourRoute')}: {myRoutes.map(routeName).join(' + ') || t('panel.delivery.noRoute')} — {fmtDate(date)}. {t('panel.delivery.autoUpdates')}{dayInfo.processed && ` ${t('panel.delivery.dayFrozenNote')}`}</p></div>
          <div className="head-actions">
            <span className="badge active" style={{ fontSize: 14 }}>{delivered}/{list.length} {t('panel.delivery.deliveredWord')}</span>
            {myRoutes.length > 0 && <button className="info" onClick={() => setMapRouteId(myRoutes[0])}>{t('panel.delivery.viewMap')}</button>}
          </div>
        </div>
        {banner}
        <DataTable columns={columns} rows={list} emptyText={t('panel.delivery.noActiveOrders')} resizeGroup="delivery" userId={user?.id} />
        {marking && <MarkModal key={marking.client.id} marking={marking} record={recordFor(marking.client.id)} onClose={() => setMarking(null)} onSubmit={handleMarkSubmit} />}
        <RouteMapModal
          open={mapRouteId != null}
          onClose={() => setMapRouteId(null)}
          routeId={mapRouteId}
          routeName={routeName(mapRouteId)}
          clients={mapRouteId ? listForRoutes(mapRouteId) : []}
          date={date}
          isDriverBroadcasting={isDriver}
          driverDisplayName={user?.name}
          saveClients={saveClients}
        />
      </section>
    );
  }

  const groups = routes.map((r) => ({ route: r, clients: listForRoutes(r.id) })).filter((g) => g.clients.length);

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.delivery')}</h1><p>{t('panel.delivery.progressByRoute')} — {fmtDate(date)}. {t('panel.delivery.colorLegend')} {t('panel.delivery.autoUpdates')}</p></div>
      </div>
      {banner}
      <div className="delivery-routes-grid">
        {groups.length ? groups.map((g) => {
          const drv = driverForRoute(drivers, g.route.id);
          const delivered = g.clients.filter((c) => recordFor(c.id)?.status === 'entregado').length;
          let nextAssigned = false;
          return (
            <details className="card card-pad delivery-route-card" key={g.route.id}>
              <summary className="delivery-route-head">
                <div className="delivery-route-title">
                  <h3>{g.route.name}</h3>
                  <span className="delivery-counter">{delivered}/{g.clients.length}</span>
                </div>
              </summary>
              {/* Fuera de <summary> a propósito: <summary> ya es un elemento interactivo (togglea el… */}
              <button type="button" className="info delivery-map-btn" onClick={() => setMapRouteId(g.route.id)}>{t('panel.delivery.map')}</button>
              <div className="delivery-route-body">
                <div className="delivery-route-driver">{t('panel.delivery.driverLabel')} {drv ? `${drv.firstName} ${drv.lastName}` : t('panel.delivery.unassigned')}</div>
                <ul className="delivery-client-list">
                  {g.clients.map((c) => {
                    const st = recordFor(c.id)?.status;
                    let cls = 'delivery-purple';
                    if (st === 'entregado') cls = 'delivery-green';
                    else if (st === 'no_entregado') cls = 'delivery-red';
                    else if (!nextAssigned) { cls = 'delivery-orange'; nextAssigned = true; }
                    return <li key={c.id}><button type="button" className={`delivery-client ${cls}`} onClick={() => setViewing(c)}>{c.name}</button></li>;
                  })}
                </ul>
              </div>
            </details>
          );
        }) : <p className="muted">{t('panel.delivery.noActiveRoutes')}</p>}
      </div>
      {marking && <MarkModal key={marking.client.id} marking={marking} record={recordFor(marking.client.id)} onClose={() => setMarking(null)} onSubmit={handleMarkSubmit} />}
      <RouteMapModal
        open={mapRouteId != null}
        onClose={() => setMapRouteId(null)}
        routeId={mapRouteId}
        routeName={routeName(mapRouteId)}
        clients={mapRouteId ? listForRoutes(mapRouteId) : []}
        date={date}
        isDriverBroadcasting={false}
        driverDisplayName={user?.name}
        saveClients={saveClients}
      />
      {viewing && (
        <Modal title={t('panel.delivery.detailTitle', { name: viewing.name })} open={!!viewing} onClose={() => setViewing(null)} hideSave>
          {(() => {
            const rec = recordFor(viewing.id);
            const st = rec?.status;
            return (
              <div className="stack">
                <p style={{ margin: 0 }}><b>{viewing.name}</b><br /><small className="muted">{routeName(effectiveRouteId(viewing, date))}{effectiveAddress(viewing, date) ? ` · ${effectiveAddress(viewing, date)}` : ''}</small></p>
                <p style={{ margin: 0 }}>
                  {st === 'entregado' ? <span className="badge active">{t('panel.delivery.delivered')}</span> : st === 'no_entregado' ? <span className="badge danger">{t('panel.delivery.notDelivered')}</span> : <span className="badge off">{t('panel.delivery.pending')}</span>}
                  {rec?.by && <small className="muted"> · {t('panel.delivery.markedBy', { name: rec.by })}</small>}
                </p>
                {st === 'no_entregado' && <p style={{ margin: 0 }}><b>{t('panel.delivery.faultLabel')}</b> {faultText(rec)}<br /><small className="muted">{faultHint(rec)}</small></p>}
                {st === 'no_entregado' && rec?.reason && <p style={{ margin: 0 }}><b>{t('panel.delivery.reasonLabel')}</b> {rec.reason}</p>}
                {rec?.note && <p style={{ margin: 0 }}><b>{t('panel.delivery.noteLabel')}</b> {rec.note}</p>}
                {rec?.image && <StoredImage stored={rec.image} alt={t('panel.delivery.photoAlt')} className="delivery-detail-photo" />}
                {canEdit && (
                  <div className="delivery-detail-actions">
                    {st === 'entregado' || st === 'no_entregado' ? (
                      <><button className="icon-btn info" onClick={() => { setMarking({ client: viewing, kind: st }); setViewing(null); }}>{t('panel.common.edit')}</button><button className="icon-btn delete" onClick={() => clearRecord(viewing)}>{t('panel.delivery.removeMark')}</button></>
                    ) : (
                      <><button className="success" onClick={() => { setMarking({ client: viewing, kind: 'entregado' }); setViewing(null); }}>{t('panel.delivery.markDelivered')}</button><button className="orange" onClick={() => { setMarking({ client: viewing, kind: 'no_entregado' }); setViewing(null); }}>{t('panel.delivery.markNotDelivered')}</button></>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </Modal>
      )}
    </section>
  );
}

function MarkModal({ marking, record, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [photoUrl, setPhotoUrl] = useState(record?.image || '');
  const isFail = marking.kind === 'no_entregado';
  return (
    <Modal title={`${isFail ? t('panel.delivery.notDelivered') : t('panel.delivery.delivered')} — ${marking.client.name}`} open onClose={onClose} onSubmit={(form) => onSubmit(form, photoUrl)}>
      <div className="form-grid">
        {isFail ? (
          <>
            <label className="wide">{t('panel.delivery.reasonRequired')}<textarea name="reason" required rows="3" defaultValue={record?.reason || ''} placeholder={t('panel.delivery.reasonPlaceholder')} /></label>
            <small className="wide muted">{t('panel.delivery.faultDecidedInNotes')}</small>
          </>
        ) : (
          <label className="wide">{t('panel.delivery.noteOptional')}<textarea name="note" rows="2" defaultValue={record?.note || ''} placeholder={t('panel.delivery.notePlaceholder')} /></label>
        )}
        <ImageField label={t('panel.delivery.photoOptional')} name="_photo" value={photoUrl} onChange={setPhotoUrl} folder="delivery-proof" maxDim={700} />
      </div>
    </Modal>
  );
}

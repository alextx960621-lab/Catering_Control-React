import { useEffect, useRef, useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbGetDeliveryRows, dbUpsertDeliveryRows } from '../../../services/db';
import { dbInsertAudit } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveOrder, effectiveAddress, dispatchStatus, myRouteIds, driverForRoute } from '../../../services/dispatchHelpers';
import { canManageDelivery } from '../../../services/panelAuth';
import Modal from '../Modal';
import DataTable from '../DataTable';
import RouteMapModal from './RouteMapModal';
import ImageField from '../ImageField';

// No requiere que el archivo se llame igual al original: esto reemplaza
// deliveryCache + ensureDeliveryLoaded + saveDeliveryRecord, pero como
// estado de React en vez de variables sueltas.
export default function DeliveryPage({ user }) {
  const { clients, routes, drivers, days, currentDate, settings, showNotice } = useOperations();
  const [records, setRecords] = useState([]);
  const [marking, setMarking] = useState(null); // { client, kind }
  const [viewing, setViewing] = useState(null); // client (para el detalle)
  const [mapRouteId, setMapRouteId] = useState(null);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const pollRef = useRef(null);

  const isDriver = user?.role === 'driver';
  const canEdit = canManageDelivery(user?.role, settings.customRoles);
  const date = currentDate;
  const dayInfo = days[date] || { laborable: true };
  const myRoutes = myRouteIds(user, drivers);

  async function load() {
    const rows = await dbGetDeliveryRows(date);
    setRecords(rows || []);
    setLoadingRecords(false);
  }

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => { if (!document.hidden && !marking && !viewing) load(); }, 12000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function recordFor(clientId) {
    return records.find((r) => r.clientId === clientId) || null;
  }

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Sin ruta'; }

  function listForRoutes(routeIds) {
    const ids = Array.isArray(routeIds) ? routeIds : [routeIds];
    return clients
      .filter((c) => ids.includes(effectiveRouteId(c, date)) && dispatchStatus(c, date, dayInfo, false) === 'Activo')
      .sort((a, b) => (n(effectiveOrder(a, date)) || 9999) - (n(effectiveOrder(b, date)) || 9999) || a.name.localeCompare(b.name));
  }

  async function saveRecord(clientId, payload) {
    const list = [...records];
    const idx = list.findIndex((r) => r.clientId === clientId);
    const record = { clientId, ...payload };
    if (idx >= 0) list[idx] = record; else list.push(record);
    setRecords(list);
    return dbUpsertDeliveryRows([{ date, clientId, payload }]);
  }

  async function handleMarkSubmit(form, photoUrl) {
    const { client, kind } = marking;
    if (dayInfo.processed) { showNotice('Ese día ya fue procesado y quedó congelado -- no se pueden marcar más entregas. Un admin/editor puede "Desprocesar día" desde Día de trabajo.', true); return false; }
    const data = Object.fromEntries(new FormData(form));
    const reason = (data.reason || '').trim();
    if (kind === 'no_entregado' && !reason) return false;
    const payload = { status: kind, reason: kind === 'no_entregado' ? reason : '', note: (data.note || '').trim(), image: photoUrl || '', at: new Date().toISOString(), by: user?.name };
    const ok = await saveRecord(client.id, payload);
    dbInsertAudit({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: kind === 'no_entregado' ? 'Pedido marcado no entregado' : 'Pedido marcado entregado', entity_type: 'delivery', entity_label: client.name, entity_id: client.id, details: { fecha: date, motivo: payload.reason || undefined } });
    if (!ok) return false;
  }

  async function clearRecord(client) {
    if (dayInfo.processed) { showNotice('Ese día ya fue procesado y quedó congelado -- no se puede modificar la entrega.', true); return; }
    if (!confirm('¿Quitar la marca de entrega de este pedido?')) return;
    await saveRecord(client.id, { status: 'pendiente', reason: '', note: '', image: '', at: new Date().toISOString(), by: user?.name });
    setViewing(null);
  }

  if (loadingRecords) return <p className="muted">Cargando estado de entregas…</p>;

  if (isDriver) {
    const list = listForRoutes(myRoutes);
    const delivered = list.filter((c) => recordFor(c.id)?.status === 'entregado').length;
    const columns = [
      { key: 'order', label: 'Orden', render: (c) => n(effectiveOrder(c, date)) || '' },
      { key: 'name', label: 'Cliente', render: (c) => (<><b>{c.name}</b><br /><small className="muted">{effectiveAddress(c, date)}</small></>) },
      ...(myRoutes.length > 1 ? [{ key: 'route', label: 'Ruta', render: (c) => routeName(effectiveRouteId(c, date)) }] : []),
      { key: 'status', label: 'Estado de entrega', render: (c) => {
        const rec = recordFor(c.id);
        const st = rec?.status;
        const badge = st === 'entregado' ? <span className="badge active">Entregado</span> : st === 'no_entregado' ? <span className="badge danger">No entregado</span> : <span className="badge off">Pendiente</span>;
        const bits = [rec?.at && new Date(rec.at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }), rec?.reason, rec?.note].filter(Boolean);
        return <>{badge}{bits.length > 0 && <><br /><small className="muted">{bits.join(' · ')}</small></>}</>;
      } },
      { key: 'id', label: 'Acciones', render: (c) => {
        if (!canEdit) return '—';
        const st = recordFor(c.id)?.status;
        return st === 'entregado' || st === 'no_entregado' ? (
          <><button className="icon-btn info" onClick={() => setMarking({ client: c, kind: st })}>Editar</button><button className="icon-btn delete" onClick={() => clearRecord(c)}>Quitar</button></>
        ) : (
          <><button className="primary" onClick={() => setMarking({ client: c, kind: 'entregado' })}>Entregado</button> <button className="warning" onClick={() => setMarking({ client: c, kind: 'no_entregado' })}>No entregado</button></>
        );
      } },
    ];
    return (
      <section className="page active">
        <div className="page-head">
          <div><h1>Despacho</h1><p>{(myRoutes.length > 1 ? 'Tus rutas' : 'Tu ruta')}: {myRoutes.map(routeName).join(' + ') || 'Sin ruta'} — {date.split('-').reverse().join('/')}. Se actualiza sola cada pocos segundos.{dayInfo.processed && ' Este día ya fue procesado: quedó congelado.'}</p></div>
          <div className="head-actions">
            <span className="badge active" style={{ fontSize: 14 }}>{delivered}/{list.length} entregados</span>
            {myRoutes.length > 0 && <button className="info" onClick={() => setMapRouteId(myRoutes[0])}>Ver mapa</button>}
          </div>
        </div>
        <DataTable columns={columns} rows={list} emptyText="No hay pedidos activos para esta fecha." resizeGroup="delivery" userId={user?.id} />
        <MarkModal marking={marking} onClose={() => setMarking(null)} onSubmit={handleMarkSubmit} />
        <RouteMapModal
          open={mapRouteId != null}
          onClose={() => setMapRouteId(null)}
          routeId={mapRouteId}
          routeName={routeName(mapRouteId)}
          clients={mapRouteId ? listForRoutes(mapRouteId) : []}
          date={date}
          isDriverBroadcasting={isDriver}
          driverDisplayName={user?.name}
        />
      </section>
    );
  }

  const groups = routes.map((r) => ({ route: r, clients: listForRoutes(r.id) })).filter((g) => g.clients.length);

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Despacho</h1><p>Progreso de entrega por ruta — {date.split('-').reverse().join('/')}. Verde: entregado · Naranja: siguiente en la lista · Morado: pendiente · Rojo: no entregado. Se actualiza sola cada pocos segundos.</p></div>
      </div>
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
                  <button type="button" className="info" style={{ padding: '3px 10px', fontSize: 11.5, minHeight: 'auto' }} onClick={(e) => { e.preventDefault(); setMapRouteId(g.route.id); }}>Mapa</button>
                </div>
              </summary>
              <div className="delivery-route-body">
                <div className="delivery-route-driver">Driver: {drv ? `${drv.firstName} ${drv.lastName}` : 'Sin asignar'}</div>
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
        }) : <p className="muted">No hay rutas con pedidos activos para esta fecha.</p>}
      </div>
      <MarkModal marking={marking} onClose={() => setMarking(null)} onSubmit={handleMarkSubmit} />
      <RouteMapModal
        open={mapRouteId != null}
        onClose={() => setMapRouteId(null)}
        routeId={mapRouteId}
        routeName={routeName(mapRouteId)}
        clients={mapRouteId ? listForRoutes(mapRouteId) : []}
        date={date}
        isDriverBroadcasting={false}
        driverDisplayName={user?.name}
      />
      {viewing && (
        <Modal title={`Detalle de entrega — ${viewing.name}`} open={!!viewing} onClose={() => setViewing(null)} hideSave>
          {(() => {
            const rec = recordFor(viewing.id);
            const st = rec?.status;
            return (
              <div className="stack">
                <p style={{ margin: 0 }}><b>{viewing.name}</b><br /><small className="muted">{routeName(effectiveRouteId(viewing, date))}{effectiveAddress(viewing, date) ? ` · ${effectiveAddress(viewing, date)}` : ''}</small></p>
                <p style={{ margin: 0 }}>
                  {st === 'entregado' ? <span className="badge active">Entregado</span> : st === 'no_entregado' ? <span className="badge danger">No entregado</span> : <span className="badge off">Pendiente</span>}
                  {rec?.by && <small className="muted"> · Marcado por {rec.by}</small>}
                </p>
                {st === 'no_entregado' && rec?.reason && <p style={{ margin: 0 }}><b>Motivo:</b> {rec.reason}</p>}
                {rec?.note && <p style={{ margin: 0 }}><b>Observación:</b> {rec.note}</p>}
                {rec?.image && <img src={rec.image} alt="Foto de respaldo" className="delivery-detail-photo" />}
                {canEdit && (
                  <div className="delivery-detail-actions">
                    {st === 'entregado' || st === 'no_entregado' ? (
                      <><button className="icon-btn info" onClick={() => { setMarking({ client: viewing, kind: st }); setViewing(null); }}>Editar</button><button className="icon-btn delete" onClick={() => clearRecord(viewing)}>Quitar marca</button></>
                    ) : (
                      <><button className="primary" onClick={() => { setMarking({ client: viewing, kind: 'entregado' }); setViewing(null); }}>Marcar entregado</button><button className="warning" onClick={() => { setMarking({ client: viewing, kind: 'no_entregado' }); setViewing(null); }}>Marcar no entregado</button></>
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

function MarkModal({ marking, onClose, onSubmit }) {
  const [photoUrl, setPhotoUrl] = useState('');
  if (!marking) return null;
  const isFail = marking.kind === 'no_entregado';
  return (
    <Modal title={`${isFail ? 'No entregado' : 'Entregado'} — ${marking.client.name}`} open={!!marking} onClose={onClose} onSubmit={(form) => onSubmit(form, photoUrl)}>
      <div className="form-grid">
        {isFail ? (
          <label className="wide">Motivo por el que no se entregó *<textarea name="reason" required rows="3" placeholder="Ej.: Cliente no se encontraba, dirección incorrecta…" /></label>
        ) : (
          <label className="wide">Observación (opcional)<textarea name="note" rows="2" placeholder="Ej.: Recibió un familiar, dejado en portería…" /></label>
        )}
        <ImageField label="Foto de respaldo (opcional)" name="_photo" value={photoUrl} onChange={setPhotoUrl} folder="delivery-proof" maxDim={700} />
      </div>
    </Modal>
  );
}

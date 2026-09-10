import { useEffect, useRef, useState } from 'react';
import { n } from '../../../services/planHelpers';
import { effectiveOrder, resolvedAddress } from '../../../services/dispatchHelpers';
import { fetchRoadRoute } from '../../../services/roadRoute';
import { supabase } from '../../../services/supabaseClient';

const LOCATION_CHANNEL_NAME = 'catering-driver-locations';
const BROADCAST_MIN_INTERVAL_MS = 4000;

// Muestra un mapa con las paradas de una ruta (numeradas por orden de
// entrega), intenta calcular la ruta real por calles (OSRM, con línea
// recta de respaldo si no hay internet para eso), y comparte/recibe la
// posición GPS en vivo del driver por un canal de Supabase Realtime
// (no es una tabla -- es solo un "susurro" en vivo, no queda guardado).
export default function RouteMapModal({ open, onClose, routeId, routeName, clients, date, isDriverBroadcasting, driverDisplayName }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const watchIdRef = useRef(null);
  const channelRef = useRef(null);
  const lastBroadcastAtRef = useRef(0);
  const [status, setStatus] = useState('');
  const [legend, setLegend] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const markersLayer = L.layerGroup().addTo(map);
      layersRef.current.markers = markersLayer;
      layersRef.current.L = L;

      const withAddr = clients.map((c) => ({ c, addr: resolvedAddress(c, date) })).filter((t) => t.addr);
      const withCoords = withAddr.filter(({ addr }) => addr.lat != null && addr.lng != null);
      const sorted = [...withCoords].sort((a, b) => (n(effectiveOrder(a.c, date)) || 9999) - (n(effectiveOrder(b.c, date)) || 9999));
      const latlngs = [];
      const stopLatlngs = [];

      sorted.forEach(({ c, addr }) => {
        const ord = n(effectiveOrder(c, date));
        const pending = !ord;
        const icon = L.divIcon({
          className: '',
          html: `<div class="mc-pin${pending ? ' mc-pin-pending' : ''}"><span>${pending ? 'P' : ord}</span></div>`,
          iconSize: [26, 26], iconAnchor: [13, 26],
        });
        L.marker([addr.lat, addr.lng], { icon }).addTo(markersLayer).bindPopup(`<b>${escapeHtml(c.name)}</b><br>Orden: ${pending ? 'Pendiente de asignar' : ord}<br>${escapeHtml(addr.address || '')}`);
        latlngs.push([addr.lat, addr.lng]);
        if (ord) stopLatlngs.push([addr.lat, addr.lng]);
      });
      layersRef.current.stops = stopLatlngs;

      const withoutCoords = clients.length - withCoords.length;
      const pendingCount = sorted.length - stopLatlngs.length;
      setLegend(`Números = orden del cliente. Naranja con "P" = todavía sin número asignado (no participa en la ruta).${pendingCount ? ` ${pendingCount} cliente(s) pendiente(s) de orden.` : ''}${withoutCoords ? ` ${withoutCoords} cliente(s) sin ubicación resuelta.` : ''}`);

      if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      else map.setView([-16.5, -68.15], 12);
      setStatus(withCoords.length ? `${withCoords.length}/${clients.length} puntos en el mapa.` : 'No se pudo ubicar a ningún cliente en el mapa todavía.');

      setTimeout(() => map.invalidateSize(), 60);
      drawStraightLine();
      loadRealRoute(false);
      setupLocationChannel();
    })();

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routeId]);

  function drawStraightLine() {
    const { L, stops } = layersRef.current;
    if (!L || !mapRef.current || stops.length < 2) return;
    if (layersRef.current.route) { layersRef.current.route.remove(); layersRef.current.route = null; }
    layersRef.current.route = L.layerGroup().addTo(mapRef.current);
    L.polyline(stops, { color: '#0d6efd', weight: 4, opacity: 0.65, dashArray: '8,6' }).addTo(layersRef.current.route);
  }

  async function loadRealRoute(force) {
    const { stops } = layersRef.current;
    if (!stops || stops.length < 2) return;
    const road = await fetchRoadRoute(stops, force);
    if (!mapRef.current) return; // se cerró mientras esperábamos
    const { L } = layersRef.current;
    if (road?.latlngs?.length) {
      if (layersRef.current.route) { layersRef.current.route.remove(); layersRef.current.route = null; }
      layersRef.current.route = L.layerGroup().addTo(mapRef.current);
      L.polyline(road.latlngs, { color: '#0d6efd', weight: 5, opacity: 0.75 }).addTo(layersRef.current.route);
      setLegend(`Números = orden del cliente. Línea azul = ruta sugerida por calles (${road.km.toFixed(1)} km, ~${Math.round(road.minutes)} min · OpenStreetMap/OSRM, puede diferir del recorrido real).`);
    } else {
      drawStraightLine();
      setLegend((prev) => `${prev} No se pudo calcular la ruta por calles (sin conexión al servicio de rutas); se muestra una línea recta de referencia.`);
    }
  }

  function drawDriverMarker(lat, lng, name) {
    const { L } = layersRef.current;
    if (!L || !mapRef.current) return;
    const icon = L.divIcon({ className: '', html: '<div class="mc-driver-icon">🚚</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
    if (!layersRef.current.driverMarker) {
      layersRef.current.driverMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(mapRef.current).bindPopup(escapeHtml(name || 'Driver'));
    } else {
      layersRef.current.driverMarker.setLatLng([lat, lng]);
    }
  }

  function setupLocationChannel() {
    const channel = supabase.channel(LOCATION_CHANNEL_NAME);
    channelRef.current = channel;

    if (!isDriverBroadcasting) {
      channel.on('broadcast', { event: 'loc' }, ({ payload }) => {
        if (!payload || payload.routeId !== routeId) return;
        drawDriverMarker(payload.lat, payload.lng, payload.name);
      });
      channel.subscribe();
      return;
    }

    if (!navigator.geolocation) { setStatus((s) => `${s} (Este dispositivo no puede compartir ubicación GPS.)`); return; }
    channel.subscribe();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        drawDriverMarker(pos.coords.latitude, pos.coords.longitude, driverDisplayName || 'Tú');
        const now = Date.now();
        if (now - lastBroadcastAtRef.current < BROADCAST_MIN_INTERVAL_MS) return;
        lastBroadcastAtRef.current = now;
        channel.send({ type: 'broadcast', event: 'loc', payload: { routeId, lat: pos.coords.latitude, lng: pos.coords.longitude, name: driverDisplayName, at: now } });
      },
      (err) => setStatus(err.code === 1 ? 'Activá el permiso de ubicación para compartir tu posición en vivo.' : 'No se pudo obtener tu ubicación en vivo.'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
    );
  }

  function teardown() {
    if (watchIdRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    layersRef.current = {};
  }

  if (!open) return null;

  return (
    <dialog className="panel-modal map-modal" open onClose={onClose}>
      <div className="modal-head">
        <h2>Mapa — {routeName}</h2>
        <button type="button" className="outline" onClick={() => loadRealRoute(true)}>↻ Ruta</button>
        <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <div className="map-status">{status}</div>
      <div className="map-body" ref={containerRef} />
      <div className="map-legend">{legend}</div>
    </dialog>
  );
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

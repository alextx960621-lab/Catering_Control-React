import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { n } from '../../../services/planHelpers';
import { effectiveOrder, resolvedAddress, extractLatLngFromMapsField } from '../../../services/dispatchHelpers';
import { fetchRoadRoute } from '../../../services/roadRoute';
import { supabase } from '../../../services/supabaseClient';

const LOCATION_CHANNEL_NAME = 'catering-driver-locations';
const BROADCAST_MIN_INTERVAL_MS = 4000;
const NOMINATIM_DELAY_MS = 1100; // respeta el límite de ~1 solicitud/seg de Nominatim

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function srcFingerprint(addr) { return `${addr?.maps || ''}|${addr?.address || ''}`; }

// Último recurso para ubicar en el mapa a un cliente sin coordenadas resueltas: manda su…
async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (err) {
    console.warn('[mapa] No se pudo geocodificar la dirección con Nominatim:', err);
    return null;
  }
}

// Muestra un mapa con las paradas de una ruta (numeradas por orden de entrega), intenta…
export default function RouteMapModal({ open, onClose, routeId, routeName, clients, date, isDriverBroadcasting, driverDisplayName, saveClients }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const watchIdRef = useRef(null);
  const channelRef = useRef(null);
  const lastBroadcastAtRef = useRef(0);
  const [status, setStatus] = useState('');
  const [legend, setLegend] = useState('');

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;
      // El tile server crudo de OpenStreetMap (tile.openstreetmap.org) es solo para uso
      // ligero/pruebas: su política prohíbe apps en producción y devuelve 403 (mapa gris)
      // en cuanto detecta uso continuo, sea con subdominios a/b/c o con el host único.
      // CARTO ofrece las mismas teselas (basadas en datos de OSM) en un CDN pensado para
      // producción, sin necesidad de API key para este volumen de uso.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        // detectRetina: en pantallas con escala (Windows al 125/150%) sin esto Leaflet pide
        // teselas normales y las estira -> mapa "pixeleado". CARTO sirve @2x sin API key.
        detectRetina: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      }).addTo(map);

      const markersLayer = L.layerGroup().addTo(map);
      layersRef.current.markers = markersLayer;
      layersRef.current.L = L;

      const withAddr = clients.map((c) => ({ c, addr: resolvedAddress(c, date) })).filter((t) => t.addr);
      const withCoords = withAddr.filter(({ addr }) => addr.lat != null && addr.lng != null);
      const latlngs = [];
      const stopLatlngs = [];

      // Dibuja (o re-dibuja, si se llama de nuevo después de geocodificar) el marcador numerado…
      function plotStop(c, addr) {
        const ord = n(effectiveOrder(c, date));
        const pending = !ord;
        const icon = L.divIcon({
          className: '',
          html: `<div class="mc-pin${pending ? ' mc-pin-pending' : ''}"><span>${pending ? 'P' : ord}</span></div>`,
          iconSize: [26, 26], iconAnchor: [13, 26],
        });
        L.marker([addr.lat, addr.lng], { icon }).addTo(markersLayer).bindPopup(`<b>${escapeHtml(c.name)}</b><br>${t('panel.routeMap.orderLabel')} ${pending ? t('panel.routeMap.pendingAssign') : ord}<br>${escapeHtml(addr.address || '')}`);
        latlngs.push([addr.lat, addr.lng]);
        if (ord) stopLatlngs.push([addr.lat, addr.lng]);
      }

      const sorted = [...withCoords].sort((a, b) => (n(effectiveOrder(a.c, date)) || 9999) - (n(effectiveOrder(b.c, date)) || 9999));
      sorted.forEach(({ c, addr }) => plotStop(c, addr));
      layersRef.current.stops = stopLatlngs;

      const updateLegendAndStatus = () => {
        const withoutCoords = clients.length - latlngs.length;
        const pendingCount = latlngs.length - stopLatlngs.length;
        setLegend(`${t('panel.routeMap.legendBase')}${pendingCount ? ` ${t('panel.routeMap.legendPending', { count: pendingCount })}` : ''}${withoutCoords ? ` ${t('panel.routeMap.legendNoLocation', { count: withoutCoords })}` : ''}`);
        setStatus(latlngs.length ? t('panel.routeMap.pointsOnMap', { placed: latlngs.length, total: clients.length }) : t('panel.routeMap.noPointsYet'));
      };

      updateLegendAndStatus();
      if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      else map.setView([-16.5, -68.15], 12);

      setTimeout(() => map.invalidateSize(), 60);
      drawStraightLine();
      loadRealRoute(false);
      setupLocationChannel();

      // Último recurso para los que quedaron sin coordenadas: mandar su dirección de texto a…
      const stillMissing = withAddr.filter(({ addr }) => addr.lat == null || addr.lng == null);
      if (stillMissing.length) {
        const changedClients = new Map();
        let geocodedSoFar = 0;
        for (const { c, addr } of stillMissing) {
          if (cancelled || !mapRef.current) break;
          let coords = extractLatLngFromMapsField(addr.maps) || extractLatLngFromMapsField(addr.address);
          if (!coords && addr.address) {
            setStatus(t('panel.routeMap.resolvingAddresses', { current: geocodedSoFar + 1, total: stillMissing.length }));
            coords = await geocodeAddress(addr.address);
            await sleep(NOMINATIM_DELAY_MS);
          }
          if (!coords || cancelled || !mapRef.current) continue;
          addr.lat = coords.lat; addr.lng = coords.lng; addr.geoSrc = srcFingerprint(addr);
          geocodedSoFar++;
          plotStop(c, addr);
          changedClients.set(c.id, c);
        }
        layersRef.current.stops = stopLatlngs;
        if (!cancelled && mapRef.current) {
          updateLegendAndStatus();
          if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
          drawStraightLine();
          loadRealRoute(false);
        }
        // Guarda las coordenadas resueltas para no tener que volver a pedírselas a Nominatim la…
        if (changedClients.size && saveClients) saveClients([...changedClients.values()]);
      }
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
      setLegend(t('panel.routeMap.legendRoad', { km: road.km.toFixed(1), min: Math.round(road.minutes) }));
    } else {
      drawStraightLine();
      setLegend((prev) => `${prev} ${t('panel.routeMap.legendNoRoad')}`);
    }
  }

  function drawDriverMarker(lat, lng, name) {
    const { L } = layersRef.current;
    if (!L || !mapRef.current) return;
    const icon = L.divIcon({ className: '', html: '<div class="mc-driver-icon">🚚</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
    if (!layersRef.current.driverMarker) {
      layersRef.current.driverMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(mapRef.current).bindPopup(escapeHtml(name || t('panel.roles.driver')));
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

    if (!navigator.geolocation) { setStatus((s) => `${s} ${t('panel.routeMap.noGpsDevice')}`); return; }
    channel.subscribe();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        drawDriverMarker(pos.coords.latitude, pos.coords.longitude, driverDisplayName || t('panel.routeMap.you'));
        const now = Date.now();
        if (now - lastBroadcastAtRef.current < BROADCAST_MIN_INTERVAL_MS) return;
        lastBroadcastAtRef.current = now;
        channel.send({ type: 'broadcast', event: 'loc', payload: { routeId, lat: pos.coords.latitude, lng: pos.coords.longitude, name: driverDisplayName, at: now } });
      },
      (err) => setStatus(err.code === 1 ? t('panel.routeMap.enableLocationPermission') : t('panel.routeMap.locationError')),
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
    <dialog ref={dialogRef} className="panel-modal map-modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2>{t('panel.routeMap.title', { name: routeName })}</h2>
        <button type="button" className="info" onClick={() => loadRealRoute(true)}>↻ {t('panel.common.route')}</button>
        <button type="button" onClick={onClose} aria-label={t('panel.common.close')}>✕</button>
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

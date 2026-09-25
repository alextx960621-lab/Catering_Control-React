import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { useCompanyPrefs } from '../../../context/CompanyPrefsContext';
import { dbGetDeliveryRows } from '../../../services/db';
import { dbGetRatings } from '../../../services/supabaseClient';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveDriverId, effectiveOrder, dispatchStatus, resolvedAddress } from '../../../services/dispatchHelpers';
import { isAdmin } from '../../../services/panelAuth';
import { fetchRoadRoute } from '../../../services/roadRoute';
import Modal from '../Modal';
import { fmtDate } from '../panelUtils';

function dateRangeArray(start, end) {
  const out = [];
  let d = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  if (isNaN(d) || isNaN(last) || d > last) return out;
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
    if (out.length > 370) break;
  }
  return out;
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function sumHaversine(withCoords) {
  let km = 0;
  for (let i = 1; i < withCoords.length; i++) km += haversineKm(withCoords[i - 1].addr.lat, withCoords[i - 1].addr.lng, withCoords[i].addr.lat, withCoords[i].addr.lng);
  return km;
}
function presetRange(preset, today) {
  if (preset === 'week') {
    const dt = new Date(today + 'T00:00:00');
    const wd = (dt.getDay() + 6) % 7;
    const start = new Date(dt);
    start.setDate(dt.getDate() - wd);
    return { start: start.toISOString().slice(0, 10), end: today };
  }
  if (preset === 'last30') { const dt = new Date(today + 'T00:00:00'); dt.setDate(dt.getDate() - 29); return { start: dt.toISOString().slice(0, 10), end: today }; }
  if (preset === 'last90') { const dt = new Date(today + 'T00:00:00'); dt.setDate(dt.getDate() - 89); return { start: dt.toISOString().slice(0, 10), end: today }; }
  return { start: today.slice(0, 8) + '01', end: today };
}
const avg = (arr) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0);
const pct = (x) => `${Math.round(x * 100)}%`;
const mins = (x) => (x ? `${Math.floor(x / 60)}h ${Math.round(x % 60)}m` : '—');
function heatColor(rate) {
  return rate >= 0.9 ? '#dff7ed' : rate >= 0.7 ? '#fff2d9' : '#ffe1e6';
}

export default function MetricsPage({ user }) {
  const { t } = useTranslation();
  const { clients, routes, drivers, days, settings, saveSettings, serverToday } = useOperations();
  const { formatMoney, currencySymbol } = useCompanyPrefs();
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(presetRange('week', serverToday));
  const [routeFilter, setRouteFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [computing, setComputing] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [compareRange, setCompareRange] = useState({ start: '', end: '' });
  const [compareMetrics, setCompareMetrics] = useState(null);
  const [useRealDistance, setUseRealDistance] = useState(false);
  const canSetCost = isAdmin(user?.role);

  const [ratings, setRatings] = useState([]);
  useEffect(() => { dbGetRatings().then(setRatings); }, []);

  function driverName(id) { const d = drivers.find((x) => x.id === id); return d ? `${d.firstName} ${d.lastName}` : t('panel.metrics.unassigned'); }

  useEffect(() => {
    if (preset !== 'custom') setRange(presetRange(preset, serverToday));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  function toggleCompare(checked) {
    setCompareOn(checked);
    if (checked && (!compareRange.start || !compareRange.end)) {
      // Por defecto, propone el periodo inmediatamente anterior de la misma duración -- ej. si el…
      const days2 = dateRangeArray(range.start, range.end).length || 1;
      const startDt = new Date(range.start + 'T00:00:00');
      startDt.setDate(startDt.getDate() - days2);
      const endDt = new Date(range.start + 'T00:00:00');
      endDt.setDate(endDt.getDate() - 1);
      setCompareRange({ start: startDt.toISOString().slice(0, 10), end: endDt.toISOString().slice(0, 10) });
    }
  }

  // Toda la lógica de cálculo vive acá, como función pura -- así sirve tanto para el periodo…
  async function computeRange(startDate, endDate) {
    const dates = dateRangeArray(startDate, endDate);
    const recordsByDate = {};
    await Promise.all(dates.map(async (date) => { recordsByDate[date] = await dbGetDeliveryRows(date); }));

    const routeStats = {}, driverStats = {}, activeDriversByDate = {}, dailyDelivered = {};
    const routeDurations = [], gapMinutes = [];
    let totalScheduled = 0, totalCompleted = 0, totalFailed = 0;

    for (const date of dates) {
      dailyDelivered[date] = 0;
      const dayInfo = days[date] || {};
      for (const r of routes) {
        if (routeFilter && r.id !== routeFilter) continue;
        const fullList = clients.filter((c) => effectiveRouteId(c, date) === r.id && dispatchStatus(c, date, dayInfo, false) === 'Activo');
        if (!fullList.length) continue;
        const list = driverFilter ? fullList.filter((c) => effectiveDriverId(c, date, drivers) === driverFilter) : fullList;
        if (!list.length) continue;
        routeStats[r.id] ||= { name: r.name, completed: 0, failed: 0, scheduled: 0, km: 0, kmDays: 0, durations: [], clientsPerDay: [] };
        const rs = routeStats[r.id];
        rs.scheduled += list.length; totalScheduled += list.length; rs.clientsPerDay.push(list.length);
        const marks = []; const driversInvolved = new Set();
        const records = recordsByDate[date] || [];
        list.forEach((c) => {
          const did = effectiveDriverId(c, date, drivers);
          if (did) driversInvolved.add(did);
          const rec = records.find((x) => x.clientId === c.id);
          if (!rec || (rec.status !== 'entregado' && rec.status !== 'no_entregado')) return;
          if (rec.status === 'entregado') { rs.completed++; totalCompleted++; dailyDelivered[date]++; } else { rs.failed++; totalFailed++; }
          if (rec.at) marks.push({ at: new Date(rec.at) });
          if (did) {
            driverStats[did] ||= { completed: 0, failed: 0, routesWorked: new Set(), km: 0, durations: [] };
            driverStats[did][rec.status === 'entregado' ? 'completed' : 'failed']++;
            driverStats[did].routesWorked.add(date + '|' + r.id);
          }
        });
        driversInvolved.forEach((did) => (activeDriversByDate[date] ||= new Set()).add(did));
        if (marks.length >= 2) {
          marks.sort((a, b) => a.at - b.at);
          const minutes = (marks[marks.length - 1].at - marks[0].at) / 60000;
          if (minutes > 0 && minutes < 20 * 60) {
            rs.durations.push(minutes);
            routeDurations.push({ date, routeId: r.id, routeName: r.name, minutes });
            driversInvolved.forEach((did) => driverStats[did]?.durations.push(minutes));
          }
          for (let i = 1; i < marks.length; i++) { const gap = (marks[i].at - marks[i - 1].at) / 60000; if (gap > 0 && gap < 6 * 60) gapMinutes.push(gap); }
        }
        const withCoords = list
          .map((c) => ({ c, addr: resolvedAddress(c, date) }))
          .filter((t) => t.addr && t.addr.lat != null && t.addr.lng != null)
          .sort((a, b) => (n(effectiveOrder(a.c, date)) || 9999) - (n(effectiveOrder(b.c, date)) || 9999));
        if (withCoords.length >= 2) {
          let km = 0;
          if (useRealDistance) {
            const road = await fetchRoadRoute(withCoords.map(({ addr }) => [addr.lat, addr.lng]), false);
            km = road ? road.km : sumHaversine(withCoords);
          } else {
            km = sumHaversine(withCoords);
          }
          rs.km += km; rs.kmDays++;
          driversInvolved.forEach((did) => { if (driverStats[did]) driverStats[did].km += km / driversInvolved.size; });
        }
      }
    }

    const totalKm = Object.values(routeStats).reduce((a, r) => a + r.km, 0);
    const totalKmDays = Object.values(routeStats).reduce((a, r) => a + r.kmDays, 0);
    const costPerKm = n(settings.costPerKm);
    const activeDays = Object.keys(activeDriversByDate);
    const driverRanking = Object.entries(driverStats).map(([id, d]) => ({ id, name: driverName(id), completed: d.completed, failed: d.failed, successRate: d.completed + d.failed ? d.completed / (d.completed + d.failed) : 0, avgMinutes: avg(d.durations), km: d.km, routesWorked: d.routesWorked.size })).sort((a, b) => b.completed - a.completed);
    const routeRanking = Object.entries(routeStats).map(([id, r]) => ({ id, name: r.name, completed: r.completed, failed: r.failed, scheduled: r.scheduled, successRate: r.completed + r.failed ? r.completed / (r.completed + r.failed) : 0, avgMinutes: avg(r.durations), avgKm: r.kmDays ? r.km / r.kmDays : 0, avgClients: avg(r.clientsPerDay) })).sort((a, b) => b.completed - a.completed);
    const bySpeed = driverRanking.filter((d) => d.avgMinutes > 0).sort((a, b) => a.avgMinutes - b.avgMinutes);
    // Con un solo driver medible "el más rápido" y "el más lento" serían el mismo: no comparemos
    const speedRanking = bySpeed.length > 1 ? bySpeed : [];
    const weeks = [];
    dates.forEach((date, i) => { const wi = Math.floor(i / 7); weeks[wi] ||= { n: wi + 1, count: 0 }; weeks[wi].count += dailyDelivered[date] || 0; });

    return {
      totalScheduled, totalCompleted, totalFailed,
      successRate: totalCompleted + totalFailed ? totalCompleted / (totalCompleted + totalFailed) : 0,
      pendingRate: totalScheduled ? Math.max(0, totalScheduled - totalCompleted - totalFailed) / totalScheduled : 0,
      avgRouteMinutes: avg(routeDurations.map((x) => x.minutes)),
      minRoute: routeDurations.length ? routeDurations.reduce((a, b) => (a.minutes < b.minutes ? a : b)) : null,
      maxRoute: routeDurations.length ? routeDurations.reduce((a, b) => (a.minutes > b.minutes ? a : b)) : null,
      avgGapMinutes: avg(gapMinutes),
      avgClientsPerRoute: avg(Object.values(routeStats).flatMap((r) => r.clientsPerDay)),
      totalKm, avgKmPerRouteDay: totalKmDays ? totalKm / totalKmDays : 0, costPerKm, estCost: totalKm * costPerKm,
      avgCostPerRoute: totalKmDays ? (totalKm / totalKmDays) * costPerKm : 0,
      avgActiveDriversPerDay: avg(activeDays.map((d) => activeDriversByDate[d].size)),
      driverRanking, routeRanking,
      fastestDriver: speedRanking[0] || null, slowestDriver: speedRanking.length ? speedRanking[speedRanking.length - 1] : null,
      weeklyTrend: weeks,
    };
  }

  async function compute() {
    setComputing(true);
    setMetrics(await computeRange(range.start, range.end));
    if (compareOn && compareRange.start && compareRange.end) setCompareMetrics(await computeRange(compareRange.start, compareRange.end));
    else setCompareMetrics(null);
    setComputing(false);
  }

  useEffect(() => { compute(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.start, range.end, routeFilter, driverFilter, compareOn, compareRange.start, compareRange.end, useRealDistance]);

  const maxWeek = metrics ? Math.max(1, ...metrics.weeklyTrend.map((w) => w.count)) : 1;

  async function exportMetrics() {
    if (!metrics) { return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const THIN = { style: 'thin', color: { argb: 'FFD9DEE7' } };
    const headerFill = (ws) => ws.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    const zebra = (ws) => ws.eachRow((row, i) => { if (i === 1) return; row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; }); });

    const ws1 = wb.addWorksheet(t('panel.metrics.sheetSummary'));
    ws1.columns = [{ header: t('panel.metrics.kpiHeader'), key: 'k', width: 36 }, { header: t('panel.metrics.valueHeader'), key: 'v', width: 24 }];
    [
      [t('panel.metrics.period'), t('panel.metrics.rangeFromTo', { from: range.start, to: range.end })], [t('panel.metrics.scheduled'), metrics.totalScheduled], [t('panel.metrics.completed'), metrics.totalCompleted], [t('panel.metrics.failed'), metrics.totalFailed],
      [t('panel.metrics.successRate'), `${(metrics.successRate * 100).toFixed(1)}%`], [t('panel.metrics.avgRouteTimeMin'), Math.round(metrics.avgRouteMinutes)],
      [t('panel.metrics.waitBetweenStopsMin'), Math.round(metrics.avgGapMinutes)], [t('panel.metrics.avgClientsPerRoute'), metrics.avgClientsPerRoute.toFixed(1)],
      [t('panel.metrics.totalEstKm'), metrics.totalKm.toFixed(1)], [t('panel.metrics.avgKmPerRouteDay'), metrics.avgKmPerRouteDay.toFixed(1)],
      [t('panel.metrics.costPerKmCurrency', { symbol: currencySymbol }), metrics.costPerKm], [t('panel.metrics.estPeriodCostCurrency', { symbol: currencySymbol }), metrics.estCost.toFixed(2)],
      [t('panel.metrics.activeDriversPerDay'), metrics.avgActiveDriversPerDay.toFixed(1)],
      [t('panel.metrics.fastestDriver'), metrics.fastestDriver ? t('panel.metrics.driverMinutesValue', { name: metrics.fastestDriver.name, min: Math.round(metrics.fastestDriver.avgMinutes) }) : '—'],
      [t('panel.metrics.slowestDriver'), metrics.slowestDriver ? t('panel.metrics.driverMinutesValue', { name: metrics.slowestDriver.name, min: Math.round(metrics.slowestDriver.avgMinutes) }) : '—'],
    ].forEach(([k, v]) => ws1.addRow({ k, v }));
    headerFill(ws1); zebra(ws1);

    const ws2 = wb.addWorksheet(t('panel.metrics.sheetByDriver'));
    ws2.columns = [{ header: t('panel.roles.driver'), key: 'name', width: 26 }, { header: t('panel.metrics.completed'), key: 'completed', width: 14 }, { header: t('panel.metrics.failed'), key: 'failed', width: 12 }, { header: t('panel.metrics.successRate'), key: 'rate', width: 12 }, { header: t('panel.metrics.avgTimeMinShort'), key: 'avg', width: 16 }, { header: t('panel.metrics.estKm'), key: 'km', width: 14 }, { header: t('panel.metrics.routesWorked'), key: 'routes', width: 16 }];
    metrics.driverRanking.forEach((d) => ws2.addRow({ name: d.name, completed: d.completed, failed: d.failed, rate: `${(d.successRate * 100).toFixed(0)}%`, avg: d.avgMinutes ? Math.round(d.avgMinutes) : '', km: d.km ? d.km.toFixed(1) : '', routes: d.routesWorked }));
    headerFill(ws2); zebra(ws2);

    const ws3 = wb.addWorksheet(t('panel.metrics.sheetByRoute'));
    ws3.columns = [{ header: t('panel.common.route'), key: 'name', width: 26 }, { header: t('panel.metrics.scheduledMasc'), key: 'scheduled', width: 14 }, { header: t('panel.metrics.completedMasc'), key: 'completed', width: 14 }, { header: t('panel.metrics.failedMasc'), key: 'failed', width: 12 }, { header: t('panel.metrics.successRate'), key: 'rate', width: 12 }, { header: t('panel.metrics.avgTimeMinShort'), key: 'avg', width: 16 }, { header: t('panel.metrics.avgKmPerDay'), key: 'km', width: 14 }, { header: t('panel.metrics.avgClientsPerDay'), key: 'clients', width: 16 }];
    metrics.routeRanking.forEach((r) => ws3.addRow({ name: r.name, scheduled: r.scheduled, completed: r.completed, failed: r.failed, rate: `${(r.successRate * 100).toFixed(0)}%`, avg: r.avgMinutes ? Math.round(r.avgMinutes) : '', km: r.avgKm ? r.avgKm.toFixed(1) : '', clients: r.avgClients.toFixed(1) }));
    headerFill(ws3); zebra(ws3);

    const ws4 = wb.addWorksheet(t('panel.metrics.sheetWeeklyTrend'));
    ws4.columns = [{ header: t('panel.metrics.week'), key: 'label', width: 16 }, { header: t('panel.metrics.deliveries'), key: 'count', width: 12 }];
    metrics.weeklyTrend.forEach((w) => ws4.addRow({ label: t('panel.metrics.weekN', { n: w.n }), count: w.count }));
    headerFill(ws4); zebra(ws4);

    const buffer = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = t('panel.metrics.exportFileName', { from: range.start, to: range.end });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const kpis = metrics ? [
    [t('panel.metrics.routesDayWithData'), metrics.routeRanking.length, ''],
    [t('panel.metrics.completedDeliveries'), metrics.totalCompleted, t('panel.metrics.ofScheduled', { total: metrics.totalScheduled })],
    [t('panel.metrics.failedDeliveriesPct'), pct(metrics.totalScheduled ? metrics.totalFailed / metrics.totalScheduled : 0), ''],
    [t('panel.metrics.successOfMarked'), pct(metrics.successRate), t('panel.metrics.pendingPct', { pct: pct(metrics.pendingRate) })],
    [t('panel.metrics.avgRouteTime'), mins(metrics.avgRouteMinutes), t('panel.metrics.startToLastDelivery')],
    [t('panel.metrics.waitBetweenStops'), metrics.avgGapMinutes ? `${Math.round(metrics.avgGapMinutes)} min` : '—', t('panel.metrics.averageWord')],
    [t('panel.metrics.avgClientsPerRoute'), metrics.avgClientsPerRoute.toFixed(1), ''],
    [t('panel.metrics.estKmPeriod'), metrics.totalKm.toFixed(1), useRealDistance ? t('panel.metrics.realStreetRoute') : t('panel.metrics.straightLine')],
    [t('panel.metrics.avgKmPerRouteDay'), metrics.avgKmPerRouteDay.toFixed(1), ''],
    [t('panel.metrics.estPeriodCost'), metrics.costPerKm ? formatMoney(metrics.estCost) : '—', metrics.costPerKm ? `${formatMoney(metrics.costPerKm)}/km` : t('panel.metrics.defineCostPerKm')],
    [t('panel.metrics.avgCostPerRoute'), metrics.costPerKm ? formatMoney(metrics.avgCostPerRoute) : '—', ''],
    [t('panel.metrics.activeDriversPerDay'), metrics.avgActiveDriversPerDay.toFixed(1), ''],
  ] : [];

  return (
    <section className="page active">
      <div className="page-head"><div><h1>{t('panel.nav.metrics')}</h1><p>{t('panel.metrics.subtitle')} {useRealDistance ? t('panel.metrics.kmRealNote') : t('panel.metrics.kmStraightNote')}</p></div></div>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <label className="field">{t('panel.metrics.period')}
          <select id="metrics-preset" name="metrics-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="week">{t('panel.metrics.thisWeek')}</option><option value="month">{t('panel.metrics.thisMonth')}</option>
            <option value="last30">{t('panel.metrics.last30Days')}</option><option value="last90">{t('panel.metrics.last90Days')}</option>
            <option value="custom">{t('panel.metrics.customRange')}</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="field">{t('panel.common.from')}<div className="date-input-wrap"><input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></div></label>
            <label className="field">{t('panel.common.to')}<div className="date-input-wrap"><input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></div></label>
          </>
        )}
        <label className="field">{t('panel.common.route')}<select id="metrics-route-filter" name="metrics-route-filter" value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}><option value="">{t('panel.metrics.allRoutes')}</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="field">{t('panel.roles.driver')}<select id="metrics-driver-filter" name="metrics-driver-filter" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}><option value="">{t('panel.metrics.allDrivers')}</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}</select></label>
        <label className="field" style={{ width: 150 }}>{t('panel.metrics.costPerKmCurrency', { symbol: currencySymbol })}
          {canSetCost ? <input type="number" min="0" step="0.01" defaultValue={n(settings.costPerKm)} onBlur={(e) => saveSettings({ ...settings, costPerKm: n(e.target.value) })} /> : <div className="muted">{n(settings.costPerKm).toFixed(2)}</div>}
        </label>
        <span className="spacer" />
        <button className="excel" onClick={exportMetrics} disabled={!metrics}>{t('panel.metrics.exportExcel')}</button>
      </div>
      <div className="toolbar" style={{ marginTop: -8 }}>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={compareOn} onChange={(e) => toggleCompare(e.target.checked)} /> {t('panel.metrics.compareWithPeriod')}
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }} title={t('panel.metrics.realDistanceTitle')}>
          <input type="checkbox" style={{ width: 'auto' }} checked={useRealDistance} onChange={(e) => setUseRealDistance(e.target.checked)} /> {t('panel.metrics.useRealDistanceLabel')}
        </label>
        {compareOn && (
          <>
            <label className="field">{t('panel.metrics.compareFrom')}<div className="date-input-wrap"><input type="date" value={compareRange.start} onChange={(e) => setCompareRange({ ...compareRange, start: e.target.value })} /></div></label>
            <label className="field">{t('panel.metrics.compareTo')}<div className="date-input-wrap"><input type="date" value={compareRange.end} onChange={(e) => setCompareRange({ ...compareRange, end: e.target.value })} /></div></label>
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>{t('panel.metrics.compareHint')}</span>
          </>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>{useRealDistance ? t('panel.metrics.kmRealShort') : t('panel.metrics.kmStraightShort')}</p>

      <RatingsCard ratings={ratings} />

      {computing || !metrics ? <p className="muted">{t('panel.metrics.computing')}</p> : (
        <>
          {compareOn && compareMetrics && <ComparisonCard current={metrics} previous={compareMetrics} range={range} compareRange={compareRange} />}
          <div className="summary-grid">
            {kpis.map(([label, val, sub]) => (
              <div className="card metric" key={label}>
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
                <strong>{val}</strong>
                {sub && <small className="muted" style={{ display: 'block' }}>{sub}</small>}
              </div>
            ))}
          </div>

          <div className="two-col metrics-split">
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>{t('panel.metrics.weeklyTrendTitle')}</h3>
              <div className="metrics-bar-row">
                {metrics.weeklyTrend.length ? metrics.weeklyTrend.map((w, i) => (
                  <div className="metrics-bar-col" key={i}>
                    <div className="metrics-bar" style={{ height: `${Math.round((w.count / maxWeek) * 100)}%` }} title={t('panel.metrics.weekBarTitle', { label: t('panel.metrics.weekN', { n: w.n }), n: w.count })} />
                    <small className="muted">{t('panel.metrics.weekShort', { n: w.n })}</small>
                    <b style={{ fontSize: 11 }}>{w.count}</b>
                  </div>
                )) : <p className="muted">{t('panel.metrics.noDataInPeriod')}</p>}
              </div>
            </div>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>{t('panel.metrics.driversRankingTitle')}</h3>
              <p style={{ margin: '2px 0' }}><b>{t('panel.metrics.fastestDriver')}:</b> {metrics.fastestDriver ? t('panel.metrics.driverMinPerRouteAvg', { name: metrics.fastestDriver.name, min: Math.round(metrics.fastestDriver.avgMinutes) }) : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>{t('panel.metrics.slowestDriver')}:</b> {metrics.slowestDriver ? t('panel.metrics.driverMinPerRouteAvg', { name: metrics.slowestDriver.name, min: Math.round(metrics.slowestDriver.avgMinutes) }) : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>{t('panel.metrics.fastestRouteRecorded')}:</b> {metrics.minRoute ? `${metrics.minRoute.routeName} — ${fmtDate(metrics.minRoute.date)} (${mins(metrics.minRoute.minutes)})` : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>{t('panel.metrics.slowestRouteRecorded')}:</b> {metrics.maxRoute ? `${metrics.maxRoute.routeName} — ${fmtDate(metrics.maxRoute.date)} (${mins(metrics.maxRoute.minutes)})` : '—'}</p>
            </div>
          </div>

          <div className="two-col" style={{ marginTop: 16 }}>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>{t('panel.metrics.driversHeading')}</h3>
              <div className="sheet"><table><thead><tr><th>{t('panel.roles.driver')}</th><th>{t('panel.metrics.completed')}</th><th>{t('panel.metrics.failed')}</th><th>{t('panel.metrics.successRate')}</th><th>{t('panel.metrics.avgTimePerRouteShort')}</th><th>{t('panel.metrics.kmEstShort')}</th><th>{t('panel.metrics.routesWorked')}</th></tr></thead>
                <tbody>{metrics.driverRanking.length ? metrics.driverRanking.map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td>{d.completed}</td><td>{d.failed}</td><td style={{ background: heatColor(d.successRate) }}>{pct(d.successRate)}</td><td>{mins(d.avgMinutes)}</td><td>{d.km.toFixed(1)}</td><td>{d.routesWorked}</td></tr>
                )) : <tr><td colSpan={7} className="empty">{t('panel.metrics.noData')}</td></tr>}</tbody>
              </table></div>
            </div>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>{t('panel.nav.routes')}</h3>
              <div className="sheet"><table><thead><tr><th>{t('panel.common.route')}</th><th>{t('panel.metrics.completed')}</th><th>{t('panel.metrics.failed')}</th><th>{t('panel.metrics.successRate')}</th><th>{t('panel.metrics.avgTimeShort')}</th><th>{t('panel.metrics.kmAvgShort')}</th><th>{t('panel.metrics.clientsAvgShort')}</th></tr></thead>
                <tbody>{metrics.routeRanking.length ? metrics.routeRanking.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r.completed}</td><td>{r.failed}</td><td style={{ background: heatColor(r.successRate) }}>{pct(r.successRate)}</td><td>{mins(r.avgMinutes)}</td><td>{r.avgKm.toFixed(1)}</td><td>{r.avgClients.toFixed(1)}</td></tr>
                )) : <tr><td colSpan={7} className="empty">{t('panel.metrics.noData')}</td></tr>}</tbody>
              </table></div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ComparisonCard({ current, previous, range, compareRange }) {
  const { t } = useTranslation();
  const { currencySymbol } = useCompanyPrefs();
  function delta(x, y) {
    if (isNaN(x) || isNaN(y) || !y) return <span className="muted">—</span>;
    const d = ((x - y) / y) * 100;
    if (Math.abs(d) < 1) return <span className="muted">≈ {t('panel.metrics.equalWord')}</span>;
    return d > 0 ? <span style={{ color: '#087354' }}>▲ {d.toFixed(0)}%</span> : <span style={{ color: '#a3123a' }}>▼ {Math.abs(d).toFixed(0)}%</span>;
  }
  const rows = [
    [t('panel.metrics.completedDeliveries'), current.totalCompleted, previous.totalCompleted, current.totalCompleted, previous.totalCompleted],
    [t('panel.metrics.successRate'), pct(current.successRate), pct(previous.successRate), current.successRate, previous.successRate],
    [t('panel.metrics.avgTimePerRouteMin'), Math.round(current.avgRouteMinutes), Math.round(previous.avgRouteMinutes)],
    [t('panel.metrics.estKmTotal'), current.totalKm.toFixed(1), previous.totalKm.toFixed(1)],
    [t('panel.metrics.estCostCurrency', { symbol: currencySymbol }), current.estCost.toFixed(2), previous.estCost.toFixed(2)],
    [t('panel.metrics.clientsAvgPerRoute'), current.avgClientsPerRoute.toFixed(1), previous.avgClientsPerRoute.toFixed(1)],
  ];
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t('panel.metrics.comparisonTitle')}</h3>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
        {t('panel.metrics.comparisonRanges', { currentFrom: fmtDate(range.start), currentTo: fmtDate(range.end), compareFrom: fmtDate(compareRange.start), compareTo: fmtDate(compareRange.end) })}
      </p>
      <div className="sheet">
        <table>
          <thead><tr><th>{t('panel.metrics.kpiHeader')}</th><th>{t('panel.metrics.currentPeriodCol')}</th><th>{t('panel.metrics.comparedPeriodCol')}</th><th>{t('panel.metrics.variationCol')}</th></tr></thead>
          <tbody>
            {rows.map(([label, av, bv, rawA, rawB], i) => (
              <tr key={i}><td>{label}</td><td>{av}</td><td>{bv}</td><td>{delta(rawA != null ? rawA : Number(av), rawB != null ? rawB : Number(bv))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stars({ value, size = 16 }) {
  return (
    <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map((v) => (
        <span key={v} style={{ color: v <= Math.round(value) ? '#f5b301' : '#d5d9e0' }}>★</span>
      ))}
    </span>
  );
}

function RatingsCard({ ratings }) {
  const { t } = useTranslation();
  const [showList, setShowList] = useState(false);
  const total = ratings.length;
  const average = total ? ratings.reduce((a, r) => a + Number(r.stars || 0), 0) / total : 0;
  const dist = [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: ratings.filter((r) => Number(r.stars) === s).length }));
  const maxCount = Math.max(1, ...dist.map((d) => d.count));
  const comments = ratings.filter((r) => r.comment && String(r.comment).trim());

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t('panel.metrics.ratingsTitle')}</h3>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t('panel.metrics.ratingsSubtitle')}</p>
        </div>
        <button className="info" onClick={() => setShowList(true)} disabled={!comments.length} style={{ alignSelf: 'center' }}>
          {t('panel.metrics.viewRecommendations')}{comments.length ? ` (${comments.length})` : ''}
        </button>
      </div>

      {!total ? (
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>{t('panel.metrics.noRatingsYet')}</p>
      ) : (
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <div style={{ textAlign: 'center', minWidth: 110 }}>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{average.toFixed(1)}</div>
            <Stars value={average} size={18} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('panel.metrics.votesCount', { count: total })}</div>
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'grid', gap: 5 }}>
            {dist.map((d) => (
              <div key={d.stars} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="muted" style={{ width: 34, fontSize: 12, flex: '0 0 auto' }}>{d.stars} ★</span>
                <div style={{ flex: 1, height: 9, background: 'var(--panel-bg, #eef1f6)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${(d.count / maxCount) * 100}%`, height: '100%', background: '#f5b301' }} />
                </div>
                <span className="muted" style={{ width: 28, textAlign: 'right', fontSize: 12, flex: '0 0 auto' }}>{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal title={t('panel.metrics.recommendationsTitle')} open={showList} onClose={() => setShowList(false)} hideSave cancelLabel={t('panel.common.close')}>
        {comments.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {comments.map((r, i) => (
              <div key={i} style={{ border: '1px solid var(--panel-line)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <Stars value={Number(r.stars)} size={15} />
                  <span className="muted" style={{ fontSize: 11 }}>{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : ''}</span>
                </div>
                <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{r.comment}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted empty" style={{ marginBottom: 0 }}>{t('panel.metrics.noWrittenRecommendations')}</p>
        )}
      </Modal>
    </div>
  );
}

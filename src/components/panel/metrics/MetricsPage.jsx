import { useEffect, useMemo, useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { dbGetDeliveryRows } from '../../../services/db';
import { n } from '../../../services/planHelpers';
import { effectiveRouteId, effectiveDriverId, effectiveOrder, dispatchStatus, resolvedAddress, driverForRoute } from '../../../services/dispatchHelpers';
import { isAdmin } from '../../../services/panelAuth';

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
  const { clients, routes, drivers, days, settings, saveSettings, serverToday } = useOperations();
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(presetRange('week', serverToday));
  const [routeFilter, setRouteFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [computing, setComputing] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [compareRange, setCompareRange] = useState({ start: '', end: '' });
  const [compareMetrics, setCompareMetrics] = useState(null);
  const canSetCost = isAdmin(user?.role);

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Sin ruta'; }
  function driverName(id) { const d = drivers.find((x) => x.id === id); return d ? `${d.firstName} ${d.lastName}` : 'Sin asignar'; }

  useEffect(() => {
    if (preset !== 'custom') setRange(presetRange(preset, serverToday));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  function toggleCompare(checked) {
    setCompareOn(checked);
    if (checked && (!compareRange.start || !compareRange.end)) {
      // Por defecto, propone el periodo inmediatamente anterior de la
      // misma duración -- ej. si el actual es "esta semana", el
      // comparado arranca siendo "la semana pasada".
      const days2 = dateRangeArray(range.start, range.end).length || 1;
      const startDt = new Date(range.start + 'T00:00:00');
      startDt.setDate(startDt.getDate() - days2);
      const endDt = new Date(range.start + 'T00:00:00');
      endDt.setDate(endDt.getDate() - 1);
      setCompareRange({ start: startDt.toISOString().slice(0, 10), end: endDt.toISOString().slice(0, 10) });
    }
  }

  // Toda la lógica de cálculo vive acá, como función pura -- así sirve
  // tanto para el periodo actual como para el periodo de comparación,
  // sin repetir el código dos veces.
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
          for (let i = 1; i < withCoords.length; i++) km += haversineKm(withCoords[i - 1].addr.lat, withCoords[i - 1].addr.lng, withCoords[i].addr.lat, withCoords[i].addr.lng);
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
    const weeks = [];
    dates.forEach((date, i) => { const wi = Math.floor(i / 7); weeks[wi] ||= { label: `Semana ${wi + 1}`, count: 0 }; weeks[wi].count += dailyDelivered[date] || 0; });

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
      fastestDriver: bySpeed[0] || null, slowestDriver: bySpeed.length ? bySpeed[bySpeed.length - 1] : null,
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

  useEffect(() => { compute(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.start, range.end, routeFilter, driverFilter, compareOn, compareRange.start, compareRange.end]);

  const maxWeek = metrics ? Math.max(1, ...metrics.weeklyTrend.map((w) => w.count)) : 1;

  async function exportMetrics() {
    if (!metrics) { return; }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = settings.companyName;
    const THIN = { style: 'thin', color: { argb: 'FFD9DEE7' } };
    const headerFill = (ws) => ws.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; });
    const zebra = (ws) => ws.eachRow((row, i) => { if (i === 1) return; row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFF3F6FB' : 'FFFFFFFF' } }; cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }; }); });

    const ws1 = wb.addWorksheet('Resumen');
    ws1.columns = [{ header: 'KPI', key: 'k', width: 36 }, { header: 'Valor', key: 'v', width: 24 }];
    [
      ['Periodo', `${range.start} a ${range.end}`], ['Programadas', metrics.totalScheduled], ['Completadas', metrics.totalCompleted], ['Fallidas', metrics.totalFailed],
      ['% éxito', `${(metrics.successRate * 100).toFixed(1)}%`], ['Tiempo promedio por ruta (min)', Math.round(metrics.avgRouteMinutes)],
      ['Espera entre paradas (min)', Math.round(metrics.avgGapMinutes)], ['Clientes promedio por ruta', metrics.avgClientsPerRoute.toFixed(1)],
      ['Km estimados totales', metrics.totalKm.toFixed(1)], ['Km promedio por ruta/día', metrics.avgKmPerRouteDay.toFixed(1)],
      ['Costo por km (Bs)', metrics.costPerKm], ['Costo estimado del periodo (Bs)', metrics.estCost.toFixed(2)],
      ['Drivers activos promedio/día', metrics.avgActiveDriversPerDay.toFixed(1)],
      ['Driver más rápido', metrics.fastestDriver ? `${metrics.fastestDriver.name} (${Math.round(metrics.fastestDriver.avgMinutes)} min)` : '—'],
      ['Driver más lento', metrics.slowestDriver ? `${metrics.slowestDriver.name} (${Math.round(metrics.slowestDriver.avgMinutes)} min)` : '—'],
    ].forEach(([k, v]) => ws1.addRow({ k, v }));
    headerFill(ws1); zebra(ws1);

    const ws2 = wb.addWorksheet('Por driver');
    ws2.columns = [{ header: 'Driver', key: 'name', width: 26 }, { header: 'Completadas', key: 'completed', width: 14 }, { header: 'Fallidas', key: 'failed', width: 12 }, { header: '% éxito', key: 'rate', width: 12 }, { header: 'Tiempo prom. (min)', key: 'avg', width: 16 }, { header: 'Km estimados', key: 'km', width: 14 }, { header: 'Rutas trabajadas', key: 'routes', width: 16 }];
    metrics.driverRanking.forEach((d) => ws2.addRow({ name: d.name, completed: d.completed, failed: d.failed, rate: `${(d.successRate * 100).toFixed(0)}%`, avg: d.avgMinutes ? Math.round(d.avgMinutes) : '', km: d.km ? d.km.toFixed(1) : '', routes: d.routesWorked }));
    headerFill(ws2); zebra(ws2);

    const ws3 = wb.addWorksheet('Por ruta');
    ws3.columns = [{ header: 'Ruta', key: 'name', width: 26 }, { header: 'Programados', key: 'scheduled', width: 14 }, { header: 'Completados', key: 'completed', width: 14 }, { header: 'Fallidos', key: 'failed', width: 12 }, { header: '% éxito', key: 'rate', width: 12 }, { header: 'Tiempo prom. (min)', key: 'avg', width: 16 }, { header: 'Km prom./día', key: 'km', width: 14 }, { header: 'Clientes prom./día', key: 'clients', width: 16 }];
    metrics.routeRanking.forEach((r) => ws3.addRow({ name: r.name, scheduled: r.scheduled, completed: r.completed, failed: r.failed, rate: `${(r.successRate * 100).toFixed(0)}%`, avg: r.avgMinutes ? Math.round(r.avgMinutes) : '', km: r.avgKm ? r.avgKm.toFixed(1) : '', clients: r.avgClients.toFixed(1) }));
    headerFill(ws3); zebra(ws3);

    const ws4 = wb.addWorksheet('Tendencia semanal');
    ws4.columns = [{ header: 'Semana', key: 'label', width: 16 }, { header: 'Entregas', key: 'count', width: 12 }];
    metrics.weeklyTrend.forEach((w) => ws4.addRow(w));
    headerFill(ws4); zebra(ws4);

    const buffer = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `metricas-${range.start}-a-${range.end}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const kpis = metrics ? [
    ['Rutas/día con datos', metrics.routeRanking.length, ''],
    ['Entregas completadas', metrics.totalCompleted, `de ${metrics.totalScheduled} programadas`],
    ['% Entregas fallidas', pct(metrics.totalScheduled ? metrics.totalFailed / metrics.totalScheduled : 0), ''],
    ['Ratio completadas vs pendientes', pct(metrics.successRate), `pendientes ${pct(metrics.pendingRate)}`],
    ['Tiempo promedio por ruta', mins(metrics.avgRouteMinutes), 'inicio → última entrega'],
    ['Espera entre paradas', metrics.avgGapMinutes ? `${Math.round(metrics.avgGapMinutes)} min` : '—', 'promedio'],
    ['Clientes promedio por ruta', metrics.avgClientsPerRoute.toFixed(1), ''],
    ['Km estimados (periodo)', metrics.totalKm.toFixed(1), 'línea recta entre direcciones'],
    ['Km promedio por ruta/día', metrics.avgKmPerRouteDay.toFixed(1), ''],
    ['Costo estimado del periodo', metrics.costPerKm ? `Bs ${metrics.estCost.toFixed(2)}` : '—', metrics.costPerKm ? `Bs ${metrics.costPerKm}/km` : 'definir costo por km'],
    ['Costo promedio por ruta', metrics.costPerKm ? `Bs ${metrics.avgCostPerRoute.toFixed(2)}` : '—', ''],
    ['Drivers activos promedio/día', metrics.avgActiveDriversPerDay.toFixed(1), ''],
  ] : [];

  return (
    <section className="page active">
      <div className="page-head"><div><h1>Métricas</h1><p>Estadísticas de reparto calculadas a partir de las marcas de entrega. Los km son una estimación en línea recta entre direcciones, no una ruta real por calles.</p></div></div>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <label className="field">Periodo
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="week">Esta semana</option><option value="month">Este mes</option>
            <option value="last30">Últimos 30 días</option><option value="last90">Últimos 90 días</option>
            <option value="custom">Rango personalizado</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="field">Desde<div className="date-input-wrap"><input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></div></label>
            <label className="field">Hasta<div className="date-input-wrap"><input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></div></label>
          </>
        )}
        <label className="field">Ruta<select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}><option value="">Todas las rutas</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="field">Driver<select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}><option value="">Todos los drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}</select></label>
        <label className="field" style={{ width: 150 }}>Costo por km (Bs)
          {canSetCost ? <input type="number" min="0" step="0.01" defaultValue={n(settings.costPerKm)} onBlur={(e) => saveSettings({ ...settings, costPerKm: n(e.target.value) })} /> : <div className="muted">{n(settings.costPerKm).toFixed(2)}</div>}
        </label>
        <span className="spacer" />
        <button className="excel" onClick={exportMetrics} disabled={!metrics}>Exportar Excel</button>
      </div>
      <div className="toolbar" style={{ marginTop: -8 }}>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={compareOn} onChange={(e) => toggleCompare(e.target.checked)} /> Comparar con otro periodo
        </label>
        {compareOn && (
          <>
            <label className="field">Comparar desde<div className="date-input-wrap"><input type="date" value={compareRange.start} onChange={(e) => setCompareRange({ ...compareRange, start: e.target.value })} /></div></label>
            <label className="field">Comparar hasta<div className="date-input-wrap"><input type="date" value={compareRange.end} onChange={(e) => setCompareRange({ ...compareRange, end: e.target.value })} /></div></label>
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>Podés comparar cualquier día, semana o mes contra otro.</span>
          </>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>Los km son una estimación en línea recta entre direcciones.</p>

      {computing || !metrics ? <p className="muted">Calculando métricas del periodo…</p> : (
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
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Tendencia de entregas por semana</h3>
              <div className="metrics-bar-row">
                {metrics.weeklyTrend.length ? metrics.weeklyTrend.map((w, i) => (
                  <div className="metrics-bar-col" key={i}>
                    <div className="metrics-bar" style={{ height: `${Math.round((w.count / maxWeek) * 100)}%` }} title={`${w.label}: ${w.count} entregas`} />
                    <small className="muted">{w.label.replace('Semana ', 'S')}</small>
                    <b style={{ fontSize: 11 }}>{w.count}</b>
                  </div>
                )) : <p className="muted">Sin datos en el periodo.</p>}
              </div>
            </div>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Ranking de drivers y extremos de ruta</h3>
              <p style={{ margin: '2px 0' }}><b>Driver más rápido:</b> {metrics.fastestDriver ? `${metrics.fastestDriver.name} (${Math.round(metrics.fastestDriver.avgMinutes)} min/ruta prom.)` : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>Driver más lento:</b> {metrics.slowestDriver ? `${metrics.slowestDriver.name} (${Math.round(metrics.slowestDriver.avgMinutes)} min/ruta prom.)` : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>Ruta más rápida registrada:</b> {metrics.minRoute ? `${metrics.minRoute.routeName} — ${metrics.minRoute.date.split('-').reverse().join('/')} (${mins(metrics.minRoute.minutes)})` : '—'}</p>
              <p style={{ margin: '2px 0' }}><b>Ruta más lenta registrada:</b> {metrics.maxRoute ? `${metrics.maxRoute.routeName} — ${metrics.maxRoute.date.split('-').reverse().join('/')} (${mins(metrics.maxRoute.minutes)})` : '—'}</p>
            </div>
          </div>

          <div className="two-col" style={{ marginTop: 16 }}>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Drivers</h3>
              <div className="sheet"><table><thead><tr><th>Driver</th><th>Completadas</th><th>Fallidas</th><th>% éxito</th><th>Tiempo prom./ruta</th><th>Km est.</th><th>Rutas trabajadas</th></tr></thead>
                <tbody>{metrics.driverRanking.length ? metrics.driverRanking.map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td>{d.completed}</td><td>{d.failed}</td><td style={{ background: heatColor(d.successRate) }}>{pct(d.successRate)}</td><td>{mins(d.avgMinutes)}</td><td>{d.km.toFixed(1)}</td><td>{d.routesWorked}</td></tr>
                )) : <tr><td colSpan={7} className="empty">Sin datos.</td></tr>}</tbody>
              </table></div>
            </div>
            <div className="card card-pad">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Rutas</h3>
              <div className="sheet"><table><thead><tr><th>Ruta</th><th>Completadas</th><th>Fallidas</th><th>% éxito</th><th>Tiempo prom.</th><th>Km prom.</th><th>Clientes prom.</th></tr></thead>
                <tbody>{metrics.routeRanking.length ? metrics.routeRanking.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r.completed}</td><td>{r.failed}</td><td style={{ background: heatColor(r.successRate) }}>{pct(r.successRate)}</td><td>{mins(r.avgMinutes)}</td><td>{r.avgKm.toFixed(1)}</td><td>{r.avgClients.toFixed(1)}</td></tr>
                )) : <tr><td colSpan={7} className="empty">Sin datos.</td></tr>}</tbody>
              </table></div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ComparisonCard({ current, previous, range, compareRange }) {
  function delta(x, y) {
    if (isNaN(x) || isNaN(y) || !y) return <span className="muted">—</span>;
    const d = ((x - y) / y) * 100;
    if (Math.abs(d) < 1) return <span className="muted">≈ igual</span>;
    return d > 0 ? <span style={{ color: '#087354' }}>▲ {d.toFixed(0)}%</span> : <span style={{ color: '#a3123a' }}>▼ {Math.abs(d).toFixed(0)}%</span>;
  }
  const rows = [
    ['Entregas completadas', current.totalCompleted, previous.totalCompleted, current.totalCompleted, previous.totalCompleted],
    ['% éxito', pct(current.successRate), pct(previous.successRate), current.successRate, previous.successRate],
    ['Tiempo prom. por ruta (min)', Math.round(current.avgRouteMinutes), Math.round(previous.avgRouteMinutes)],
    ['Km estimados (total)', current.totalKm.toFixed(1), previous.totalKm.toFixed(1)],
    ['Costo estimado (Bs)', current.estCost.toFixed(2), previous.estCost.toFixed(2)],
    ['Clientes prom. por ruta', current.avgClientsPerRoute.toFixed(1), previous.avgClientsPerRoute.toFixed(1)],
  ];
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Comparación de periodos</h3>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
        Actual: {range.start.split('-').reverse().join('/')} a {range.end.split('-').reverse().join('/')} · Comparado: {compareRange.start.split('-').reverse().join('/')} a {compareRange.end.split('-').reverse().join('/')}
      </p>
      <div className="sheet">
        <table>
          <thead><tr><th>KPI</th><th>Periodo actual</th><th>Periodo comparado</th><th>Variación</th></tr></thead>
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

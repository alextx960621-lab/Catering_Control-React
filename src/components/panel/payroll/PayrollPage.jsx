import { useState } from 'react';
import { useOperations } from '../../../context/OperationsContext';
import { n } from '../../../services/planHelpers';
import { effectiveDriverId, dispatchStatus, myRouteIds } from '../../../services/dispatchHelpers';

function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const DEFAULT_RATE = 4.5;

export default function PayrollPage({ user }) {
  const { clients, drivers, routes, days, currentDate, saveDays, loading } = useOperations();
  const [month, setMonth] = useState(currentDate.slice(0, 7));
  const isDriver = user?.role === 'driver';
  const myRoutes = myRouteIds(user, drivers);

  function routeName(id) { return routes.find((r) => r.id === id)?.name || 'Sin ruta'; }

  const dates = monthDates(month);
  const list = isDriver ? drivers.filter((d) => d.id === user.driverId) : drivers;

  function dayValues(d) {
    return dates.map((date) => {
      const rec = days[date];
      if (!rec?.processed) return '';
      // Si el día tiene una foto congelada (payrollSnapshot), se usa esa —
      // así editar un cliente hoy no cambia el historial de días ya
      // procesados. Los días procesados ANTES de este arreglo no tienen
      // snapshot todavía, así que para esos se recalcula en vivo (puede no
      // coincidir exactamente con lo que se cerró ese día).
      if (rec.payrollSnapshot) return rec.payrollSnapshot.filter((s) => s.driverId === d.id).reduce((a, s) => a + n(s.career), 0);
      return clients.filter((c) => effectiveDriverId(c, date, drivers) === d.id && dispatchStatus(c, date, rec, false) === 'Activo').reduce((a, c) => a + n(c.career || 1), 0);
    });
  }

  function rateFor(d) {
    return n(days[currentDate]?.rates?.[d.id] ?? DEFAULT_RATE);
  }
  // La tarifa se guarda POR DÍA (days[fecha].rates[driverId]) — si cambió a
  // mitad de mes, cada día debe pagarse con la tarifa que tenía vigente ESE
  // día, no con la tarifa de hoy aplicada a todo el mes.
  function rateForDate(d, date) {
    return n(days[date]?.rates?.[d.id] ?? DEFAULT_RATE);
  }

  function saveRate(d, value) {
    const dayRec = days[currentDate] || { laborable: true };
    saveDays({ ...days, [currentDate]: { ...dayRec, rates: { ...(dayRec.rates || {}), [d.id]: n(value) } } });
  }

  const dayTotalsPerDriver = list.map((d) => dayValues(d));
  const dayTotals = dates.map((_, i) => dayTotalsPerDriver.reduce((sum, values) => sum + n(values[i]), 0));
  const grandTotal = dayTotals.reduce((a, v) => a + v, 0);
  // Monto de cada driver: cada día de carreras se paga con la tarifa que
  // regía en ESE día (no con la tarifa de hoy repetida para todo el mes).
  const amountFor = (d, values) => values.reduce((sum, v, i) => sum + n(v) * rateForDate(d, dates[i]), 0);
  const grandAmount = list.reduce((sum, d, i) => sum + amountFor(d, dayTotalsPerDriver[i]), 0);

  const hasLegacyDays = dates.some((date) => days[date]?.processed && !days[date]?.payrollSnapshot?.length && days[date]?.processedClientIds?.length);

  if (loading) return <p className="muted">Cargando sueldos…</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>Sueldos</h1><p>Tarifa del día: visible para administración y para el driver correspondiente.</p></div>
      </div>
      <div className="toolbar">
        <label className="field">Mes<div className="date-input-wrap"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div></label>
        <span className="muted">La tarifa se guarda para el día de trabajo seleccionado: {currentDate.split('-').reverse().join('/')}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>Los días muestran "—" hasta que se procesen desde Día de trabajo. Una vez procesados, quedan como constancia fija de ese día. El monto de cada día se calcula con la tarifa que tenía ese driver ESE día (si la tarifa cambió a mitad de mes, cada tramo se paga con la suya).</p>
      {hasLegacyDays && (
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>Algunos días de este mes se procesaron antes de esta actualización y se recalculan con los datos actuales de cada cliente (pueden no coincidir exactamente con lo que se cerró ese día). Los días procesados desde ahora quedan guardados tal cual se cerraron.</p>
      )}

      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th>Driver / Ruta</th>
              {dates.map((d) => <th key={d}>{Number(d.slice(-2))}</th>)}
              <th>Total</th><th>Tarifa/día</th><th>Monto Bs</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? list.map((d, i) => {
              const values = dayTotalsPerDriver[i];
              const total = values.reduce((a, v) => a + n(v), 0);
              const rate = rateFor(d);
              return (
                <tr key={d.id}>
                  <td><b>{d.firstName} {d.lastName}</b><br /><small className="muted">{routeName(d.routeId)}</small></td>
                  {values.map((v, idx) => <td key={idx}>{v || '—'}</td>)}
                  <td>{total}</td>
                  <td>{!isDriver ? <input className="day-edit" type="number" min="0" step="0.01" defaultValue={rate.toFixed(2)} onBlur={(e) => saveRate(d, e.target.value)} /> : rate.toFixed(2)}</td>
                  <td>{amountFor(d, values).toFixed(2)}</td>
                </tr>
              );
            }) : <tr><td colSpan={dates.length + 4} className="empty">No hay drivers.</td></tr>}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="table-totals">
                <td>Total (carreras/día)</td>
                {dayTotals.map((v, i) => <td key={i}>{v || '—'}</td>)}
                <td>{grandTotal}</td><td>—</td><td>{grandAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

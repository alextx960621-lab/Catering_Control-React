import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { useCompanyPrefs } from '../../../context/CompanyPrefsContext';
import { n } from '../../../services/planHelpers';
import { effectiveDriverId, dispatchStatus } from '../../../services/dispatchHelpers';
import { fmtDate } from '../panelUtils';

function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const DEFAULT_RATE = 4.5;

export default function PayrollPage({ user }) {
  const { t } = useTranslation();
  const { clients, drivers, routes, days, currentDate, saveDays, loading } = useOperations();
  const { currencySymbol } = useCompanyPrefs();
  const [month, setMonth] = useState(currentDate.slice(0, 7));
  const isDriver = user?.role === 'driver';

  function routeName(id) { return routes.find((r) => r.id === id)?.name || t('panel.payroll.noRoute'); }

  const dates = monthDates(month);
  const list = isDriver ? drivers.filter((d) => d.id === user.driverId) : drivers;

  function dayValues(d) {
    return dates.map((date) => {
      const rec = days[date];
      if (!rec?.processed) return '';
      // Si el día tiene una foto congelada (payrollSnapshot), se usa esa — así editar un cliente…
      if (rec.payrollSnapshot) return rec.payrollSnapshot.filter((s) => s.driverId === d.id).reduce((a, s) => a + n(s.career), 0);
      return clients.filter((c) => effectiveDriverId(c, date, drivers) === d.id && dispatchStatus(c, date, rec) === 'Activo').reduce((a, c) => a + n(c.career || 1), 0);
    });
  }

  function rateFor(d) {
    return n(days[currentDate]?.rates?.[d.id] ?? DEFAULT_RATE);
  }
  // La tarifa se guarda POR DÍA (days[fecha].rates[driverId]) — si cambió a mitad de mes…
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
  // Monto de cada driver: cada día de carreras se paga con la tarifa que regía en ESE día (no…
  const amountFor = (d, values) => values.reduce((sum, v, i) => sum + n(v) * rateForDate(d, dates[i]), 0);
  const grandAmount = list.reduce((sum, d, i) => sum + amountFor(d, dayTotalsPerDriver[i]), 0);

  const hasLegacyDays = dates.some((date) => days[date]?.processed && !days[date]?.payrollSnapshot?.length && days[date]?.processedClientIds?.length);

  if (loading) return <p className="muted">{t('panel.payroll.loadingPayroll')}</p>;

  return (
    <section className="page active">
      <div className="page-head">
        <div><h1>{t('panel.nav.payroll')}</h1><p>{t('panel.payroll.subtitle')}</p></div>
      </div>
      <div className="toolbar">
        <label className="field">{t('panel.common.month')}<div className="date-input-wrap"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div></label>
        <span className="muted">{t('panel.payroll.rateSavedForDay', { date: fmtDate(currentDate) })}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>{t('panel.payroll.daysNote')}</p>
      {hasLegacyDays && (
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>{t('panel.payroll.legacyNote')}</p>
      )}

      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th>{t('panel.payroll.driverRoute')}</th>
              {dates.map((d) => <th key={d}>{Number(d.slice(-2))}</th>)}
              <th>{t('panel.common.total')}</th><th>{t('panel.payroll.ratePerDay')}</th><th>{t('panel.common.amount')} ({currencySymbol})</th>
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
                  <td>{!isDriver ? <input className="day-edit" type="number" min="0" step="0.01" id={`rate-${d.id}`} name={`rate-${d.id}`} defaultValue={rate.toFixed(2)} onBlur={(e) => saveRate(d, e.target.value)} /> : rate.toFixed(2)}</td>
                  <td>{amountFor(d, values).toFixed(2)}</td>
                </tr>
              );
            }) : <tr><td colSpan={dates.length + 4} className="empty">{t('panel.payroll.noDrivers')}</td></tr>}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="table-totals">
                <td>{t('panel.payroll.totalCareers')}</td>
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

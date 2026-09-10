import { useState } from 'react';
import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';
import { IconCalendar } from './icons';

// Formulario de reactivación: se muestra cuando el cliente está pausado
// sin una fecha de retorno futura ya definida.
export default function ResumeForm({ next, message, onConfirm }) {
  const [byDate, setByDate] = useState(false);
  const [resumeDate, setResumeDate] = useState('');

  return (
    <div className="col-12">
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">Reactivar servicio</h2>
        <p className="text-secondary">
          Elige cuándo quieres que se reactive. Puedes confirmarlo hasta las <b>22:00</b>.
        </p>
        <div className="row g-2 mb-3">
          <div className="col-sm-6">
            <input className="btn-check" type="radio" name="resume-mode" id="resume-mode-next" checked={!byDate} onChange={() => setByDate(false)} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="resume-mode-next">
              <span className="d-block fw-semibold">▶ Mañana mismo</span>
              <span className="d-block small text-secondary mt-1">Se reactiva el siguiente día laborable: {fmt(next)}.</span>
            </label>
          </div>
          <div className="col-sm-6">
            <input className="btn-check" type="radio" name="resume-mode" id="resume-mode-date" checked={byDate} onChange={() => setByDate(true)} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="resume-mode-date">
              <span className="d-block fw-semibold">{IconCalendar}Elegir fecha</span>
              <span className="d-block small text-secondary mt-1">Por ejemplo, si vuelves recién en un par de días.</span>
            </label>
          </div>
        </div>
        {byDate && (
          <div className="mb-3">
            <label className="form-label" htmlFor="resume-date">¿Qué día quieres reactivarla?</label>
            <input className="form-control" type="date" id="resume-date" min={next} value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary" onClick={() => onConfirm(byDate, resumeDate)}>
          Confirmar reactivación
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
    </div>
  );
}

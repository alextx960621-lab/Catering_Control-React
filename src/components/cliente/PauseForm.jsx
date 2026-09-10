import { useState } from 'react';
import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';
import { IconCalendar } from './icons';

// Formulario de pausa: se muestra cuando el cliente está activo.
export default function PauseForm({ next, message, onConfirm }) {
  const [mode, setMode] = useState('open'); // 'open' | 'tomorrow' | 'scheduled'
  const [returnDate, setReturnDate] = useState('');

  return (
    <div className="col-12">
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">Pausar servicio</h2>
        <p className="text-secondary">
          Elige cómo quieres pausar. Se aplica desde el siguiente día laborable: <b>{fmt(next)}</b>, y puedes confirmarlo hasta las <b>22:00</b>.
        </p>
        <div className="row g-2 mb-3">
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-open" checked={mode === 'open'} onChange={() => setMode('open')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-open">
              <span className="d-block fw-semibold">⏸ Pausa sin fecha</span>
              <span className="d-block small text-secondary mt-1">Reactivas cuando quieras, avisándonos por acá o por WhatsApp.</span>
            </label>
          </div>
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-tomorrow" checked={mode === 'tomorrow'} onChange={() => setMode('tomorrow')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-tomorrow">
              <span className="d-block fw-semibold">1️⃣ Solo mañana</span>
              <span className="d-block small text-secondary mt-1">Se pausa un solo día ({fmt(next)}) y se reactiva sola al siguiente.</span>
            </label>
          </div>
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-scheduled" checked={mode === 'scheduled'} onChange={() => setMode('scheduled')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-scheduled">
              <span className="d-block fw-semibold">{IconCalendar}Con fecha de retorno</span>
              <span className="d-block small text-secondary mt-1">Se reactiva sola el día que elijas, sin que tengas que avisar.</span>
            </label>
          </div>
        </div>
        {mode === 'scheduled' && (
          <div className="mb-3">
            <label className="form-label" htmlFor="return-date">¿Qué día quieres reactivarla?</label>
            <input className="form-control" type="date" id="return-date" min={next} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary" onClick={() => onConfirm(mode, returnDate)}>
          Confirmar pausa
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
    </div>
  );
}

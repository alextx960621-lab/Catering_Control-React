import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';
import { IconCalendar } from './icons';

// Formulario de pausa: se muestra cuando el cliente está activo
export default function PauseForm({ next, message, onConfirm }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('open'); // 'open' | 'tomorrow' | 'scheduled'
  const [returnDate, setReturnDate] = useState('');

  return (
    <div className="col-12">
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">{t('portal.pause.title')}</h2>
        <p className="text-secondary">
          {t('portal.pause.introA')}<b>{fmt(next)}</b>{t('portal.pause.introB')}<b>22:00</b>{t('portal.pause.introC')}
        </p>
        <div className="row g-2 mb-3">
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-open" checked={mode === 'open'} onChange={() => setMode('open')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-open">
              <span className="d-block fw-semibold">{t('portal.pause.modeOpenTitle')}</span>
              <span className="d-block small text-secondary mt-1">{t('portal.pause.modeOpenText')}</span>
            </label>
          </div>
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-tomorrow" checked={mode === 'tomorrow'} onChange={() => setMode('tomorrow')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-tomorrow">
              <span className="d-block fw-semibold">{t('portal.pause.modeTomorrowTitle')}</span>
              <span className="d-block small text-secondary mt-1">{t('portal.pause.modeTomorrowText', { date: fmt(next) })}</span>
            </label>
          </div>
          <div className="col-sm-4">
            <input className="btn-check" type="radio" name="pause-mode" id="pause-mode-scheduled" checked={mode === 'scheduled'} onChange={() => setMode('scheduled')} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="pause-mode-scheduled">
              <span className="d-block fw-semibold">{IconCalendar}{t('portal.pause.modeScheduledTitle')}</span>
              <span className="d-block small text-secondary mt-1">{t('portal.pause.modeScheduledText')}</span>
            </label>
          </div>
        </div>
        {mode === 'scheduled' && (
          <div className="mb-3">
            <label className="form-label" htmlFor="return-date">{t('portal.pause.returnLabel')}</label>
            <input className="form-control" type="date" id="return-date" min={next} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
        )}
        <button className="cc-btn cc-orange" onClick={() => onConfirm(mode, returnDate)}>
          {t('portal.pause.confirm')}
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';
import { IconCalendar } from './icons';

// Formulario de reactivación: se muestra cuando el cliente está pausado sin una fecha de…
export default function ResumeForm({ next, message, onConfirm }) {
  const { t } = useTranslation();
  const [byDate, setByDate] = useState(false);
  const [resumeDate, setResumeDate] = useState('');

  return (
    <div className="col-12">
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">{t('portal.resume.title')}</h2>
        <p className="text-secondary">
          {t('portal.resume.introA')}<b>22:00</b>{t('portal.resume.introB')}
        </p>
        <div className="row g-2 mb-3">
          <div className="col-sm-6">
            <input className="btn-check" type="radio" name="resume-mode" id="resume-mode-next" checked={!byDate} onChange={() => setByDate(false)} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="resume-mode-next">
              <span className="d-block fw-semibold">{t('portal.resume.modeNextTitle')}</span>
              <span className="d-block small text-secondary mt-1">{t('portal.resume.modeNextText', { date: fmt(next) })}</span>
            </label>
          </div>
          <div className="col-sm-6">
            <input className="btn-check" type="radio" name="resume-mode" id="resume-mode-date" checked={byDate} onChange={() => setByDate(true)} />
            <label className="pause-mode-card border d-block h-100 p-3" htmlFor="resume-mode-date">
              <span className="d-block fw-semibold">{IconCalendar}{t('portal.resume.modeDateTitle')}</span>
              <span className="d-block small text-secondary mt-1">{t('portal.resume.modeDateText')}</span>
            </label>
          </div>
        </div>
        {byDate && (
          <div className="mb-3">
            <label className="form-label" htmlFor="resume-date">{t('portal.resume.dateLabel')}</label>
            <input className="form-control" type="date" id="resume-date" min={next} value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} />
          </div>
        )}
        <button className="cc-btn cc-green" onClick={() => onConfirm(byDate, resumeDate)}>
          {t('portal.resume.confirm')}
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';
import { IconCheckCircle } from './icons';

// Se muestra cuando el cliente ya programó una fecha de retorno (futura)
export default function ScheduledResumeCard({ client, next, message, onAdvance }) {
  const { t } = useTranslation();
  return (
    <div className="col-12">
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">
          <span style={{ marginRight: 6, verticalAlign: '-3px', display: 'inline-block' }}>{IconCheckCircle}</span>
          {t('portal.scheduledResume.title')}
        </h2>
        <p className="text-secondary">
          {t('portal.scheduledResume.textBefore')}<b>{fmt(client.returnDate)}</b>{t('portal.scheduledResume.textAfter')}
        </p>
        <p className="text-secondary small mb-3">{t('portal.scheduledResume.hint')}</p>
        <button className="cc-btn cc-green cc-sm" onClick={onAdvance}>
          {t('portal.scheduledResume.advance', { date: fmt(next) })}
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
    </div>
  );
}

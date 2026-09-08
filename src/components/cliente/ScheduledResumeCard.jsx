import { fmt } from '../../services/planHelpers';
import MessageAlert from './MessageAlert';

// Se muestra cuando el cliente ya programó una fecha de retorno (futura).
export default function ScheduledResumeCard({ client, next, message, onAdvance }) {
  return (
    <article className="card shadow-sm border-0">
      <div className="card-body p-4">
        <h2 className="h5 mb-1">✅ Reactivación programada</h2>
        <p className="text-secondary">
          Tu servicio se reactivará automáticamente el <b>{fmt(client.returnDate)}</b>. No necesitas hacer nada más.
        </p>
        <p className="text-secondary small mb-3">¿Necesitas que sea antes? Puedes adelantarla al siguiente día laborable.</p>
        <button className="btn btn-outline-primary btn-sm" onClick={onAdvance}>
          Adelantar reactivación al {fmt(next)}
        </button>
        <MessageAlert message={message} />
      </div>
    </article>
  );
}

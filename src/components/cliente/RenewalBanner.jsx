import { n, renewalWarningDays } from '../../services/planHelpers';

// Se muestra solo cuando al cliente le quedan pocos días de plan y está
// activo (no tiene sentido avisarle de renovación si ya está pausado). El
// botón abre directamente el modal de renovación/cambio de plan, no un
// enlace a WhatsApp — así el cliente no tiene que volver a explicar nada.
export default function RenewalBanner({ client, branding, plan, state, remaining, onOpenPlanChange }) {
  const show = n(client.paidDays) > 0 && remaining <= renewalWarningDays(branding) && !['Pausado', 'Programado', 'No laborable'].includes(state);
  if (!show) return null;

  return (
    <section className="renewal-banner rounded-4 shadow-sm p-4 mb-3 d-flex align-items-center justify-content-between flex-wrap gap-3">
      <div className="d-flex align-items-center gap-3">
        <span className="bounce fs-1">🥤</span>
        <div>
          <span className="ribbon mb-2 d-inline-flex">
            {remaining <= 0 ? '¡Ya venció!' : remaining === 1 ? '¡Último día!' : `¡Solo ${remaining} días!`}
          </span>
          <h2 className="h5 mb-1 mt-2">{remaining <= 0 ? 'Tu plan ya terminó' : 'Tu plan está por terminar'}</h2>
          <p className="mb-0 opacity-90">
            {remaining <= 0 ? 'Renueva ahora para no perder tus entregas.' : 'Renueva ahora y no te quedes sin tus entregas.'} ¡Es rapidísimo! 🎉
          </p>
        </div>
      </div>
      <button className="btn btn-light rounded-pill px-4" onClick={onOpenPlanChange}>
        Quiero renovar
      </button>
    </section>
  );
}

import { n, statusClass, menuItemsList } from '../../services/planHelpers';

export default function PlanCard({ client, branding, plan, state, remaining, included }) {
  const items = menuItemsList(branding).filter(([key]) => n(included[key]) > 0);

  return (
    <div className="col-12 col-lg-8">
      <article className="card shadow-sm border-0 h-100 text-center">
        <div className="card-body p-4">
          {plan?.photoUrl && (
            <img
              loading="lazy"
              decoding="async"
              src={plan.photoUrl}
              alt={plan.name}
              style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 16, margin: '0 auto 12px' }}
            />
          )}
          <h2 className="h5">Tu plan actual</h2>
          <p className="h3 mb-1">{plan?.name || 'Plan sin asignar'}</p>
          <span className={`badge text-bg-${statusClass(state)} rounded-pill mb-4`}>{state}</span>

          <div className="row g-2 justify-content-center">
            <div className="col-4">
              <div className="metric p-3">
                <small className="text-secondary d-block">Días pagados</small>
                <strong className="fs-4">{n(client.paidDays)}</strong>
              </div>
            </div>
            <div className="col-4">
              <div className="metric p-3">
                <small className="text-secondary d-block">Consumidos</small>
                <strong className="fs-4">{n(client.consumedDays)}</strong>
              </div>
            </div>
            <div className="col-4">
              <div className="metric p-3">
                <small className="text-secondary d-block">Restantes</small>
                <strong className="fs-4">{remaining}</strong>
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-center flex-wrap gap-2 mt-4">
            {items.length ? (
              items.map(([key, label]) => {
                const icon = branding.itemIcons?.[key];
                return (
                  <span className="badge rounded-pill text-bg-light border" key={key}>
                    {icon && (
                      <img
                        loading="lazy"
                        decoding="async"
                        src={icon}
                        alt=""
                        style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: '50%', verticalAlign: -4, marginRight: 4 }}
                      />
                    )}
                    {n(included[key])} {label}
                  </span>
                );
              })
            ) : (
              <span className="text-secondary">Sin artículos registrados.</span>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

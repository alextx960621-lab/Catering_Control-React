import { waLink } from '../../services/planHelpers';

export default function SupportCard({ client, appConfig, branding }) {
  const wa = waLink(branding, appConfig, `Hola, soy ${client.name}. Quiero renovar o cambiar mi plan.`);

  return (
    <div className="col-lg-4">
      <article className="card shadow-sm border-0 h-100">
        <div className="card-body p-4 d-flex flex-column">
          <h2 className="h5">Atención al cliente</h2>
          <p className="text-secondary">Para renovar o cambiar tu plan, escríbenos directamente.</p>
          {wa !== '#' ? (
            <a className="btn btn-whatsapp mt-auto" href={wa} target="_blank" rel="noopener">
              Contactar por WhatsApp
            </a>
          ) : (
            <p className="text-secondary small mb-0">Contacta a tu proveedor para más información.</p>
          )}
        </div>
      </article>
    </div>
  );
}

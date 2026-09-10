export default function Hero({ client }) {
  return (
    <section className="hero rounded-4 shadow-sm p-4 mb-3 d-flex align-items-center justify-content-between gap-3">
      <div>
        <h1 className="h3 mb-1">Hola, {client.name}</h1>
        <p className="mb-0 opacity-75">Consulta tu plan y gestiona tus entregas.</p>
      </div>
      <div className="client-avatar rounded-circle d-flex align-items-center justify-content-center fw-bold fs-5">
        {(client.name || '?').slice(0, 1).toUpperCase()}
      </div>
    </section>
  );
}

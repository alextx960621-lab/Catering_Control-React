export default function PremiumPageLock({ featureLabel, premiumWhatsapp }) {
  const wa = premiumWhatsapp ? `https://wa.me/${premiumWhatsapp}?text=${encodeURIComponent(`Hola, quiero activar el plan Premium para desbloquear ${featureLabel}.`)}` : '';
  return (
    <div className="premium-lock">
      <div className="premium-lock-icon">🔒</div>
      <h2>{featureLabel} es una función Premium</h2>
      <p>Esta cuenta está en el plan Básico. Contacta a tu proveedor para activar el plan Premium y desbloquear esta función.</p>
      {wa && <a className="btn-premium" href={wa} target="_blank" rel="noopener">Contactar por WhatsApp</a>}
    </div>
  );
}

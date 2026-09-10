const WhatsappIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.386.702 4.607 1.912 6.47L4 29l7.72-1.877A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3zm0 21.75c-1.98 0-3.83-.55-5.41-1.5l-.388-.23-4.58 1.114 1.14-4.46-.253-.4A9.71 9.71 0 0 1 5.25 15c0-5.93 4.82-10.75 10.754-10.75S26.75 9.07 26.75 15 21.938 24.75 16.004 24.75zm5.98-8.06c-.328-.164-1.94-.957-2.24-1.066-.3-.11-.518-.164-.737.164-.218.328-.845 1.066-1.037 1.285-.19.218-.382.246-.71.082-.328-.164-1.385-.51-2.637-1.628-.975-.87-1.633-1.944-1.824-2.272-.19-.328-.02-.505.144-.668.148-.147.328-.383.492-.574.164-.19.218-.328.328-.546.11-.218.055-.41-.027-.574-.082-.164-.737-1.776-1.01-2.432-.266-.64-.537-.553-.737-.563l-.628-.012c-.218 0-.573.082-.873.41-.3.328-1.146 1.12-1.146 2.73 0 1.61 1.174 3.166 1.337 3.384.164.218 2.31 3.53 5.6 4.95.783.338 1.393.54 1.87.69.786.25 1.5.215 2.065.13.63-.094 1.94-.793 2.213-1.56.273-.766.273-1.423.19-1.56-.08-.14-.298-.22-.626-.383z" />
  </svg>
);

export default function WhatsappSupportButton({ whatsappNumber, brandName }) {
  const cleanNumber = String(whatsappNumber || '').replace(/\D/g, '');
  if (!cleanNumber) return null;

  const message = encodeURIComponent(`Hola, necesito ayuda para ingresar a ${brandName || 'Catering Control'}.`);

  return (
    <a
      className="btn w-100 mt-3 d-flex align-items-center justify-content-center gap-2"
      id="whatsapp-support-btn"
      href={`https://wa.me/${cleanNumber}?text=${message}`}
      target="_blank"
      rel="noopener"
      style={{ background: '#25D366', color: '#fff', fontWeight: 650 }}
    >
      {WhatsappIcon}
      <span>¿Necesitas ayuda? Contactanos</span>
    </a>
  );
}

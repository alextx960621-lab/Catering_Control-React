export default function AdBanner({ branding }) {
  if (!branding.adImageUrl) return null;
  return (
    <section className="ad-banner rounded-4 shadow-sm overflow-hidden mb-3">
      <img loading="lazy" decoding="async" src={branding.adImageUrl} alt="Publicidad" className="d-block" />
    </section>
  );
}

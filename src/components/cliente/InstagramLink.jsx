export default function InstagramLink({ branding, appConfig }) {
  const url = branding.instagramUrl || appConfig.instagramUrl;
  if (!url) return null;
  return (
    <div className="col-12">
      <a className="instagram d-flex align-items-center gap-3 rounded-4 p-3 shadow-sm" href={url} target="_blank" rel="noopener">
        <span className="fs-3">◎</span>
        <span>
          <b className="d-block">Seguinos en Instagram</b>
          <small>{branding.instagramHandle || appConfig.instagramHandle} · novedades, menús y bienestar</small>
        </span>
      </a>
    </div>
  );
}

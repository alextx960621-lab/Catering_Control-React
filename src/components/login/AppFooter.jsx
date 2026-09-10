import { Link } from 'react-router-dom';

// Footer legal: a propósito siempre muestra el nombre del SOFTWARE
// (Catering Control), nunca el de la empresa que lo usa (ese es el que
// varía por cliente y se muestra arriba, en brand-row/brand-info).
export default function AppFooter() {
  return (
    <footer className="app-footer text-secondary">
      <div className="app-footer-brand">
        <span>Catering Control™</span>
        <span className="app-footer-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.4 2.4 3.4-.4.4 3.4L21 10l-2.8 2.6.4 3.4-3.4-.4L12 18l-2.4-2.4-3.4.4-.4-3.4L3 10l2.8-2.6-.4-3.4 3.4.4z" />
            <path d="M9.8 12.2l1.6 1.6 3-3.4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Software verificado
        </span>
      </div>
      <div className="app-footer-links">
        <Link to="/terminos">Términos y condiciones</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/privacidad">Política de privacidad</Link>
      </div>
      <div className="app-footer-copy">© {new Date().getFullYear()} Catering Control™. Todos los derechos reservados.</div>
    </footer>
  );
}

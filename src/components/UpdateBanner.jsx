import { useSWUpdate } from '../hooks/useSWUpdate';
import './Banners.css';

export default function UpdateBanner() {
  const { needRefresh, dismiss, update } = useSWUpdate();
  if (!needRefresh) return null;

  return (
    <div role="alert" className="app-banner">
      <span>Hay una nueva versión de la app lista.</span>
      <div className="app-banner__actions">
        <button type="button" onClick={update} className="app-banner__btn-primary">
          Actualizar ahora
        </button>
        <button type="button" onClick={dismiss} aria-label="Cerrar aviso" className="app-banner__btn-secondary">
          Ahora no
        </button>
      </div>
    </div>
  );
}

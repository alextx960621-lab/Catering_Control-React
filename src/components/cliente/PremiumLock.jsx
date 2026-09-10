import { waLink } from '../../services/planHelpers';
import Header from './Header';
import LogoutButton from './LogoutButton';
import { IconLock } from './icons';

export default function PremiumLock({ branding, appConfig, onLogout }) {
  const wa = waLink(branding, appConfig, 'Hola, quiero activar el plan Premium para acceder al portal de clientes.');

  return (
    <>
      <LogoutButton onLogout={onLogout} />
      <Header branding={branding} appConfig={appConfig} showThemeSelect={false} />
      <div className="premium-lock">
        <div className="premium-lock-icon">{IconLock}</div>
        <h2>Portal de clientes es una función Premium</h2>
        <p>Esta cuenta está en el plan Básico. Contacta a tu proveedor para activar el plan Premium y desbloquear esta función.</p>
        {wa !== '#' && (
          <a className="btn-premium" href={wa} target="_blank" rel="noopener">
            Contactar por WhatsApp
          </a>
        )}
      </div>
    </>
  );
}

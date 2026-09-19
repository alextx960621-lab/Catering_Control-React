import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, setSessionToken } from '../../services/supabaseClient';
import { writeClientSession } from '../../services/session';
import { STORAGE_KEYS } from '../../services/storageKeys';

// `mode` lo controla LoginPage: 'login' muestra el formulario normal de
// carnet+teléfono; 'signup' muestra el de registro (botón "¿Eres nuevo?
// Regístrate" junto al de WhatsApp, sin necesidad de intentar iniciar
// sesión primero).
export default function ClientForm({ active, mode, onModeChange, onError, onClearError }) {
  const [carnet, setCarnet] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupAddress, setSignupAddress] = useState('');
  const navigate = useNavigate();

  function enterSession(client) {
    writeClientSession({ id: client.id, name: client.name, sessionToken: client.session_token });
    setSessionToken(client.session_token, 'cliente');
    navigate('/cliente');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    onClearError();
    setLoading(true);
    try {
      const cleanCarnet = carnet.trim();
      const cleanPhone = phone.replace(/\D/g, '');
      // login_cliente tiene candado de fuerza bruta: 3 intentos fallidos
      // seguidos con el mismo carnet bloquean 1 minuto (ver
      // supabase-login-cliente-lockout-migration.sql). El conteo vive en
      // la base, no acá, para que nadie lo salte llamando la función
      // directo por fuera de esta pantalla.
      const rows = await rpc('login_cliente', { p_carnet: cleanCarnet, p_phone: cleanPhone });
      const client = Array.isArray(rows) ? rows[0] : null;

      if (client?.locked_seconds > 0) {
        onError(`Demasiados intentos fallidos. Espera ${client.locked_seconds} segundos e intenta de nuevo.`);
        return;
      }
      if (!client) {
        onError('Carnet o teléfono no coinciden con un cliente registrado. Si eres nuevo, usa el botón "¿Eres nuevo? Regístrate" de abajo.');
        return;
      }

      enterSession(client);
    } catch (_) {
      onError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    onClearError();
    setLoading(true);
    try {
      const rows = await rpc('signup_cliente', {
        p_carnet: carnet.trim(),
        p_phone: phone.replace(/\D/g, ''),
        p_name: signupName.trim(),
        p_address: signupAddress.trim(),
      });
      const result = Array.isArray(rows) ? rows[0] : null;

      if (!result) {
        onError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
        return;
      }
      if (result.locked_seconds > 0) {
        onError(`Demasiados intentos. Espera ${result.locked_seconds} segundos e intenta de nuevo.`);
        return;
      }
      if (result.error) {
        onError(result.error);
        return;
      }

      try {
        sessionStorage.setItem(STORAGE_KEYS.clientSignupWelcome, '1');
      } catch (_) {
        /* si sessionStorage no está disponible, simplemente no se muestra el banner */
      }
      enterSession(result);
    } catch (_) {
      onError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'signup') {
    return (
      <form className={`form-panel${active ? ' active' : ''}`} onSubmit={handleSignup}>
        <p className="text-body-secondary small mb-3">
          Crea tu cuenta para ver tu portal. La ruta y el plan los asigna nuestro equipo — te contactaremos
          apenas revisemos tus datos.
        </p>
        <div className="mb-3">
          <label className="form-label" htmlFor="signup-name">
            Nombre completo
          </label>
          <input
            className="form-control"
            id="signup-name"
            autoComplete="name"
            placeholder="Ej. Juana Pérez"
            required
            value={signupName}
            onChange={(e) => setSignupName(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="signup-carnet">
            Carnet de identidad
          </label>
          <input
            className="form-control"
            id="signup-carnet"
            autoComplete="username"
            placeholder="Ej. 12345678"
            required
            value={carnet}
            onChange={(e) => setCarnet(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="signup-phone">
            Teléfono
          </label>
          <input
            className="form-control"
            id="signup-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            pattern="[0-9]*"
            placeholder="70000000"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="signup-address">
            Dirección (opcional)
          </label>
          <input
            className="form-control"
            id="signup-address"
            autoComplete="street-address"
            placeholder="Zona, calle y número"
            value={signupAddress}
            onChange={(e) => setSignupAddress(e.target.value)}
          />
        </div>
        <button className="btn btn-primary w-100" type="submit" disabled={loading}>
          {loading ? 'Creando cuenta…' : 'Crear mi cuenta'}
        </button>
        <button
          className="btn btn-link w-100 mt-2"
          type="button"
          onClick={() => {
            onModeChange('login');
            onClearError();
          }}
        >
          Ya tengo cuenta, iniciar sesión
        </button>
      </form>
    );
  }

  return (
    <form className={`form-panel${active ? ' active' : ''}`} onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label" htmlFor="client-carnet">
          Carnet de identidad
        </label>
        <input
          className="form-control"
          id="client-carnet"
          autoComplete="username"
          placeholder="Ej. 12345678"
          required
          value={carnet}
          onChange={(e) => setCarnet(e.target.value)}
        />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="client-phone">
          Teléfono
        </label>
        <input
          className="form-control"
          id="client-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          pattern="[0-9]*"
          placeholder="70000000"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <button className="btn btn-primary w-100" type="submit" disabled={loading}>
        {loading ? 'Entrando…' : 'Entrar a mi plan'}
      </button>
    </form>
  );
}

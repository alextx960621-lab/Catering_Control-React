import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, setSessionToken } from '../../services/supabaseClient';
import { writeClientSession } from '../../services/session';

export default function ClientForm({ active, onError, onClearError }) {
  const [carnet, setCarnet] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
        onError('Carnet o teléfono no coinciden con un cliente registrado.');
        return;
      }

      writeClientSession({ id: client.id, name: client.name, sessionToken: client.session_token });
      setSessionToken(client.session_token, 'cliente');
      navigate('/cliente');
    } catch (_) {
      onError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
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

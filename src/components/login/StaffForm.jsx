import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, setSessionToken } from '../../services/supabaseClient';
import { writeStaffSession } from '../../services/session';

export default function StaffForm({ active, onError, onClearError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    onClearError();
    setLoading(true);
    try {
      const rows = await rpc('login_staff', { p_email: email.trim(), p_password: password });
      const person = Array.isArray(rows) ? rows[0] : null;

      if (person?.locked_seconds > 0) {
        onError(`Demasiados intentos fallidos. Espera ${person.locked_seconds} segundos e intenta de nuevo.`);
        return;
      }

      const validPerson =
        person &&
        typeof person.id === 'string' && person.id.trim() &&
        typeof person.role === 'string' && person.role.trim() &&
        typeof person.session_token === 'string' && person.session_token.trim();

      if (!validPerson) {
        onError('Correo o contraseña incorrectos.');
        return;
      }

      writeStaffSession({
        id: person.id,
        name: person.name,
        role: person.role,
        routeId: person.routeId || '',
        driverId: person.driverId || '',
        sessionToken: person.session_token,
      });
      setSessionToken(person.session_token, 'staff');
      navigate('/panel');
    } catch (_) {
      onError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={`form-panel${active ? ' active' : ''}`} onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label" htmlFor="staff-email">
          Correo
        </label>
        <input
          className="form-control"
          id="staff-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="staff-pass">
          Contraseña
        </label>
        <div className="input-group">
          <input
            className="form-control"
            id="staff-pass"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="btn btn-outline-secondary"
            type="button"
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? '😆' : '😃'}
          </button>
        </div>
      </div>
      <button className="btn btn-primary w-100" type="submit" disabled={loading}>
        {loading ? 'Entrando…' : 'Entrar al panel'}
      </button>
    </form>
  );
}

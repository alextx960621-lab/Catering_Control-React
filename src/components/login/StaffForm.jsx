import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, setSessionToken } from '../../services/supabaseClient';
import { writeStaffSession } from '../../services/session';

const EyeIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a13.5 13.5 0 0 1-3.1 4.1M6.6 6.6C3.6 8.5 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.28 3.7-.75" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

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
            {showPassword ? EyeOffIcon : EyeIcon}
          </button>
        </div>
      </div>
      <button className="btn btn-primary w-100" type="submit" disabled={loading}>
        {loading ? 'Entrando…' : 'Entrar al panel'}
      </button>
    </form>
  );
}

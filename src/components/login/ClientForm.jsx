import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { rpc, setSessionToken } from '../../services/supabaseClient';
import { writeClientSession } from '../../services/session';
import { STORAGE_KEYS } from '../../services/storageKeys';

// El campo de carnet y el de teléfono son idénticos en el form de login y en el de alta;
// se extraen acá para no repetir el mismo bloque de label+input dos veces por form.
function CarnetField({ id, value, onChange, t }) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {t('login.idCard')}
      </label>
      <input className="form-control" id={id} autoComplete="username" placeholder={t('login.idCardPlaceholder')} required value={value} onChange={onChange} />
    </div>
  );
}

function PhoneField({ id, value, onChange, t }) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {t('login.phone')}
      </label>
      <input
        className="form-control"
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        pattern="[0-9]*"
        placeholder={t('login.phonePlaceholder')}
        required
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

// `mode` lo controla quien lo usa: 'login' muestra el formulario normal de carnet+teléfono…
export default function ClientForm({ active, mode, onModeChange, onError, onClearError, purchasePlan = null, idPrefix = '' }) {
  const { t } = useTranslation();
  const [carnet, setCarnet] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupAddress, setSignupAddress] = useState('');
  const navigate = useNavigate();

  function enterSession(client) {
    writeClientSession({ id: client.id, name: client.name, sessionToken: client.session_token });
    setSessionToken(client.session_token, 'cliente');
    if (purchasePlan?.id) {
      try {
        sessionStorage.setItem(STORAGE_KEYS.pendingPlanPurchase, purchasePlan.id);
      } catch {/* sin sessionStorage el portal simplemente abre normal, sin el pago directo */}
    }
    navigate('/cliente');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    onClearError();
    setLoading(true);
    try {
      const cleanCarnet = carnet.trim();
      const cleanPhone = phone.replace(/\D/g, '');
      // login_cliente tiene candado de fuerza bruta: 3 intentos fallidos seguidos con el mismo…
      const rows = await rpc('login_cliente', { p_carnet: cleanCarnet, p_phone: cleanPhone });
      const client = Array.isArray(rows) ? rows[0] : null;

      if (client?.locked_seconds > 0) {
        onError(t('login.tooManyAttempts', { seconds: client.locked_seconds }));
        return;
      }
      if (!client) {
        onError(purchasePlan ? t('login.clientNotFoundBuy') : t('login.clientNotFound'));
        return;
      }

      enterSession(client);
    } catch {
      onError(t('common.connectionError'));
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
        onError(t('common.connectionError'));
        return;
      }
      if (result.locked_seconds > 0) {
        onError(t('login.tooManyAttemptsSignup', { seconds: result.locked_seconds }));
        return;
      }
      if (result.error) {
        onError(result.error);
        return;
      }

      try {
        sessionStorage.setItem(STORAGE_KEYS.clientSignupWelcome, '1');
      } catch {/* si sessionStorage no está disponible, simplemente no se muestra el banner */}
      enterSession(result);
    } catch {
      onError(t('common.connectionError'));
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'signup') {
    return (
      <form className={`form-panel${active ? ' active' : ''}`} onSubmit={handleSignup}>
        <p className="text-body-secondary small mb-3">
          {purchasePlan
            ? t('login.signupIntroBuy', { plan: purchasePlan.name })
            : t('login.signupIntro')}
        </p>
        <div className="mb-3">
          <label className="form-label" htmlFor={`${idPrefix}signup-name`}>
            {t('login.fullName')}
          </label>
          <input
            className="form-control"
            id={`${idPrefix}signup-name`}
            autoComplete="name"
            placeholder={t('login.fullNamePlaceholder')}
            required
            value={signupName}
            onChange={(e) => setSignupName(e.target.value)}
          />
        </div>
        <CarnetField id={`${idPrefix}signup-carnet`} value={carnet} onChange={(e) => setCarnet(e.target.value)} t={t} />
        <PhoneField id={`${idPrefix}signup-phone`} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} t={t} />
        <div className="mb-3">
          <label className="form-label" htmlFor={`${idPrefix}signup-address`}>
            {t('login.addressOptional')}
          </label>
          <input
            className="form-control"
            id={`${idPrefix}signup-address`}
            autoComplete="street-address"
            placeholder={t('login.addressPlaceholder')}
            value={signupAddress}
            onChange={(e) => setSignupAddress(e.target.value)}
          />
        </div>
        <button className="cc-btn cc-blue w-100" type="submit" disabled={loading}>
          {loading ? t('login.creatingAccount') : purchasePlan ? t('login.createAccountBuy') : t('login.createAccount')}
        </button>
        {!purchasePlan && (
          <button
            className="cc-btn cc-red w-100 mt-2"
            type="button"
            onClick={() => {
              onModeChange('login');
              onClearError();
            }}
          >
            {t('login.alreadyHaveAccount')}
          </button>
        )}
      </form>
    );
  }

  return (
    <form className={`form-panel${active ? ' active' : ''}`} onSubmit={handleSubmit}>
      {purchasePlan && (
        <p className="text-body-secondary small mb-3">
          {t('login.buyLoginIntro', { plan: purchasePlan.name })}
        </p>
      )}
      <CarnetField id={`${idPrefix}client-carnet`} value={carnet} onChange={(e) => setCarnet(e.target.value)} t={t} />
      <PhoneField id={`${idPrefix}client-phone`} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} t={t} />
      <button className="cc-btn cc-blue w-100" type="submit" disabled={loading}>
        {loading ? t('login.entering') : purchasePlan ? t('login.enterAndBuy') : t('login.enterMyPlan')}
      </button>
    </form>
  );
}

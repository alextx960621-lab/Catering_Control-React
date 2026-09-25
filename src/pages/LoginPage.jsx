import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './LoginPage.css';
import { useTheme } from '../hooks/useTheme';
import { usePageBodyClass } from '../hooks/usePageBodyClass';
import { useBranding } from '../hooks/useBranding';
import { readStaffSession, readClientSession } from '../services/session';
import BrandMark from '../components/login/BrandMark';
import ThemeSelect from '../components/login/ThemeSelect';
import ShareAppButton from '../components/login/ShareAppButton';
import ClientForm from '../components/login/ClientForm';
import StaffForm from '../components/login/StaffForm';
import WhatsappSupportButton from '../components/login/WhatsappSupportButton';
import AppFooter from '../components/login/AppFooter';
import PlansTeaser from '../components/login/PlansTeaser';

export default function LoginPage() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  usePageBodyClass('page-login');
  const { name: brandName, logo: brandLogo, whatsappNumber } = useBranding();
  const [accessType, setAccessType] = useState('client');
  const [clientMode, setClientMode] = useState('login'); // 'login' | 'signup', solo aplica a accessType 'client'
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const redirected = useRef(false);

  // Título de la pestaña
  useEffect(() => {
    document.title = `${brandName} · ${t('login.tabTitle')}`;
  }, [brandName, t]);

  // Si ya había una sesión abierta (staff o cliente) guardada de antes, saltar directo a su…
  useEffect(() => {
    if (redirected.current) return;
    const existingStaff = readStaffSession();
    if (existingStaff) {
      redirected.current = true;
      navigate('/panel');
      return;
    }
    const existingClient = readClientSession();
    if (existingClient) {
      redirected.current = true;
      navigate('/cliente');
    }
  }, [navigate]);

  function selectAccessType(type) {
    setAccessType(type);
    setClientMode('login');
    setErrorMsg('');
  }

  return (
    <main className="container py-4 d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div className="row justify-content-center w-100">
        <div className="col-12 login-card">
          <section className="card shadow-lg border-0 rounded-4">
            <div className="card-body p-4 p-md-5">
              <div className="brand-row mb-4">
                <div className="brand-mark d-inline-flex align-items-center justify-content-center fs-2" id="brand-mark">
                  <BrandMark logo={brandLogo} name={brandName} />
                </div>
                <div className="brand-info">
                  <h1 className="h5 mb-1" id="brand-title">
                    {brandName}
                  </h1>
                  {/* Compartir solo se muestra en la app instalada (ver ShareAppButton), al lado del selector… */}
                  <div className="d-inline-flex align-items-center justify-content-center flex-wrap gap-2">
                    <ThemeSelect theme={theme} onChange={setTheme} />
                    <ShareAppButton brandName={brandName} />
                  </div>
                </div>
              </div>

              {/* Colores fijos en los 3 temas: el seleccionado en azul, el otro en gris, los dos con letra… */}
              <nav className="access-switch bg-body-tertiary rounded-pill p-1 mb-4" aria-label={t('login.accessTypeAria')}>
                <button
                  type="button"
                  className={`cc-btn ${accessType === 'client' ? 'cc-blue' : 'cc-slate'}`}
                  aria-pressed={accessType === 'client'}
                  onClick={() => selectAccessType('client')}
                >
                  {t('login.iAmClient')}
                </button>
                <button
                  type="button"
                  className={`cc-btn ${accessType === 'staff' ? 'cc-blue' : 'cc-slate'}`}
                  aria-pressed={accessType === 'staff'}
                  onClick={() => selectAccessType('staff')}
                >
                  {t('login.iAmStaff')}
                </button>
              </nav>

              <ClientForm
                active={accessType === 'client'}
                mode={clientMode}
                onModeChange={setClientMode}
                onError={setErrorMsg}
                onClearError={() => setErrorMsg('')}
              />
              <StaffForm active={accessType === 'staff'} onError={setErrorMsg} onClearError={() => setErrorMsg('')} />

              {errorMsg && (
                <div className="alert alert-danger mt-3 mb-0" role="alert">
                  {errorMsg}
                </div>
              )}

              {accessType === 'client' && clientMode === 'login' && (
                <button
                  type="button"
                  className="cc-btn cc-yellow w-100 mt-3"
                  onClick={() => {
                    setClientMode('signup');
                    setErrorMsg('');
                  }}
                >
                  {t('login.newHere')}
                </button>
              )}

              <WhatsappSupportButton whatsappNumber={whatsappNumber} brandName={brandName} />
            </div>
          </section>
        </div>
      </div>
      <div className="row justify-content-center w-100">
        <div className="col-12 landing-teasers">
          <PlansTeaser whatsappNumber={whatsappNumber} />
        </div>
      </div>
      <div className="row justify-content-center w-100">
        <div className="col-12 login-card">
          <AppFooter />
        </div>
      </div>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';
import { useTheme } from '../hooks/useTheme';
import { useBranding } from '../hooks/useBranding';
import { readStaffSession, readClientSession } from '../services/session';
import BrandMark from '../components/login/BrandMark';
import ThemeSelect from '../components/login/ThemeSelect';
import ShareAppButton from '../components/login/ShareAppButton';
import ClientForm from '../components/login/ClientForm';
import StaffForm from '../components/login/StaffForm';
import WhatsappSupportButton from '../components/login/WhatsappSupportButton';
import AppFooter from '../components/login/AppFooter';

export default function LoginPage() {
  const [theme, setTheme] = useTheme();
  const { name: brandName, logo: brandLogo, whatsappNumber } = useBranding();
  const [accessType, setAccessType] = useState('client');
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const redirected = useRef(false);

  // Título de la pestaña
  useEffect(() => {
    document.title = `${brandName} · Iniciar sesión`;
  }, [brandName]);

  // Si ya había una sesión abierta (staff o cliente) guardada de antes,
  // saltar directo a su pantalla en vez de mostrarle el login de nuevo.
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
                  <ThemeSelect theme={theme} onChange={setTheme} />
                </div>
                <ShareAppButton brandName={brandName} />
              </div>

              <nav className="nav nav-pills nav-fill bg-body-tertiary rounded-pill p-1 mb-4" aria-label="Tipo de acceso">
                <button
                  type="button"
                  className={`nav-link${accessType === 'client' ? ' active' : ''}`}
                  onClick={() => selectAccessType('client')}
                >
                  Soy cliente
                </button>
                <button
                  type="button"
                  className={`nav-link${accessType === 'staff' ? ' active' : ''}`}
                  onClick={() => selectAccessType('staff')}
                >
                  Soy del equipo
                </button>
              </nav>

              <ClientForm active={accessType === 'client'} onError={setErrorMsg} onClearError={() => setErrorMsg('')} />
              <StaffForm active={accessType === 'staff'} onError={setErrorMsg} onClearError={() => setErrorMsg('')} />

              {errorMsg && (
                <div className="alert alert-danger mt-3 mb-0" role="alert">
                  {errorMsg}
                </div>
              )}

              <WhatsappSupportButton whatsappNumber={whatsappNumber} brandName={brandName} />
            </div>
          </section>
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

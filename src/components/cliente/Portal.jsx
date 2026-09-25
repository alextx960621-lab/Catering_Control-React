import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { n, fmt, workDate, nextWorkDay, stateFor, planFor, waLink } from '../../services/planHelpers';
import { rpc, getSessionToken, dbInsertAudit } from '../../services/supabaseClient';
import { writeClientRow } from '../../services/clienteStorage';
import { STORAGE_KEYS } from '../../services/storageKeys';
import LogoutButton from './LogoutButton';
import Header from './Header';
import RenewalBanner from './RenewalBanner';
import PlanCard from './PlanCard';
import ScheduledResumeCard from './ScheduledResumeCard';
import ResumeForm from './ResumeForm';
import PauseForm from './PauseForm';
import AddressCard from './AddressCard';
import NoteCard from './NoteCard';
import RatingCard from './RatingCard';
import PlanChangeModal from './PlanChangeModal';

// Tarjetas y botones de una sola línea que solo usa este archivo: viven acá en vez de en su
// propio archivo para no tener un componente de 8-25 líneas por cada uno.
function Hero({ client }) {
  const { t } = useTranslation();
  return (
    <section className="hero rounded-4 shadow-sm p-4 mb-3 d-flex align-items-center justify-content-between gap-3">
      <div>
        <h1 className="h3 mb-1">{t('portal.hero.greeting', { name: client.name })}</h1>
        <p className="mb-0 opacity-75">{t('portal.hero.subtitle')}</p>
      </div>
      <div className="client-avatar rounded-circle d-flex align-items-center justify-content-center fw-bold fs-5">
        {(client.name || '?').slice(0, 1).toUpperCase()}
      </div>
    </section>
  );
}

function AdBanner({ branding }) {
  if (!branding.adImageUrl) return null;
  return (
    <section className="ad-banner rounded-4 shadow-sm overflow-hidden mb-3">
      <img loading="lazy" decoding="async" src={branding.adImageUrl} alt="Publicidad" className="d-block" />
    </section>
  );
}

function PlanChangeButton({ onOpen }) {
  const { t } = useTranslation();
  return (
    <div className="col-12">
      <button className="cc-btn cc-yellow w-100" onClick={onOpen}>
        {t('portal.planChangeButton')}
      </button>
    </div>
  );
}

function WeeklyMenuButton() {
  const { t } = useTranslation();
  return (
    <div className="col-12">
      <Link className="cc-btn cc-orange w-100" to="/menu-semanal">
        🍲 {t('portal.weeklyMenu')}
      </Link>
    </div>
  );
}

function SupportCard({ client, appConfig, branding }) {
  const { t } = useTranslation();
  const wa = waLink(branding, appConfig, t('portal.support.waMessage', { name: client.name }));
  return (
    <div className="col-12">
      <article className="card shadow-sm border-0 h-100">
        <div className="card-body p-4 d-flex flex-column">
          <h2 className="h5">{t('portal.support.title')}</h2>
          <p className="text-secondary">{t('portal.support.subtitle')}</p>
          {wa !== '#' ? (
            <a className="btn btn-whatsapp mt-auto" href={wa} target="_blank" rel="noopener">
              {t('portal.contactWhatsapp')}
            </a>
          ) : (
            <p className="text-secondary small mb-0">{t('portal.support.noWa')}</p>
          )}
        </div>
      </article>
    </div>
  );
}

function InstagramLink({ branding, appConfig }) {
  const { t } = useTranslation();
  const url = branding.instagramUrl || appConfig.instagramUrl;
  if (!url) return null;
  const handle = branding.instagramHandle || appConfig.instagramHandle;
  return (
    <div className="col-12">
      <a className="instagram d-flex align-items-center gap-3 rounded-4 p-3 shadow-sm" href={url} target="_blank" rel="noopener">
        <span className="fs-3">◎</span>
        <span>
          <b className="d-block">{t('portal.instagram.title')}</b>
          <small>{t('portal.instagram.subtitle', { handle })}</small>
        </span>
      </a>
    </div>
  );
}

// El portal completo, ya con todos los datos cargados
export default function Portal({ data, client, driver, appConfig, branding, theme, onThemeChange, onSaveClient, onLogout }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState(null);
  const [showPlanChange, setShowPlanChange] = useState(false);
  // Plan elegido en "Comprar" (Login): cuando el catálogo llega y el plan sigue disponible…
  const [pendingPlanId, setPendingPlanId] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.pendingPlanPurchase) || '';
    } catch {
      return '';
    }
  });
  const pendingPlan = pendingPlanId ? (data.plans || []).find((p) => p.id === pendingPlanId && p.availableForPurchase) : null;
  function closePlanChange() {
    setShowPlanChange(false);
    setPendingPlanId('');
    try {
      sessionStorage.removeItem(STORAGE_KEYS.pendingPlanPurchase);
    } catch {/* sin sessionStorage no queda nada que limpiar */}
  }
  const { blocked: pushBlocked } = usePushSubscription(!!client?.id);
  // se muestra una sola vez, justo después de que el propio cliente creó su cuenta desde el…
  const [showSignupWelcome] = useState(() => {
    try {
      const flagged = sessionStorage.getItem(STORAGE_KEYS.clientSignupWelcome) === '1';
      if (flagged) sessionStorage.removeItem(STORAGE_KEYS.clientSignupWelcome);
      return flagged;
    } catch {
      return false;
    }
  });

  const date = workDate(data);
  const next = nextWorkDay(data, date);
  const state = stateFor(data, client, date);
  const plan = planFor(data, client);
  const remaining = Math.max(0, n(client.paidDays) - n(client.consumedDays));
  const included = client.items && Object.keys(client.items).length ? client.items : plan?.items || {};

  function pastCutoff() {
    return new Date().getHours() >= 22;
  }

  async function handlePause(mode, returnDateInput) {
    if (pastCutoff()) {
      setMessage({
        text: t('portal.pauseMsg.cutoff'),
        error: true,
        showSupport: true,
        wa: waLink(branding, appConfig, t('portal.pauseMsg.wa', { name: client.name })),
      });
      return;
    }
    if (mode === 'scheduled' && !returnDateInput) {
      setMessage({ text: t('portal.pauseMsg.needReturnDate'), error: true });
      return;
    }
    const returnDate = mode === 'tomorrow' ? nextWorkDay(data, next) : mode === 'scheduled' ? returnDateInput : '';
    if (returnDate && returnDate <= next) {
      setMessage({ text: t('portal.pauseMsg.returnAfter'), error: true });
      return;
    }
    const updated = {
      ...client,
      pauseStart: next,
      returnDate,
      status: returnDate ? 'Programado' : 'Pausado',
      pauseDates: (client.pauseDates || []).filter((d) => d !== next),
    };
    const saved = await onSaveClient(updated);
    if (!saved) {
      setMessage({ text: t('portal.pauseMsg.saveFailed'), error: true });
      return;
    }
    dbInsertAudit({
      actor_id: client.id,
      actor_name: client.name,
      actor_role: 'cliente',
      action: 'Cliente pausó su servicio (autoservicio)',
      entity_type: 'client',
      entity_label: client.name,
      entity_id: client.id,
      details: { desde: next, retorno: returnDate || 'sin definir', modo: mode },
    });
    setMessage({
      text:
        mode === 'tomorrow'
          ? t('portal.pauseMsg.oneDay', { date: fmt(next), return: fmt(returnDate) })
          : returnDate
            ? t('portal.pauseMsg.scheduled', { from: fmt(next), to: fmt(returnDate) })
            : t('portal.pauseMsg.open', { from: fmt(next) }),
      error: false,
    });
  }

  async function handleResume(byDate, resumeDateInput) {
    if (pastCutoff()) {
      setMessage({
        text: t('portal.resumeMsg.cutoff'),
        error: true,
        showSupport: true,
        wa: waLink(branding, appConfig, t('portal.resumeMsg.wa', { name: client.name })),
      });
      return;
    }
    const target = byDate ? resumeDateInput : next;
    if (byDate && !target) {
      setMessage({ text: t('portal.resumeMsg.needDate'), error: true });
      return;
    }
    if (target < next) {
      setMessage({ text: t('portal.resumeMsg.dateInvalid'), error: true });
      return;
    }
    const updated = { ...client, returnDate: target, status: 'Programado' };
    const saved = await onSaveClient(updated);
    if (!saved) {
      setMessage({ text: t('portal.resumeMsg.saveFailed'), error: true });
      return;
    }
    dbInsertAudit({
      actor_id: client.id,
      actor_name: client.name,
      actor_role: 'cliente',
      action: 'Cliente reactivó su servicio (autoservicio)',
      entity_type: 'client',
      entity_label: client.name,
      entity_id: client.id,
      details: { reactivaDesde: target },
    });
    setMessage({ text: t('portal.resumeMsg.scheduled', { date: fmt(target) }), error: false });
  }

  async function handleAddressOverride(selectedAddressId) {
    if (pastCutoff()) {
      return { error: true, text: t('portal.addressMsg.cutoff') };
    }
    const result = await rpc('set_client_address_override', {
      p_token: getSessionToken(),
      p_client_id: client.id,
      p_address_id: selectedAddressId,
      p_date: next,
    });
    if (!result) {
      return { error: true, text: t('portal.addressMsg.saveFailed') };
    }
    const overrides = Array.isArray(result)
      ? result
      : (client.addressOverrides || []).filter((o) => o.date !== next).concat([{ date: next, addressId: selectedAddressId }]);
    const updated = { ...client, addressOverrides: overrides };
    writeClientRow(updated);
    onSaveClient(updated, true); // true = solo actualizar en memoria, ya se guardó server-side…
    dbInsertAudit({
      actor_id: client.id,
      actor_name: client.name,
      actor_role: 'cliente',
      action: 'Cliente cambió su dirección de entrega (autoservicio)',
      entity_type: 'client',
      entity_label: client.name,
      entity_id: client.id,
      details: { fecha: next, addressId: selectedAddressId },
    });
    return { error: false, text: t('portal.addressMsg.saved') };
  }

  return (
    <>
      <LogoutButton onLogout={onLogout} />
      <Header branding={branding} appConfig={appConfig} theme={theme} onThemeChange={onThemeChange} showThemeSelect />
      {showSignupWelcome && (
        <div className="alert alert-success mt-3 mb-0">
          {t('portal.signupWelcome')}
        </div>
      )}
      {pushBlocked && (
        <div className="alert alert-warning mt-3 mb-0 small">
          {t('portal.pushBlocked')}
        </div>
      )}
      <Hero client={client} />
      <AdBanner branding={branding} />
      <RenewalBanner client={client} branding={branding} plan={plan} state={state} remaining={remaining} onOpenPlanChange={() => setShowPlanChange(true)} />
      <section className="row g-3">
        <PlanCard client={client} branding={branding} plan={plan} state={state} remaining={remaining} included={included} />
        <PlanChangeButton onOpen={() => setShowPlanChange(true)} />
        <WeeklyMenuButton />
        <SupportCard client={client} appConfig={appConfig} branding={branding} />
        <div className="col-12">
          {state === 'Pausado' ? (
            client.returnDate && client.returnDate > date ? (
              <ScheduledResumeCard client={client} next={next} message={message} onAdvance={() => handleResume(false)} />
            ) : (
              <ResumeForm next={next} message={message} onConfirm={handleResume} />
            )
          ) : (
            <PauseForm next={next} message={message} onConfirm={handlePause} />
          )}
        </div>
        <AddressCard
          client={client}
          driver={driver}
          data={data}
          appConfig={appConfig}
          branding={branding}
          next={next}
          onSaveClient={onSaveClient}
          onSaveTomorrowOverride={handleAddressOverride}
        />
        <NoteCard client={client} />
        <RatingCard client={client} />
        <InstagramLink branding={branding} appConfig={appConfig} />
      </section>
      <PlanChangeModal show={showPlanChange || !!pendingPlan} onClose={closePlanChange} data={data} client={client} appConfig={appConfig} branding={branding} plan={plan} initialPlanId={pendingPlan?.id || ''} />
    </>
  );
}

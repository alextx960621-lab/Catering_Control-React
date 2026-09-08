import { useState } from 'react';
import { n, fmt, workDate, nextWorkDay, stateFor, planFor, waLink } from '../../services/planHelpers';
import { rpc, getSessionToken, dbInsertAudit } from '../../services/supabaseClient';
import { writeClientRow } from '../../services/clienteStorage';
import LogoutButton from './LogoutButton';
import Header from './Header';
import Hero from './Hero';
import AdBanner from './AdBanner';
import RenewalBanner from './RenewalBanner';
import PlanCard from './PlanCard';
import SupportCard from './SupportCard';
import ScheduledResumeCard from './ScheduledResumeCard';
import ResumeForm from './ResumeForm';
import PauseForm from './PauseForm';
import AddressCard from './AddressCard';
import NoteCard from './NoteCard';
import InstagramLink from './InstagramLink';
import PlanChangeButton from './PlanChangeButton';
import PlanChangeModal from './PlanChangeModal';

// El portal completo, ya con todos los datos cargados. Todas las acciones
// (pausar, reactivar, cambiar dirección) se confirman antes de las 22:00 —
// después de esa hora el despacho del día siguiente ya se está preparando,
// así que un cambio de último minuto tiene que pasar por Atención al
// Cliente en vez de aplicarse solo.
export default function Portal({ data, client, appConfig, branding, theme, onThemeChange, onSaveClient, onLogout }) {
  const [message, setMessage] = useState(null); // { text, error, showSupport, wa }
  const [showPlanChange, setShowPlanChange] = useState(false);

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
        text: 'Ya pasó el horario de pausa automática. Ponte en contacto con Atención al Cliente.',
        error: true,
        showSupport: true,
        wa: waLink(branding, appConfig, `Hola, soy ${client.name}. Necesito solicitar una pausa de mi servicio.`),
      });
      return;
    }
    if (mode === 'scheduled' && !returnDateInput) {
      setMessage({ text: 'Selecciona una fecha de retorno para esta opción.', error: true });
      return;
    }
    const returnDate = mode === 'tomorrow' ? nextWorkDay(data, next) : mode === 'scheduled' ? returnDateInput : '';
    if (returnDate && returnDate <= next) {
      setMessage({ text: 'La fecha de retorno debe ser posterior al día pausado.', error: true });
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
      setMessage({ text: 'No se pudo guardar la pausa en la base de datos. Intenta nuevamente.', error: true });
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
          ? `Pausa de un solo día (${fmt(next)}). Se reactiva sola el ${fmt(returnDate)}.`
          : returnDate
            ? `Pausa programada desde el ${fmt(next)} hasta el ${fmt(returnDate)}.`
            : `Pausa abierta desde el ${fmt(next)} sin fecha de retorno.`,
      error: false,
    });
  }

  async function handleResume(byDate, resumeDateInput) {
    if (pastCutoff()) {
      setMessage({
        text: 'Ya pasó el horario de reactivación automática. Ponte en contacto con Atención al Cliente.',
        error: true,
        showSupport: true,
        wa: waLink(branding, appConfig, `Hola, soy ${client.name}. Necesito reactivar mi servicio.`),
      });
      return;
    }
    const target = byDate ? resumeDateInput : next;
    if (byDate && !target) {
      setMessage({ text: 'Selecciona una fecha de reactivación.', error: true });
      return;
    }
    if (target < next) {
      setMessage({ text: 'La fecha de reactivación debe ser el siguiente día laborable o una posterior.', error: true });
      return;
    }
    const updated = { ...client, returnDate: target, status: 'Programado' };
    const saved = await onSaveClient(updated);
    if (!saved) {
      setMessage({ text: 'No se pudo guardar la reactivación en la base de datos. Intenta nuevamente.', error: true });
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
    setMessage({ text: `Reactivación programada para el ${fmt(target)}.`, error: false });
  }

  async function handleAddressOverride(selectedAddressId) {
    if (pastCutoff()) {
      return { error: true, text: 'Ya pasó el horario para cambiar la dirección de mañana. Ponte en contacto con Atención al Cliente.' };
    }
    const result = await rpc('set_client_address_override', {
      p_token: getSessionToken(),
      p_client_id: client.id,
      p_address_id: selectedAddressId,
      p_date: next,
    });
    if (!result) {
      return { error: true, text: 'No se pudo guardar. Intenta nuevamente o contáctanos por WhatsApp.' };
    }
    const overrides = Array.isArray(result)
      ? result
      : (client.addressOverrides || []).filter((o) => o.date !== next).concat([{ date: next, addressId: selectedAddressId }]);
    const updated = { ...client, addressOverrides: overrides };
    writeClientRow(updated);
    onSaveClient(updated, true); // true = solo actualizar en memoria, ya se guardó server-side arriba
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
    return { error: false, text: 'Guardado. Se usará esa dirección para el pedido de mañana.' };
  }

  return (
    <>
      <LogoutButton onLogout={onLogout} />
      <Header branding={branding} appConfig={appConfig} theme={theme} onThemeChange={onThemeChange} showThemeSelect />
      <Hero client={client} />
      <AdBanner branding={branding} />
      <RenewalBanner client={client} appConfig={appConfig} branding={branding} plan={plan} state={state} remaining={remaining} />
      <section className="row g-3">
        <PlanCard client={client} branding={branding} plan={plan} state={state} remaining={remaining} included={included} />
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
          data={data}
          appConfig={appConfig}
          branding={branding}
          next={next}
          onSaveClient={onSaveClient}
          onSaveTomorrowOverride={handleAddressOverride}
        />
        <NoteCard client={client} />
        <PlanChangeButton onOpen={() => setShowPlanChange(true)} />
        <InstagramLink branding={branding} appConfig={appConfig} />
      </section>
      <PlanChangeModal show={showPlanChange} onClose={() => setShowPlanChange(false)} data={data} client={client} appConfig={appConfig} branding={branding} plan={plan} />
    </>
  );
}

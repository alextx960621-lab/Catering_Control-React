import { useEffect, useRef, useState } from 'react';
import { rpc, getSessionToken, supabase } from '../../services/supabaseClient';
import { uploadReceipt } from '../../services/receiptUpload';
import { waLink } from '../../services/planHelpers';
import { IconCheckCircle } from './icons';

export default function PlanChangeModal({ show, onClose, data, client, appConfig, branding, plan }) {
  const [step, setStep] = useState('choose'); // choose | newplan | pay | sent
  const [requestType, setRequestType] = useState(null); // renew | newplan
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [autoApproved, setAutoApproved] = useState(false);
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (show) { setStep('choose'); setRequestType(null); setSelectedPlanId(''); setFile(null); setError(''); setAutoApproved(false); }
  }, [show]);

  // Accesibilidad del modal: guarda el foco previo, lo mueve al diálogo,
  // bloquea el scroll de fondo y cierra con Escape — igual que cualquier
  // modal nativo de Bootstrap, pero manejado a mano porque el diálogo se
  // arma con React en vez de con el JS de Bootstrap.
  useEffect(() => {
    if (!show) return;
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [show]);

  if (!show) return null;

  const availablePlans = (data.plans || []).filter((p) => p.availableForPurchase);
  const targetPlan = requestType === 'renew' ? plan : availablePlans.find((p) => p.id === selectedPlanId);

  function chooseRenew() { setRequestType('renew'); setStep('pay'); }
  function choosePlan(p) { setRequestType('newplan'); setSelectedPlanId(p.id); setStep('pay'); }

  async function handleDownloadQr() {
    try {
      const res = await fetch(branding.paymentQrUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qr-pago.jpg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (_) {
      window.open(branding.paymentQrUrl, '_blank');
    }
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (f && f.type !== 'application/pdf' && !f.type?.startsWith('image/')) {
      setError('Solo se aceptan imágenes o PDF.');
      return;
    }
    setError('');
    setFile(f || null);
  }

  async function handleSubmit() {
    if (!file) { setError('Sube una imagen o PDF de tu comprobante antes de enviar.'); return; }
    if (!targetPlan?.cost) { setError('No se pudo determinar el monto a pagar. Contáctanos por WhatsApp.'); return; }
    setSending(true);
    setError('');

    let uploaded;
    try {
      uploaded = await uploadReceipt(file, client.id);
    } catch (err) {
      setError(err?.message || 'No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.');
      setSending(false);
      return;
    }
    if (!uploaded) {
      setError('No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.');
      setSending(false);
      return;
    }

    const label = requestType === 'renew' ? `renovar su plan actual ("${plan?.name || 'sin plan'}")` : `cambiar al plan "${targetPlan?.name || ''}"`;
    const amountText = `Bs ${targetPlan.cost}`;
    const text = `Solicitud de plan: ${client.name} quiere ${label}. Monto: ${amountText}. Comprobante: ${uploaded.url}`;

    const result = await rpc('cliente_crear_comprobante', {
      p_token: getSessionToken(),
      p_client_id: client.id,
      p_texto: text,
      p_tipo: requestType === 'renew' ? 'renovacion' : 'plan_nuevo',
      p_plan_id: targetPlan.id,
      p_plan_nombre: targetPlan.name || '',
      p_dias: targetPlan.serviceDays || 1,
      p_monto_esperado: targetPlan.cost,
      p_storage_path: uploaded.path,
      p_mime_type: uploaded.mimeType,
    });
    if (!result?.comprobanteId) {
      setError('No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.');
      setSending(false);
      return;
    }

    // Verificación automática: si no responde a tiempo o falla, no es un
    // error para el cliente -- el comprobante ya quedó guardado y el staff
    // lo revisa a mano, como pasaba siempre hasta ahora.
    try {
      const { data } = await supabase.functions.invoke('verificar-comprobante', {
        body: { p_token: getSessionToken(), p_comprobante_id: result.comprobanteId },
      });
      setAutoApproved(data?.estado === 'aprobado_auto');
    } catch (_) {
      setAutoApproved(false);
    }

    setSending(false);
    setStep('sent');
  }

  const wa = waLink(branding, appConfig, `Hola, soy ${client.name}. Tuve un problema al subir mi comprobante de pago.`);

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div
        className="modal fade show"
        style={{ display: 'block' }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-modal-title"
        ref={dialogRef}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content rounded-4">
            <div className="modal-header">
              <h5 className="modal-title" id="plan-modal-title">{step === 'sent' ? '¡Listo!' : '¿Quieres renovar o cambiar de plan?'}</h5>
              <button type="button" className="btn-close" aria-label="Cerrar" onClick={onClose} />
            </div>
            <div className="modal-body">
              {step === 'choose' && (
                <div className="d-grid gap-2">
                  <button className="btn btn-primary" onClick={chooseRenew}>Quiero renovar mi plan</button>
                  <button className="btn btn-outline-primary" onClick={() => setStep('newplan')}>Quiero un nuevo plan</button>
                </div>
              )}
              {step === 'newplan' && (
                <div className="d-grid gap-2">
                  {availablePlans.length ? availablePlans.map((p) => (
                    <button key={p.id} className="btn plan-pick-btn text-start" onClick={() => choosePlan(p)}>
                      <b>{p.name}</b>
                      {p.cost ? <span className="float-end">{`Bs ${p.cost}`}</span> : null}
                    </button>
                  )) : <p className="text-secondary mb-0">Por ahora no hay planes disponibles para elegir. Contáctanos directamente.</p>}
                  <button className="btn btn-outline-secondary" onClick={() => setStep('choose')}>← Volver</button>
                </div>
              )}
              {step === 'pay' && (
                <div>
                  <p className="mb-1">{requestType === 'renew' ? 'Vas a renovar tu plan actual: ' : 'Vas a cambiar al plan: '}<b>{targetPlan?.name || '—'}</b></p>
                  <p className="h4 mb-3">{targetPlan?.cost ? `Bs ${targetPlan.cost}` : 'Monto a confirmar con el equipo'}</p>
                  {branding.paymentQrUrl ? (
                    <div className="text-center mb-3">
                      <img src={branding.paymentQrUrl} alt="QR de pago" style={{ maxWidth: 220, width: '100%' }} className="rounded-3 border mb-2" />
                      <p className="text-secondary small mb-2">Paga a este QR y sube tu comprobante.</p>
                      <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={handleDownloadQr}>Descargar QR</button>
                    </div>
                  ) : <p className="text-secondary small">El equipo aún no cargó un QR de pago. Contáctanos para coordinar el pago.</p>}
                  <label className="form-label small text-secondary">Comprobante de pago (imagen o PDF)</label>
                  <input type="file" accept="image/*,application/pdf" className="form-control mb-3" onChange={handleFile} />
                  {error && <div className="alert alert-danger py-2 small">{error}</div>}
                  <div className="d-flex gap-2">
                    <button className="btn btn-outline-secondary" onClick={() => setStep(requestType === 'renew' ? 'choose' : 'newplan')}>← Volver</button>
                    <button className="btn btn-primary ms-auto" onClick={handleSubmit} disabled={sending}>{sending ? 'Enviando…' : 'Enviar comprobante'}</button>
                  </div>
                </div>
              )}
              {step === 'sent' && (
                <div className="text-center py-2">
                  <span className="fs-1 d-block mb-2 text-success">{IconCheckCircle}</span>
                  {autoApproved ? (
                    <>
                      <p className="mb-1">¡Tu pago ya fue verificado! 🎉</p>
                      <p className="text-secondary small">Tu plan ya está activo, no hace falta que esperes a que el equipo lo revise.</p>
                    </>
                  ) : (
                    <>
                      <p className="mb-1">El equipo está procesando tu solicitud.</p>
                      <p className="text-secondary small">Te vamos a contactar en cuanto la revisemos.</p>
                    </>
                  )}
                  {wa !== '#' && <p className="small">¿Urgente? <a className="link-whatsapp" href={wa} target="_blank" rel="noopener">Escríbenos por WhatsApp</a></p>}
                  <button className="btn btn-primary mt-2" onClick={onClose}>Cerrar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

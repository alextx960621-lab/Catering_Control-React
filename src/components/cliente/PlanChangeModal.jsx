import { useEffect, useState } from 'react';
import { rpc, getSessionToken } from '../../services/supabaseClient';
import { uploadImage } from '../../services/imageUpload';
import { waLink } from '../../services/planHelpers';

export default function PlanChangeModal({ show, onClose, data, client, appConfig, branding, plan }) {
  const [step, setStep] = useState('choose'); // choose | newplan | pay | sent
  const [requestType, setRequestType] = useState(null); // renew | newplan
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (show) { setStep('choose'); setRequestType(null); setSelectedPlanId(''); setFile(null); setError(''); }
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
    if (f && !f.type?.startsWith('image/')) { setError('Solo se aceptan imágenes (no PDF ni otros archivos).'); return; }
    setError('');
    setFile(f || null);
  }

  async function handleSubmit() {
    if (!file) { setError('Sube una imagen de tu comprobante antes de enviar.'); return; }
    setSending(true);
    setError('');
    const url = await uploadImage(file, 'comprobantes', '', 1100, 0.72);
    if (!url) {
      setError('No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.');
      setSending(false);
      return;
    }
    const label = requestType === 'renew' ? `renovar su plan actual ("${plan?.name || 'sin plan'}")` : `cambiar al plan "${targetPlan?.name || ''}"`;
    const amountText = targetPlan?.cost ? `Bs ${targetPlan.cost}` : 'monto no definido';
    const text = `Solicitud de plan: ${client.name} quiere ${label}. Monto: ${amountText}. Comprobante: ${url}`;
    const result = await rpc('crear_nota_cliente', { p_token: getSessionToken(), p_client_id: client.id, p_texto: text });
    setSending(false);
    if (!result) { setError('No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.'); return; }
    setStep('sent');
  }

  const wa = waLink(branding, appConfig, `Hola, soy ${client.name}. Tuve un problema al subir mi comprobante de pago.`);

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} role="dialog">
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content rounded-4">
            <div className="modal-header">
              <h5 className="modal-title">{step === 'sent' ? '¡Listo!' : '¿Quieres renovar o cambiar de plan?'}</h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {step === 'choose' && (
                <div className="d-grid gap-2">
                  <button className="btn btn-primary btn-lg" onClick={chooseRenew}>Quiero renovar mi plan</button>
                  <button className="btn btn-outline-primary btn-lg" onClick={() => setStep('newplan')}>Quiero un nuevo plan</button>
                </div>
              )}
              {step === 'newplan' && (
                <div className="d-grid gap-2">
                  {availablePlans.length ? availablePlans.map((p) => (
                    <button key={p.id} className="btn btn-outline-primary btn-lg text-start" onClick={() => choosePlan(p)}>
                      <b>{p.name}</b>
                      {p.cost ? <span className="float-end">{`Bs ${p.cost}`}</span> : null}
                    </button>
                  )) : <p className="text-secondary mb-0">Por ahora no hay planes disponibles para elegir. Contáctanos directamente.</p>}
                  <button className="btn btn-danger" onClick={() => setStep('choose')}>← Volver</button>
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
                  <label className="form-label small text-secondary">Comprobante de pago (solo imagen)</label>
                  <input type="file" accept="image/*" className="form-control mb-3" onChange={handleFile} />
                  {error && <div className="alert alert-danger py-2 small">{error}</div>}
                  <div className="d-flex gap-2">
                    <button className="btn btn-danger" onClick={() => setStep(requestType === 'renew' ? 'choose' : 'newplan')}>← Volver</button>
                    <button className="btn btn-primary ms-auto" onClick={handleSubmit} disabled={sending}>{sending ? 'Enviando…' : 'Enviar comprobante'}</button>
                  </div>
                </div>
              )}
              {step === 'sent' && (
                <div className="text-center py-2">
                  <span className="fs-1 d-block mb-2">✅</span>
                  <p className="mb-1">El equipo está procesando tu solicitud.</p>
                  <p className="text-secondary small">Te vamos a contactar en cuanto la revisemos.</p>
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

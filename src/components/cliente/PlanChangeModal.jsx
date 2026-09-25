import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc, getSessionToken, supabase } from '../../services/supabaseClient';
import { uploadReceipt } from '../../services/receiptUpload';
import { waLink } from '../../services/planHelpers';
import { useCompanyPrefs } from '../../context/CompanyPrefsContext';
import { IconCheckCircle } from './icons';

// `initialPlanId`: plan elegido en "Comprar" desde el Login; si está disponible, el modal…
export default function PlanChangeModal({ show, onClose, data, client, appConfig, branding, plan, initialPlanId = '' }) {
  const { t } = useTranslation();
  const { formatMoney } = useCompanyPrefs();
  const [step, setStep] = useState('choose'); // choose | newplan | pay | sent
  const [requestType, setRequestType] = useState(null); // renew | newplan
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [autoApproved, setAutoApproved] = useState(false);
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  const [prevShow, setPrevShow] = useState(show);
  if (show !== prevShow) {
    setPrevShow(show);
    if (show) {
      const preselected = initialPlanId && (data.plans || []).find((p) => p.id === initialPlanId && p.availableForPurchase);
      setStep(preselected ? 'pay' : 'choose');
      setRequestType(preselected ? 'newplan' : null);
      setSelectedPlanId(preselected ? preselected.id : '');
      setFile(null); setError(''); setAutoApproved(false);
    }
  }

  // Accesibilidad del modal: guarda el foco previo, lo mueve al diálogo, bloquea el scroll de…
  useEffect(() => {
    if (!show) return;
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show, onClose]);

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
    } catch {
      window.open(branding.paymentQrUrl, '_blank');
    }
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (f && f.type !== 'application/pdf' && !f.type?.startsWith('image/')) {
      setError(t('portal.change.onlyImagesPdf'));
      return;
    }
    setError('');
    setFile(f || null);
  }

  async function handleSubmit() {
    if (!file) { setError(t('portal.change.needReceipt')); return; }
    if (!targetPlan?.cost) { setError(t('portal.change.amountUnknown')); return; }
    setSending(true);
    setError('');

    let uploaded;
    try {
      uploaded = await uploadReceipt(file, client.id);
    } catch (err) {
      setError(err?.message || t('portal.change.sendFailed'));
      setSending(false);
      return;
    }
    if (!uploaded) {
      setError(t('portal.change.sendFailed'));
      setSending(false);
      return;
    }

    const action = requestType === 'renew'
      ? t('portal.change.actionRenew', { plan: plan?.name || t('portal.change.noPlan') })
      : t('portal.change.actionNew', { plan: targetPlan?.name || '' });
    const amountText = formatMoney(targetPlan.cost);
    const text = t('portal.change.requestSummary', { name: client.name, action, amount: amountText });

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
      setError(t('portal.change.sendFailed'));
      setSending(false);
      return;
    }

    // Verificación automática: si no responde a tiempo o falla, no es un error para el cliente…
    try {
      const { data } = await supabase.functions.invoke('verificar-comprobante', {
        body: { p_token: getSessionToken(), p_comprobante_id: result.comprobanteId },
      });
      setAutoApproved(data?.estado === 'aprobado_auto');
    } catch {
      setAutoApproved(false);
    }

    setSending(false);
    setStep('sent');
  }

  const wa = waLink(branding, appConfig, t('portal.change.waProblem', { name: client.name }));
  // Cliente que todavía no tenía ningún plan (recién registrado): su primera compra
  const isFirstPlan = requestType === 'newplan' && !client.planId;

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
              <h5 className="modal-title" id="plan-modal-title">{step === 'sent' ? t('portal.change.done') : t('portal.change.title')}</h5>
              <button type="button" className="btn-close" aria-label={t('common.close')} onClick={onClose} />
            </div>
            <div className="modal-body">
              {step === 'choose' && (
                <div className="d-grid gap-2">
                  <button className="cc-btn cc-yellow" onClick={chooseRenew}>{t('portal.change.wantRenew')}</button>
                  <button className="cc-btn cc-red" onClick={() => setStep('newplan')}>{t('portal.change.wantNew')}</button>
                </div>
              )}
              {step === 'newplan' && (
                <div className="d-grid gap-2">
                  {availablePlans.length ? availablePlans.map((p) => (
                    <button key={p.id} className="btn plan-pick-btn text-start" onClick={() => choosePlan(p)}>
                      <b>{p.name}</b>
                      {p.cost ? <span className="float-end">{formatMoney(p.cost)}</span> : null}
                    </button>
                  )) : <p className="text-secondary mb-0">{t('portal.change.noPlans')}</p>}
                  <button className="cc-btn cc-red" onClick={() => setStep('choose')}>{t('common.back')}</button>
                </div>
              )}
              {step === 'pay' && (
                <div>
                  <p className="mb-1">{requestType === 'renew' ? t('portal.change.willRenew') : t('portal.change.willChange')}<b>{targetPlan?.name || '—'}</b></p>
                  <p className="h4 mb-3">{targetPlan?.cost ? formatMoney(targetPlan.cost) : t('portal.change.amountTbd')}</p>
                  {branding.paymentQrUrl ? (
                    <div className="text-center mb-3">
                      <img src={branding.paymentQrUrl} alt={t('portal.change.qrAlt')} style={{ maxWidth: 220, width: '100%' }} className="rounded-3 border mb-2" />
                      <p className="text-secondary small mb-2">{t('portal.change.qrHint')}</p>
                      <button type="button" className="cc-btn cc-blue cc-sm mb-3" onClick={handleDownloadQr}>{t('portal.change.downloadQr')}</button>
                    </div>
                  ) : <p className="text-secondary small">{t('portal.change.noQr')}</p>}
                  <label className="form-label small text-secondary">{t('portal.change.receiptLabel')}</label>
                  <input type="file" accept="image/*,application/pdf" className="form-control mb-3" onChange={handleFile} />
                  {error && <div className="alert alert-danger py-2 small">{error}</div>}
                  <div className="d-flex gap-2">
                    <button className="cc-btn cc-red" onClick={() => setStep(requestType === 'renew' ? 'choose' : 'newplan')}>{t('common.back')}</button>
                    <button className="cc-btn cc-green ms-auto" onClick={handleSubmit} disabled={sending}>{sending ? t('portal.change.sending') : t('portal.change.sendReceipt')}</button>
                  </div>
                </div>
              )}
              {step === 'sent' && (
                <div className="text-center py-2">
                  <span className="fs-1 d-block mb-2 text-success">{IconCheckCircle}</span>
                  {autoApproved ? (
                    <>
                      <p className="mb-1">{t('portal.change.verifiedTitle')}</p>
                      {isFirstPlan ? (
                        <p className="text-secondary small">{t('portal.change.firstPlanNote')}</p>
                      ) : (
                        <p className="text-secondary small">{t('portal.change.activeNote')}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-1">{t('portal.change.processingTitle')}</p>
                      <p className="text-secondary small">{t('portal.change.processingNote')}</p>
                    </>
                  )}
                  {wa !== '#' && <p className="small">{t('portal.change.urgent')} <a className="link-whatsapp" href={wa} target="_blank" rel="noopener">{t('portal.change.writeWhatsapp')}</a></p>}
                  <button className="cc-btn cc-red mt-2" onClick={onClose}>{t('common.close')}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

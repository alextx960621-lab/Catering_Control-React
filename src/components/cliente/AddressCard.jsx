import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt, waLink } from '../../services/planHelpers';
import { dbInsertAudit } from '../../services/supabaseClient';
import { IconPin, IconHome, IconCalendar } from './icons';

export default function AddressCard({ client, driver, appConfig, branding, next, onSaveClient, onSaveTomorrowOverride }) {
  const { t } = useTranslation();
  const addresses = client.addresses || [];
  const currentOverrideId = (client.addressOverrides || []).find((o) => o.date === next)?.addressId || '';
  const hasChoice = addresses.length >= 2;

  const [mode, setMode] = useState('permanent'); // 'permanent' | 'tomorrow'
  const [selected, setSelected] = useState(currentOverrideId || client.activeAddressId || addresses[0]?.id || '');
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const waNewAddress = waLink(branding, appConfig, t('portal.address.waNewAddress', { name: client.name }));

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    let result;

    if (mode === 'tomorrow') {
      result = await onSaveTomorrowOverride(selected);
    } else if (selected === client.activeAddressId) {
      result = { error: false, text: t('portal.address.sameCurrent') };
    } else {
      const updated = { ...client, activeAddressId: selected };
      const saved = await onSaveClient(updated);
      if (saved) {
        dbInsertAudit({
          actor_id: client.id,
          actor_name: client.name,
          actor_role: 'cliente',
          action: 'Cliente cambió su dirección habitual (autoservicio)',
          entity_type: 'client',
          entity_label: client.name,
          entity_id: client.id,
          details: { addressId: selected },
        });
      }
      result = saved
        ? { error: false, text: t('portal.address.savedPermanent') }
        : { error: true, text: t('portal.address.saveFailed') };
    }

    setSaving(false);
    setFeedback(result);
  }

  return (
    <div className="col-12">
      <article className="card shadow-sm border-0">
        <div className="card-body p-4">
          <h2 className="h5 mb-1">{IconPin}{t('portal.address.title')}</h2>

          {driver && (driver.firstName || driver.lastName) && (
            <div className="d-flex align-items-center gap-2 mb-3">
              {driver.photoUrl ? (
                <img src={driver.photoUrl} alt="" width={40} height={40} className="rounded-circle" style={{ objectFit: 'cover' }} />
              ) : (
                <span className="rounded-circle bg-body-tertiary d-flex align-items-center justify-content-center" style={{ width: 40, height: 40, fontSize: 16 }}>
                  {(driver.firstName?.[0] || '') + (driver.lastName?.[0] || '')}
                </span>
              )}
              <div>
                <div className="small text-secondary">{t('portal.address.yourDriver')}</div>
                <div className="fw-semibold">{[driver.firstName, driver.lastName].filter(Boolean).join(' ')}</div>
              </div>
            </div>
          )}

          {!hasChoice && (
            <p className="text-secondary mb-3">
              {t('portal.address.currentlyBefore')}<b>{addresses[0]?.address || t('portal.address.noAddress')}</b>{t('portal.address.currentlyAfter')}
            </p>
          )}

          {hasChoice && (
            <>
              <p className="text-secondary">
                {t('portal.address.chooseIntro', { date: fmt(next) })}
              </p>
              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <input className="btn-check" type="radio" name="address-mode" id="address-mode-permanent" checked={mode === 'permanent'} onChange={() => setMode('permanent')} />
                  <label className="pause-mode-card border d-block h-100 p-3" htmlFor="address-mode-permanent">
                    <span className="d-block fw-semibold">{IconHome}{t('portal.address.modePermanentTitle')}</span>
                    <span className="d-block small text-secondary mt-1">{t('portal.address.modePermanentText')}</span>
                  </label>
                </div>
                <div className="col-sm-6">
                  <input className="btn-check" type="radio" name="address-mode" id="address-mode-tomorrow" checked={mode === 'tomorrow'} onChange={() => setMode('tomorrow')} />
                  <label className="pause-mode-card border d-block h-100 p-3" htmlFor="address-mode-tomorrow">
                    <span className="d-block fw-semibold">{IconCalendar}{t('portal.address.modeTomorrowTitle', { date: fmt(next) })}</span>
                    <span className="d-block small text-secondary mt-1">{t('portal.address.modeTomorrowText')}</span>
                  </label>
                </div>
              </div>
              <div className="row g-2 align-items-end">
                <div className="col-sm-8">
                  <label className="form-label" htmlFor="address-select">
                    {mode === 'tomorrow' ? t('portal.address.labelTomorrow', { date: fmt(next) }) : t('portal.address.labelPermanent')}
                  </label>
                  <select className="form-select" id="address-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                    {addresses.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.address || t('portal.address.unnamed')}
                        {a.id === client.activeAddressId ? t('portal.address.currentTag') : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-sm-4">
                  <button className="cc-btn cc-blue w-100" onClick={handleSave} disabled={saving}>
                    {saving ? t('portal.address.saving') : t('common.save')}
                  </button>
                </div>
              </div>
              {mode === 'tomorrow' && currentOverrideId && (
                <p className="text-secondary small mt-2 mb-0">
                  {t('portal.address.overrideNote', { date: fmt(next) })}
                </p>
              )}
            </>
          )}

          {feedback && <div className={`alert mt-3 mb-0 alert-${feedback.error ? 'danger' : 'success'}`}>{feedback.text}</div>}

          {waNewAddress !== '#' && (
            <p className="text-secondary small mt-3 mb-0">
              {t('portal.address.needNewBefore')}
              <a href={waNewAddress} target="_blank" rel="noopener">
                {t('portal.address.needNewLink')}
              </a>
              {t('portal.address.needNewAfter')}
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

import { useState } from 'react';
import { fmt, waLink } from '../../services/planHelpers';
import { dbInsertAudit } from '../../services/supabaseClient';
import { IconPin, IconHome, IconCalendar } from './icons';

export default function AddressCard({ client, data, appConfig, branding, next, onSaveClient, onSaveTomorrowOverride }) {
  const addresses = client.addresses || [];
  const currentOverrideId = (client.addressOverrides || []).find((o) => o.date === next)?.addressId || '';
  const hasChoice = addresses.length >= 2;

  const [mode, setMode] = useState('permanent'); // 'permanent' | 'tomorrow'
  const [selected, setSelected] = useState(currentOverrideId || client.activeAddressId || addresses[0]?.id || '');
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const waNewAddress = waLink(branding, appConfig, `Hola, soy ${client.name}. Quiero agregar una nueva dirección de entrega.`);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    let result;

    if (mode === 'tomorrow') {
      result = await onSaveTomorrowOverride(selected);
    } else if (selected === client.activeAddressId) {
      result = { error: false, text: 'Esa ya es tu dirección de entrega actual.' };
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
        ? { error: false, text: 'Listo — esa será tu dirección de entrega desde ahora, hasta que la cambies de nuevo.' }
        : { error: true, text: 'No se pudo guardar. Intenta nuevamente o contáctanos por WhatsApp.' };
    }

    setSaving(false);
    setFeedback(result);
  }

  return (
    <div className="col-12">
      <article className="card shadow-sm border-0">
        <div className="card-body p-4">
          <h2 className="h5 mb-1">{IconPin}Tu dirección de entrega</h2>

          {!hasChoice && (
            <p className="text-secondary mb-3">
              Actualmente entregamos en: <b>{addresses[0]?.address || 'sin dirección registrada'}</b>. Solo tienes esta dirección guardada.
            </p>
          )}

          {hasChoice && (
            <>
              <p className="text-secondary">
                Elige entre tus direcciones guardadas. Puedes cambiarla desde ahora en adelante, o solo para el próximo día de entrega ({fmt(next)}) sin
                tocar tu dirección de siempre.
              </p>
              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <input className="btn-check" type="radio" name="address-mode" id="address-mode-permanent" checked={mode === 'permanent'} onChange={() => setMode('permanent')} />
                  <label className="pause-mode-card border d-block h-100 p-3" htmlFor="address-mode-permanent">
                    <span className="d-block fw-semibold">{IconHome}Desde ahora en adelante</span>
                    <span className="d-block small text-secondary mt-1">Cambia tu dirección habitual hasta que la vuelvas a cambiar.</span>
                  </label>
                </div>
                <div className="col-sm-6">
                  <input className="btn-check" type="radio" name="address-mode" id="address-mode-tomorrow" checked={mode === 'tomorrow'} onChange={() => setMode('tomorrow')} />
                  <label className="pause-mode-card border d-block h-100 p-3" htmlFor="address-mode-tomorrow">
                    <span className="d-block fw-semibold">{IconCalendar}Solo el {fmt(next)}</span>
                    <span className="d-block small text-secondary mt-1">Cambio puntual; después vuelve a tu dirección de siempre.</span>
                  </label>
                </div>
              </div>
              <div className="row g-2 align-items-end">
                <div className="col-sm-8">
                  <label className="form-label" htmlFor="address-select">
                    {mode === 'tomorrow' ? `Dirección para el ${fmt(next)}` : 'Nueva dirección habitual'}
                  </label>
                  <select className="form-select" id="address-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                    {addresses.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.address || 'Sin nombre'}
                        {a.id === client.activeAddressId ? ' (actual)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-sm-4">
                  <button className="btn btn-primary w-100" onClick={handleSave} disabled={saving}>
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
              {mode === 'tomorrow' && currentOverrideId && (
                <p className="text-secondary small mt-2 mb-0">
                  Ya elegiste una dirección distinta solo para el {fmt(next)}. Si no cambias nada, se usará esa.
                </p>
              )}
            </>
          )}

          {feedback && <div className={`alert mt-3 mb-0 alert-${feedback.error ? 'danger' : 'success'}`}>{feedback.text}</div>}

          {waNewAddress !== '#' && (
            <p className="text-secondary small mt-3 mb-0">
              ¿Necesitas una dirección que no está en la lista?{' '}
              <a href={waNewAddress} target="_blank" rel="noopener">
                Escríbenos por WhatsApp
              </a>{' '}
              para tomar los datos correctamente.
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

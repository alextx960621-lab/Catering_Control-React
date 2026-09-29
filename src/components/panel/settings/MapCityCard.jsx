import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_CITIES, CUSTOM_CITY_ID, findCity, normalizeMapCity, slugify } from '../../../data/mapCities';

const KM_PER_DEGREE = 111;

// Nombre del país en el idioma de la interfaz (sin tener que traducir 30 países a mano).
function countryName(code, lang) {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
}

// Ciudad donde trabaja la empresa: define el centro del mapa de Reparto y qué archivo de mapa
// propio se carga (bucket "maps" de Supabase → <id>.pmtiles). Solo la ve el Super Administrador.
export default function MapCityCard({ settings, saveSettings }) {
  const { t, i18n } = useTranslation();
  const saved = normalizeMapCity(settings.mapCity);
  const savedIsCustom = !!saved && !findCity(saved.id);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: savedIsCustom ? saved.name : '',
    lat: savedIsCustom ? String(saved.lat) : '',
    lng: savedIsCustom ? String(saved.lng) : '',
    km: savedIsCustom ? String(Math.round(saved.r * KM_PER_DEGREE)) : '25',
  }));

  const groups = useMemo(() => {
    const map = new Map();
    MAP_CITIES.forEach((c) => { if (!map.has(c.country)) map.set(c.country, []); map.get(c.country).push(c); });
    return [...map.entries()].map(([code, cities]) => ({ code, name: countryName(code, i18n.language), cities }));
  }, [i18n.language]);

  const showCustom = customOpen || savedIsCustom;
  const selectValue = showCustom ? CUSTOM_CITY_ID : (saved?.id || '');

  function onSelect(value) {
    if (value === CUSTOM_CITY_ID) { setCustomOpen(true); return; }
    setCustomOpen(false);
    if (!value) { saveSettings({ ...settings, mapCity: null }); return; }
    const c = findCity(value);
    if (c) saveSettings({ ...settings, mapCity: { id: c.id, name: c.name, country: c.country, lat: c.lat, lng: c.lng, r: c.r } });
  }

  const customCity = normalizeMapCity({
    id: slugify(draft.name), name: draft.name.trim(), lat: draft.lat.replace(',', '.'), lng: draft.lng.replace(',', '.'),
    r: Number(draft.km) / KM_PER_DEGREE,
  });
  const kmOk = Number(draft.km) >= 5 && Number(draft.km) <= 200;

  return (
    <div className="card card-pad stack">
      <h3>{t('settings.mapCity.title')}</h3>
      <p className="muted">{t('settings.mapCity.intro')}</p>
      <label>{t('settings.mapCity.cityLabel')}
        <select value={selectValue} onChange={(e) => onSelect(e.target.value)}>
          <option value="">{t('settings.mapCity.none')}</option>
          {groups.map((g) => (
            <optgroup key={g.code} label={g.name}>
              {g.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
          <option value={CUSTOM_CITY_ID}>{t('settings.mapCity.custom')}</option>
        </select>
      </label>

      {showCustom && (
        <div className="stack">
          <label>{t('settings.mapCity.customName')}
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('settings.mapCity.customNamePlaceholder')} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <label style={{ flex: 1 }}>{t('settings.mapCity.customLat')}
              <input inputMode="decimal" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} placeholder="-16.5" />
            </label>
            <label style={{ flex: 1 }}>{t('settings.mapCity.customLng')}
              <input inputMode="decimal" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} placeholder="-68.15" />
            </label>
            <label style={{ flex: 1 }}>{t('settings.mapCity.customRadius')}
              <input inputMode="numeric" value={draft.km} onChange={(e) => setDraft({ ...draft, km: e.target.value })} placeholder="25" />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={!customCity || !kmOk}
            onClick={() => customCity && saveSettings({ ...settings, mapCity: customCity })}
          >{t('settings.mapCity.saveCustom')}</button>
          {(!customCity || !kmOk) && <p className="muted" style={{ marginTop: -6 }}>{t('settings.mapCity.customInvalid')}</p>}
        </div>
      )}

      {saved && <p className="muted" style={{ marginTop: -6 }}>{t('settings.mapCity.fileHint', { file: `${saved.id}.pmtiles` })}</p>}
    </div>
  );
}

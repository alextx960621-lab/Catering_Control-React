export default function ThemeSelect({ theme, onChange }) {
  return (
    <div className="d-inline-flex align-items-center gap-2">
      <label className="form-label small text-secondary mb-0" htmlFor="theme-select">
        Tema
      </label>
      <select
        className="form-select form-select-sm"
        id="theme-select"
        style={{ width: 'auto' }}
        value={theme}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="light">Claro</option>
        <option value="night">Nocturno</option>
        <option value="forest">Bosque</option>
      </select>
    </div>
  );
}

import { useState } from 'react';
import { uploadImage, removeStoredImage } from '../../services/imageUpload';

// Se usa dentro de un <form> de Modal.jsx. No se guarda solo: expone
// `value` (la URL actual, que puede cambiar mientras el usuario elige una
// imagen nueva) y avisa los cambios con `onChange` — quien use este campo
// decide cuándo persistir esa URL (normalmente al guardar el formulario).
export default function ImageField({ label, name, value, onChange, folder, maxDim }) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo después
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file, folder, value, maxDim);
    setUploading(false);
    if (!url) { alert('No se pudo subir la imagen. Intenta con otra.'); return; }
    onChange(url);
  }

  function handleRemove() {
    if (value) removeStoredImage(value);
    onChange('');
  }

  return (
    <label className="wide image-field">
      {label}
      <input type="hidden" name={name} value={value || ''} readOnly />
      <div className="image-field-row">
        <div className="image-field-preview">{value ? <img src={value} alt="" /> : '🖼️'}</div>
        <div className="image-field-actions">
          <label className="outline image-field-upload">
            {uploading ? 'Subiendo…' : value ? 'Cambiar imagen' : 'Subir imagen'}
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} hidden />
          </label>
          {value && <button type="button" className="icon-btn delete" onClick={handleRemove}>Quitar</button>}
        </div>
      </div>
    </label>
  );
}

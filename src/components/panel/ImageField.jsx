import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadImage, removeStoredImage } from '../../services/imageUpload';
import StoredImage from './StoredImage';

// Se usa dentro de un <form> de Modal.jsx
export default function ImageField({ label, name, value, onChange, folder, maxDim, aspect = 'square', hint }) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo después
    if (!file) return;
    setUploading(true);
    const stored = await uploadImage(file, folder, value, maxDim);
    setUploading(false);
    if (!stored) { alert(t('panel.common.uploadFailed')); return; }
    onChange(stored);
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
        <div className={`image-field-preview${aspect !== 'square' ? ` aspect-${aspect}` : ''}`}>{value ? <StoredImage stored={value} alt="" /> : '🖼️'}</div>
        <div className="image-field-actions">
          <label className="image-field-upload">
            {uploading ? t('panel.common.uploading') : value ? t('panel.common.changeImage') : t('panel.common.uploadImage')}
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} hidden />
          </label>
          {value && <button type="button" className="danger" onClick={handleRemove}>{t('panel.common.removeImage')}</button>}
        </div>
      </div>
      {hint && <small className="image-field-hint">{hint}</small>}
    </label>
  );
}

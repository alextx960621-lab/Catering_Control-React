// Subida de comprobantes de pago (PlanChangeModal.jsx). Separado de
// imageUpload.js porque acá las reglas son distintas:
//   - Acepta imagen O PDF (imageUpload.js solo hacía imagen).
//   - Para imagen, comprime MENOS que uploadImage() (1600px/0.85 en vez de
//     1100px/0.72): la verificación automática necesita leer bien los
//     números, y recién después de leerlo con éxito la Edge Function
//     verificar-comprobante lo vuelve a comprimir más agresivo (700px/55) y
//     reemplaza el archivo -- ver ese archivo para el porqué.
//   - Para PDF, sube el archivo tal cual (sin ninguna compresión acá).
import { storageUploadImage } from './db';

const MAX_MB = 15; // límite razonable para no subir fotos de 40-50MB de golpe

function resizeImageToBlob(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Devuelve { url, path, mimeType } o null si falló.
export async function uploadReceipt(file, clientId) {
  if (!file) return null;
  if (file.size > MAX_MB * 1024 * 1024) {
    throw new Error(`El archivo pesa demasiado (máx. ${MAX_MB}MB).`);
  }

  const isPdf = file.type === 'application/pdf';
  const isImage = file.type?.startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error('Solo se aceptan imágenes o PDF.');
  }

  const ext = isPdf ? 'pdf' : 'jpg';
  const path = `comprobantes/${clientId}_${uid()}.${ext}`;

  let blob, contentType;
  if (isPdf) {
    blob = file;
    contentType = 'application/pdf';
  } else {
    blob = await resizeImageToBlob(file, 1600, 0.85);
    contentType = 'image/jpeg';
  }

  const url = await storageUploadImage(path, blob, contentType);
  if (!url) return null;
  return { url, path, mimeType: contentType };
}

// Subida de comprobantes de pago (PlanChangeModal.jsx)
import { storageUploadImage } from './db';
import { resizeImageToBlob } from './imageUpload';

const MAX_MB = 15; // límite razonable para no subir fotos de 40-50MB de golpe

// Sube a 'comprobantes/', que ahora es bucket privado: lo que se guarda en el payload es la ruta, no
// una URL pública. Ver imageUpload.js -> viewUrlForStored().
function uid() {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');
  return `${Date.now().toString(36)}${rnd}`;
}

// Devuelve { path, mimeType } o null si falló
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

  const stored = await storageUploadImage(path, blob, contentType);
  if (!stored) return null;
  return { path, mimeType: contentType };
}

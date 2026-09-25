import { storageUploadImage, storageRemoveImage, storageSignedUrl } from './db';

// Redimensiona una imagen en el navegador antes de subirla, así los logos/fotos no pesan…
export function resizeImageToBlob(file, maxDim = 480, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) { reject(new Error('Archivo no válido')); return; }
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

const STORAGE_PATH_RE = /^[a-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$/;

// Saca el "path" dentro del bucket para poder borrar el archivo. Acepta las dos formas que viven en
// los payloads: la URL pública absoluta (bucket público y lo subido antes del cambio) y la ruta suelta.
function storagePathFromUrl(ref) {
  if (!ref) return null;
  const s = String(ref);
  if (!/^https?:/i.test(s)) return STORAGE_PATH_RE.test(s) ? s : null;
  const marker = '/object/public/app-images/';
  const idx = s.indexOf(marker);
  return idx === -1 ? null : s.slice(idx + marker.length);
}

// El nombre va en la URL firmada: con pocos caracteres se puede adivinar y, en un bucket público, eso
// era leer comprobantes y fotos de entrega de otros clientes.
function uid(prefix) {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function removeStoredImage(url) {
  const path = storagePathFromUrl(url);
  if (path) storageRemoveImage(path);
}

// Las URLs firmadas duran 15 minutos en el servidor; se cachea un poco menos para no re-firmar cada
// vez que React re-renderiza la misma foto.
const signedCache = new Map();

// Convierte lo que está guardado en el payload en algo que se puede mostrar.
export async function viewUrlForStored(ref) {
  if (!ref) return null;
  const s = String(ref);
  if (/^https?:/i.test(s)) return s;
  const cached = signedCache.get(s);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const url = await storageSignedUrl(s);
  if (url) signedCache.set(s, { url, expiresAt: Date.now() + 10 * 60 * 1000 });
  return url;
}

// subidas en curso: Modal.jsx bloquea "Guardar" hasta que terminen, si no se guardaría la URL
// anterior (la nueva aún no existe) o se iría el cambio a medias.
let uploadsInFlight = 0;
const uploadListeners = new Set();

function notifyUploads() {
  uploadListeners.forEach((fn) => fn());
}

export function subscribeUploads(listener) {
  uploadListeners.add(listener);
  return () => uploadListeners.delete(listener);
}

export function hasUploadsInFlight() {
  return uploadsInFlight > 0;
}

// Sube un archivo elegido con <input type="file">, ya redimensionado, y borra la imagen…
export async function uploadImage(file, folder, oldUrl = '', maxDim = 480, quality = 0.82, pathPrefix = '') {
  uploadsInFlight += 1;
  notifyUploads();
  try {
    const blob = await resizeImageToBlob(file, maxDim, quality);
    const path = `${folder}/${pathPrefix}${uid('img')}.jpg`;
    const url = await storageUploadImage(path, blob, 'image/jpeg');
    if (!url) return null;
    if (oldUrl) removeStoredImage(oldUrl);
    return url;
  } catch (err) {
    console.error('[imageUpload] No se pudo subir la imagen:', err);
    return null;
  } finally {
    uploadsInFlight -= 1;
    notifyUploads();
  }
}

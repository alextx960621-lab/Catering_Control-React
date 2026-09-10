import { storageUploadImage, storageRemoveImage } from './db';

// Redimensiona una imagen en el navegador antes de subirla, así los
// logos/fotos no pesan varios MB cada uno (eso era justo lo que inflaba
// la "Salida" de datos del proyecto de Supabase).
function resizeImageToBlob(file, maxDim = 480, quality = 0.82) {
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
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen'))), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

// Saca el "path" dentro del bucket a partir de la URL pública guardada,
// para poder borrar el archivo viejo cuando se reemplaza o se quita una
// imagen (si no, quedan huérfanos ocupando espacio en el bucket).
function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = '/object/public/app-images/';
  const idx = String(url).indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function removeStoredImage(url) {
  const path = storagePathFromUrl(url);
  if (path) storageRemoveImage(path);
}

// Sube un archivo elegido con <input type="file">, ya redimensionado, y
// borra la imagen anterior del bucket (si había una). Devuelve la URL
// pública nueva, o null si algo falló.
export async function uploadImage(file, folder, oldUrl = '', maxDim = 480, quality = 0.82) {
  try {
    const blob = await resizeImageToBlob(file, maxDim, quality);
    const path = `${folder}/${uid('img')}.jpg`;
    const url = await storageUploadImage(path, blob, 'image/jpeg');
    if (!url) return null;
    if (oldUrl) removeStoredImage(oldUrl);
    return url;
  } catch (err) {
    console.error('[imageUpload] No se pudo subir la imagen:', err);
    return null;
  }
}

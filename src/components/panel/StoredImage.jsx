import { useEffect, useState } from 'react';
import { viewUrlForStored } from '../../services/imageUpload';

// Un payload puede guardar una URL pública (bucket público, o lo subido antes del cambio) o la ruta
// de un archivo privado: esto firma la ruta y muestra la imagen cuando la URL existe.
export default function StoredImage({ stored, alt, className }) {
  // Se guarda el key junto a la URL para no mostrar la firma de una imagen anterior mientras llega la nueva.
  const [state, setState] = useState({ key: null, url: null });
  const url = state.key === stored ? state.url : null;

  useEffect(() => {
    let activo = true;
    viewUrlForStored(stored).then((u) => { if (activo) setState({ key: stored, url: u }); });
    return () => { activo = false; };
  }, [stored]);

  if (!url) return null;
  return <img src={url} alt={alt} className={className} />;
}

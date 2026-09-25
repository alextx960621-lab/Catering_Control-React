import { useEffect, useState } from 'react';
import config from '../services/config';
import { rpc } from '../services/supabaseClient';
import { STORAGE_KEYS } from '../services/storageKeys';

function readCachedBranding() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.brandingCache)) || null;
  } catch {
    return null;
  }
}

// El branding (nombre, logo, whatsapp) puede haberse editado desde el Panel, así que no…
export function useBranding() {
  const cached = readCachedBranding();
  const [name, setName] = useState(cached?.name || config.companyName);
  const [logo, setLogo] = useState(cached ? cached.logo : config.logoUrl || '');
  const [whatsappNumber, setWhatsappNumber] = useState(cached?.whatsappNumber || config.whatsappNumber || '');

  useEffect(() => {
    let cancelled = false;

    async function fetchBranding() {
      const settings = await rpc('get_branding', {});
      if (cancelled || !settings) return;
      const freshName = settings.companyName?.trim() || config.companyName;
      // Ojo: acá SÍ puede ser '' a propósito (el admin borró el logo desde Configuración) -- no…
      const freshLogo = 'logoUrl' in settings ? settings.logoUrl || '' : config.logoUrl || '';
      const freshWhatsapp = settings.whatsappNumber || '';
      setName(freshName);
      setLogo(freshLogo);
      if (freshWhatsapp) setWhatsappNumber(freshWhatsapp);
      try {
        localStorage.setItem(
          STORAGE_KEYS.brandingCache,
          JSON.stringify({ name: freshName, logo: freshLogo, whatsappNumber: freshWhatsapp }),
        );
      } catch {/* localStorage lleno o bloqueado: no es crítico, se reintenta la próxima vez */}
    }

    fetchBranding();
    // Si la pestaña del login queda abierta de fondo (típico al instalar como PWA) y alguien…
    function handleVisibility() {
      if (document.visibilityState === 'visible') fetchBranding();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return { name, logo, whatsappNumber };
}

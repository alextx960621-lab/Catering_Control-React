import { useEffect, useState } from 'react';
import { presenceState } from '../services/supabaseClient';

const ROLE_ICON = { cliente: '🧑‍🍳', driver: '🚚', staff: '🧑‍💼' };
export const ROLE_ICONS = ROLE_ICON;

function computeFromState(state) {
  const counts = { cliente: 0, driver: 0, staff: 0 };
  const detail = [];
  Object.values(state || {}).forEach((metas) => {
    (metas || []).forEach((m) => {
      if (counts[m.role] !== undefined) counts[m.role]++;
      detail.push(m);
    });
  });
  detail.sort((a, b) => (a.role || '').localeCompare(b.role || '') || String(b.at || '').localeCompare(String(a.at || '')));
  return { counts: { ...counts, total: counts.cliente + counts.driver + counts.staff }, detail };
}

// Cuenta y detalle de quién está usando la app ahora mismo (Configuración
// ya se une al canal de presencia desde PanelPage/ClientePage al iniciar
// sesión; este hook solo LEE ese mismo canal, no crea uno nuevo).
export function usePresence() {
  const [state, setState] = useState(() => computeFromState(presenceState()));

  useEffect(() => {
    const interval = setInterval(() => setState(computeFromState(presenceState())), 4000);
    return () => clearInterval(interval);
  }, []);

  return state;
}

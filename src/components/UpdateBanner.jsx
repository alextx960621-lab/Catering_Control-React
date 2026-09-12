import { useSWUpdate } from '../hooks/useSWUpdate';

export default function UpdateBanner() {
  const { needRefresh, dismiss, update } = useSWUpdate();
  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexWrap: 'wrap', padding: '10px 16px', background: '#1f2a3d', color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, boxShadow: '0 2px 10px rgba(0,0,0,.25)',
      }}
    >
      <span>Hay una nueva versión de la app lista.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={update}
          style={{
            border: 0, borderRadius: 999, padding: '6px 16px', fontWeight: 700, cursor: 'pointer',
            background: 'linear-gradient(135deg, #8fb0ff, #4a72ff)', color: '#fff',
          }}
        >
          Actualizar ahora
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar aviso"
          style={{ border: '1px solid rgba(255,255,255,.35)', borderRadius: 999, padding: '6px 12px', background: 'transparent', color: '#fff', cursor: 'pointer' }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}

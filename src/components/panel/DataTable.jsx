import { useRef, useState } from 'react';
import { getColumnPrefs, saveColumnWidths } from '../../services/columnPrefs';

// Tabla simple con buscador arriba y columnas redimensionables a mano.
// `columns`: [{key,label,render(row)}]. `resizeGroup` identifica esta
// tabla para guardar los anchos por separado de las demás (ej.
// 'clients', 'drivers') — si no se pasa, no se guarda nada (sirve igual,
// solo que sin recordar los anchos entre visitas).
export default function DataTable({ columns, rows, getRowId = (r) => r.id, search, onSearchChange, searchPlaceholder, emptyText = 'Sin registros.', resizeGroup, userId }) {
  const [widths, setWidths] = useState(() => (resizeGroup ? getColumnPrefs(userId, resizeGroup).widths : {}));
  const resizeRef = useRef(null);

  function startResize(e, key) {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    resizeRef.current = { key, startX, startWidth };
    function onMove(ev) {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      th.style.width = `${Math.max(60, resizeRef.current.startWidth + delta)}px`;
    }
    function onUp() {
      if (resizeRef.current) {
        const finalWidth = Math.max(60, th.offsetWidth);
        setWidths((prev) => {
          const next = { ...prev, [resizeRef.current.key]: finalWidth };
          if (resizeGroup) saveColumnWidths(userId, resizeGroup, next);
          return next;
        });
      }
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <>
      {onSearchChange && (
        <div className="toolbar">
          <input className="search" placeholder={searchPlaceholder || 'Buscar…'} value={search} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
      )}
      <div className="sheet">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={widths[c.key] ? { width: widths[c.key] } : undefined}>
                  {c.label}
                  <span className="col-resize-handle" onMouseDown={(e) => startResize(e, c.key)} title="Arrastrar para cambiar el ancho" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={getRowId(row)}>{columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}</tr>
            )) : (
              <tr><td colSpan={columns.length} className="empty">{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

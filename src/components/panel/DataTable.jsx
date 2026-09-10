import { useRef, useState } from 'react';
import { getColumnPrefs, saveColumnWidths } from '../../services/columnPrefs';

// Tabla simple con buscador arriba y columnas redimensionables a mano.
// `columns`: [{key,label,render(row)}]. `resizeGroup` identifica esta
// tabla para guardar los anchos por separado de las demás (ej.
// 'clients', 'drivers') — si no se pasa, no se guarda nada (sirve igual,
// solo que sin recordar los anchos entre visitas).
// Para ordenar por una columna renderizada (JSX, con íconos, badges, etc.)
// se necesita un valor "plano" comparable. Si la columna no define
// `sortValue`, se usa el propio dato de la fila en `col.key` como mejor
// esfuerzo; si eso tampoco existe, se cae a texto plano extraído del render.
function rawSortValue(col, row) {
  if (col.sortValue) return col.sortValue(row);
  if (row && Object.prototype.hasOwnProperty.call(row, col.key)) return row[col.key];
  return null;
}

function compareValues(a, b) {
  const an = typeof a === 'number' ? a : (a !== null && a !== '' && !isNaN(a)) ? Number(a) : null;
  const bn = typeof b === 'number' ? b : (b !== null && b !== '' && !isNaN(b)) ? Number(b) : null;
  if (an !== null && bn !== null) return an - bn;
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base', numeric: true });
}

export default function DataTable({ columns, rows, getRowId = (r) => r.id, search, onSearchChange, searchPlaceholder, emptyText = 'Sin registros.', resizeGroup, userId }) {
  const [widths, setWidths] = useState(() => (resizeGroup ? getColumnPrefs(userId, resizeGroup).widths : {}));
  const [sort, setSort] = useState(null); // { key, dir: 'asc'|'desc' }
  const resizeRef = useRef(null);

  function toggleSort(key) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // tercer clic: vuelve al orden original
    });
  }

  const sortedRows = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const withValue = rows.map((row, i) => ({ row, i, value: rawSortValue(col, row) }));
    withValue.sort((a, b) => {
      const cmp = compareValues(a.value, b.value);
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
      return a.i - b.i; // estable
    });
    return withValue.map((x) => x.row);
  })();

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
                <th key={c.key} style={widths[c.key] ? { width: widths[c.key] } : undefined} className={c.sortable === false ? '' : 'th-sortable'} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? c.label : (
                    <button type="button" className="th-sort-btn" onClick={() => toggleSort(c.key)} title="Ordenar por esta columna">
                      {c.label}
                      <span className="th-sort-icon">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                    </button>
                  )}
                  <span className="col-resize-handle" onMouseDown={(e) => startResize(e, c.key)} title="Arrastrar para cambiar el ancho" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
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

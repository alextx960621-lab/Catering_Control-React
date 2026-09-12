import { useRef, useState } from 'react';
import { getColumnPrefs, saveColumnWidths, saveColumnOrder, saveHiddenColumns, arrangeColumns } from '../../services/columnPrefs';
import ColumnsModal from './ColumnsModal';

// Tabla simple con buscador arriba y columnas redimensionables a mano.
// `columns`: [{key,label,render(row)}] ya en el orden final -- se usa así
// en la mayoría de las tablas del panel (Drivers, Rutas, Planes, Usuarios,
// Inventario, Entregas, Auditoría), que no necesitan que cada persona
// reordene/oculte columnas, solo que se acuerden los anchos.
//
// `allColumns` es la variante opcional para las tablas donde SÍ hace falta
// que cada usuario reordene/oculte columnas a su gusto (mismo patrón que ya
// tenía "Columnas" en Día de trabajo): se le pasa la lista COMPLETA sin
// arreglar, y este componente se encarga de aplicar las preferencias
// guardadas (orden/ocultas/anchos, por cuenta vía resizeGroup) y de mostrar
// el botón "Columnas" + su modal. Si no se pasa `allColumns`, el
// comportamiento es idéntico al de siempre (nada cambia para las tablas que
// no lo usan).
//
// `resizeGroup` identifica esta tabla para guardar las preferencias por
// separado de las demás (ej. 'clients', 'drivers') — si no se pasa, no se
// guarda nada (sirve igual, solo que sin recordar nada entre visitas).
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

export default function DataTable({ columns: fixedColumns, allColumns, rows, getRowId = (r) => r.id, search, onSearchChange, searchPlaceholder, emptyText = 'Sin registros.', resizeGroup, userId }) {
  const [colPrefs, setColPrefs] = useState(() => (resizeGroup ? getColumnPrefs(userId, resizeGroup) : { hidden: [], order: [], widths: {} }));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sort, setSort] = useState(null); // { key, dir: 'asc'|'desc' }
  const resizeRef = useRef(null);

  const columns = allColumns ? arrangeColumns(allColumns, colPrefs) : fixedColumns;
  const widths = colPrefs.widths || {};

  function resetWidths() {
    setColPrefs((p) => ({ ...p, widths: {} }));
    if (resizeGroup) saveColumnWidths(userId, resizeGroup, {});
  }

  function handleSaveColumns(order, hidden) {
    setColPrefs((p) => ({ ...p, order, hidden }));
    if (resizeGroup) { saveColumnOrder(userId, resizeGroup, order); saveHiddenColumns(userId, resizeGroup, hidden); }
    setColumnsOpen(false);
  }

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
        setColPrefs((prev) => {
          const next = { ...prev, widths: { ...prev.widths, [resizeRef.current.key]: finalWidth } };
          if (resizeGroup) saveColumnWidths(userId, resizeGroup, next.widths);
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

  const hasCustomWidths = resizeGroup && Object.keys(widths).length > 0;

  return (
    <>
      {(onSearchChange || hasCustomWidths || allColumns) && (
        <div className="toolbar">
          {onSearchChange && <input className="search" placeholder={searchPlaceholder || 'Buscar…'} value={search} onChange={(e) => onSearchChange(e.target.value)} />}
          {allColumns && <button type="button" className="info" onClick={() => setColumnsOpen(true)}>Columnas</button>}
          {hasCustomWidths && <button type="button" className="outline" onClick={resetWidths} title="Vuelve los anchos de columna a su tamaño automático">Restaurar anchos</button>}
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
      {allColumns && (
        <ColumnsModal
          open={columnsOpen}
          onClose={() => setColumnsOpen(false)}
          allColumns={allColumns}
          hidden={colPrefs.hidden || []}
          order={colPrefs.order || []}
          onSave={handleSaveColumns}
          onResetWidths={hasCustomWidths ? resetWidths : undefined}
        />
      )}
    </>
  );
}

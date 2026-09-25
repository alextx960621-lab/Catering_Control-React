import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getColumnPrefs, saveColumnWidths, saveColumnOrder, saveHiddenColumns, arrangeColumns, startColumnResize, resizeEndedRecently } from '../../services/columnPrefs';
import ColumnsModal from './ColumnsModal';

// Tabla simple con buscador arriba y columnas redimensionables a mano
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

export default function DataTable({ columns: fixedColumns, allColumns, rows, getRowId = (r) => r.id, search, onSearchChange, searchPlaceholder, emptyText, resizeGroup, userId, columnsOpen: columnsOpenProp, onColumnsOpenChange }) {
  const { t } = useTranslation();
  const [colPrefs, setColPrefs] = useState(() => (resizeGroup ? getColumnPrefs(userId, resizeGroup) : { hidden: [], order: [], widths: {} }));
  const [internalColumnsOpen, setInternalColumnsOpen] = useState(false);
  const isColumnsOpenControlled = columnsOpenProp !== undefined;
  const columnsOpen = isColumnsOpenControlled ? columnsOpenProp : internalColumnsOpen;
  const setColumnsOpen = onColumnsOpenChange || setInternalColumnsOpen;
  const [sort, setSort] = useState(null);

  const columns = allColumns ? arrangeColumns(allColumns, colPrefs) : fixedColumns;
  const widths = colPrefs.widths || {};

  function resetWidths() {
    setColPrefs((p) => ({ ...p, widths: {} }));
    if (resizeGroup) saveColumnWidths(userId, resizeGroup, {});
  }

  function handleSaveColumns(order, hidden, newWidths) {
    setColPrefs((p) => ({ ...p, order, hidden, widths: newWidths ?? p.widths }));
    if (resizeGroup) {
      saveColumnOrder(userId, resizeGroup, order);
      saveHiddenColumns(userId, resizeGroup, hidden);
      if (newWidths) saveColumnWidths(userId, resizeGroup, newWidths);
    }
    setColumnsOpen(false);
  }

  function toggleSort(key) {
    if (resizeEndedRecently()) return; // clic suelto al terminar de ajustar el ancho de una columna
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
    e.stopPropagation();
    startColumnResize(e, key, (k, finalWidth) => {
      setColPrefs((prev) => {
        const next = { ...prev, widths: { ...prev.widths, [k]: finalWidth } };
        if (resizeGroup) saveColumnWidths(userId, resizeGroup, next.widths);
        return next;
      });
    });
  }

  const hasCustomWidths = resizeGroup && Object.keys(widths).length > 0;

  return (
    <>
      {(onSearchChange || (allColumns && !isColumnsOpenControlled)) && (
        <div className="toolbar">
          {onSearchChange && <input className="search" id="datatable-search" name="datatable-search" autoComplete="off" placeholder={searchPlaceholder || t('panel.common.searchPlaceholder')} value={search} onChange={(e) => onSearchChange(e.target.value)} />}
          {allColumns && !isColumnsOpenControlled && <button type="button" className="info" onClick={() => setColumnsOpen(true)}>{t('panel.common.columns')}</button>}
        </div>
      )}
      <div className="sheet">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={widths[c.key] ? { width: widths[c.key] } : undefined} className={c.sortable === false ? '' : 'th-sortable'} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? c.label : (
                    <button type="button" className="th-sort-btn" onClick={() => toggleSort(c.key)} title={t('panel.common.sortByColumn')}>
                      {c.label}
                      <span className="th-sort-icon">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                    </button>
                  )}
                  <span className="col-resize-handle" onPointerDown={(e) => startResize(e, c.key)} title={t('panel.common.dragResize')} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={getRowId(row)}>{columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}</tr>
            )) : (
              <tr><td colSpan={columns.length} className="empty">{emptyText || t('panel.common.noRecords')}</td></tr>
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
          widths={widths}
          onSave={handleSaveColumns}
          onResetWidths={hasCustomWidths ? resetWidths : undefined}
        />
      )}
    </>
  );
}

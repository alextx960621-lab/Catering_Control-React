// Id corto para filas nuevas creadas en el cliente antes de guardarse (clientes, notas,
// planes, productos, vínculos, usuarios, rutas). Usado por varias páginas del panel.
export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Formatea una fecha 'YYYY-MM-DD' (la que usa toda la app internamente) como 'DD/MM/YYYY'
// para mostrarla al staff. Usado por varias páginas del panel.
export function fmtDate(d) {
  return d.split('-').reverse().join('/');
}

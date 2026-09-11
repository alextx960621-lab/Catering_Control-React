// Preferencias de columnas de las tablas (qué mostrar, en qué orden, con
// qué ancho). Este archivo quedó como un re-export fino de
// services/userPrefs.js, que es donde vive el store real -- se mantiene
// separado solo para no tener que tocar los imports de cada pantalla
// (DataTable, DispatchPage, PlansPage, UsersPage, etc.) que ya apuntan
// acá.
//
// Desde la incorporación de supabase-setup-final-v2.sql (sección 15),
// estas preferencias ya NO son solo de este navegador: viajan con la
// cuenta del usuario (ver userPrefs.js y OperationsContext.jsx, que es
// quien llama a hydrateFromServer() al arrancar el Panel).
export { getColumnPrefs, saveHiddenColumns, saveColumnOrder, saveColumnWidths, arrangeColumns } from './userPrefs';

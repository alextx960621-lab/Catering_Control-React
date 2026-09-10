// Roles y permisos del Panel. Se separa en su propio archivo porque lo va
// a necesitar tanto el menú lateral (para saber qué botones mostrar) como
// cada pantalla (para saber si el usuario puede editar o solo mirar).

export const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  kitchen: 'Cocina',
  driver: 'Driver',
  superadmin: 'Super Administrador',
};

// Qué roles built-in pueden VER cada pantalla. Un "rol personalizado"
// (creado desde Usuarios) no aparece acá — sus permisos por página se
// guardan aparte y se consultan cuando se construya la pantalla Usuarios.
export const NAV_PERMS = {
  dispatch: ['admin', 'editor', 'kitchen', 'driver', 'superadmin'],
  delivery: ['admin', 'editor', 'driver', 'superadmin'],
  clients: ['admin', 'editor', 'driver', 'superadmin'],
  drivers: ['admin', 'editor', 'superadmin'],
  routes: ['admin', 'editor', 'superadmin'],
  plans: ['admin', 'editor', 'superadmin'],
  payroll: ['admin', 'editor', 'driver', 'superadmin'],
  metrics: ['admin', 'editor', 'superadmin'],
  inventory: ['admin', 'editor', 'kitchen', 'superadmin'],
  users: ['admin', 'superadmin'],
  audit: ['admin', 'superadmin'],
  notes: ['admin', 'editor', 'superadmin'],
  settings: ['admin', 'editor', 'kitchen', 'driver', 'superadmin'],
};

// Qué páginas puede desbloquear el plan Premium, y si por defecto (sin
// configurar nada) están bloqueadas para el plan Básico.
export const PREMIUM_DEFAULT_LOCKED = {
  notes: true,
  payroll: true,
  inventory: true,
  audit: true,
  metrics: true,
  delivery: false,
  weeklySchedule: true,
  returnDate: true,
  specialDietPrint: true,
  clientPortal: true,
};

export function isBuiltinRole(role) {
  return !!ROLE_LABELS[role];
}

export function roleLabel(role, customRoles = []) {
  return ROLE_LABELS[role] || customRoles.find((r) => r.id === role)?.label || role || 'Usuario';
}

export function isAdmin(role) {
  return role === 'admin' || role === 'superadmin';
}

// Páginas de las que se puede dar permiso de "editar" a un rol a medida
// (metrics/audit/settings/users son siempre de solo consulta o exclusivas
// de administración, igual que en los roles fijos).
export const EDITABLE_PAGES = ['dispatch', 'delivery', 'clients', 'drivers', 'routes', 'plans', 'payroll', 'inventory', 'notes'];

export const ROLE_PAGE_OPTIONS = [
  ['dispatch', 'Día de trabajo', true], ['delivery', 'Despacho', true], ['clients', 'Clientes', true],
  ['drivers', 'Drivers', true], ['routes', 'Rutas', true], ['plans', 'Planes', true],
  ['payroll', 'Sueldos', true], ['inventory', 'Inventario', true], ['metrics', 'Métricas', false],
  ['notes', 'Notas', true], ['audit', 'Auditoría', false], ['settings', 'Configuración', false],
];

function customCanEdit(role, customRoles, page) {
  return !!customRoles.find((r) => r.id === role)?.pages?.[page]?.edit;
}

// Permisos "de edición" para los roles built-in: quién puede modificar
// datos (no solo mirarlos) en cada pantalla. El 3er argumento
// (customRoles) es opcional -- si no se pasa, un rol a medida nunca
// puede editar (queda como solo-consulta, la opción más segura).
export const canManage = (role, customRoles = [], page = '') => ['admin', 'editor', 'superadmin'].includes(role) || customCanEdit(role, customRoles, page);
export const canManageInventory = (role, customRoles = []) => ['admin', 'editor', 'kitchen', 'superadmin'].includes(role) || customCanEdit(role, customRoles, 'inventory');
export const canManageDelivery = (role, customRoles = []) => ['admin', 'editor', 'driver', 'superadmin'].includes(role) || customCanEdit(role, customRoles, 'delivery');

export function canAccessPage(page, role, customRoles = []) {
  if (page === 'users') return isAdmin(role);
  if (isBuiltinRole(role)) return (NAV_PERMS[page] || []).includes(role);
  return !!customRoles.find((r) => r.id === role)?.pages?.[page]?.view;
}

export function isPagePremiumLocked(page, premiumLockedPagesConfig) {
  if (!premiumLockedPagesConfig || !(page in premiumLockedPagesConfig)) return !!PREMIUM_DEFAULT_LOCKED[page];
  return !!premiumLockedPagesConfig[page];
}

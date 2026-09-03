export type PanelRole = 'admin' | 'operations' | 'office';

export type AppRole = PanelRole | 'retailer' | 'salesOfficer' | 'purchaseOfficer';

export type WriteModule = 'stores' | 'receivables' | 'orders' | 'purchases' | 'inventory';

export type WriteAccess = Record<WriteModule, boolean>;

export type PanelPermissions = {
  role: PanelRole;
  menuPaths: string[];
  writeAccess: WriteAccess;
  homePath: string;
};

export const WRITE_MODULES: { id: WriteModule; label: string }[] = [
  { id: 'stores', label: 'Can edit stores' },
  { id: 'receivables', label: 'Can edit receivables' },
  { id: 'orders', label: 'Can edit orders' },
  { id: 'purchases', label: 'Can edit purchase invoices' },
  { id: 'inventory', label: 'Can edit inventory' },
];

/** Sidebar/route catalog — used for admin menu checkboxes. */
export const MENU_CATALOG: { path: string; label: string }[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/support', label: 'Support' },
  { path: '/orders', label: 'Orders' },
  { path: '/order-shortfalls', label: 'Order shortfalls' },
  { path: '/product-demands', label: 'Product demands' },
  { path: '/purchase-lists', label: 'Purchase lists' },
  { path: '/invoices', label: 'Sales invoices' },
  { path: '/credit-notes', label: 'Credit & debit notes' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/nrx-register', label: 'NRX register' },
  { path: '/purchases', label: 'Purchase invoices' },
  { path: '/vendors', label: 'Vendors' },
  { path: '/vendor-ledger', label: 'Vendor ledger' },
  { path: '/store-ledger', label: 'Store ledger' },
  { path: '/order-returns', label: 'Order returns' },
  { path: '/expiry-returns', label: 'Expiry returns' },
  { path: '/purchase-returns', label: 'Purchase returns' },
  { path: '/stores', label: 'Medical stores' },
  { path: '/store-receivables', label: 'Store receivables' },
  { path: '/so-receivables', label: 'SO receivables' },
  { path: '/payment-requests', label: 'Payment requests' },
  { path: '/pending-retailers', label: 'Pending retailers' },
  { path: '/sales-officers', label: 'Sales officers' },
  { path: '/so-visits', label: 'SO visits' },
  { path: '/daily-performance', label: 'Daily performance' },
  { path: '/margin', label: 'Margin report' },
  { path: '/medicine-demand', label: 'Top sellers' },
  { path: '/banners', label: 'Banners' },
  { path: '/home-feed', label: 'Home feed' },
  { path: '/operations', label: 'Fulfillment setup' },
  { path: '/operations-users', label: 'Panel users' },
];

const ALL_MENU_PATHS = MENU_CATALOG.map((m) => m.path);

/** Base paths allowed per panel role when the user has no custom menuPaths. */
export const ROLE_MENU_PATHS: Record<PanelRole, string[]> = {
  admin: ALL_MENU_PATHS,
  operations: [
    '/',
    '/expiry-returns',
    '/order-returns',
    '/purchase-returns',
    '/vendors',
    '/inventory',
    '/nrx-register',
    '/purchases',
    '/vendor-ledger',
    '/store-ledger',
    '/orders',
    '/order-shortfalls',
    '/product-demands',
    '/operations',
    '/purchase-lists',
    '/credit-notes',
    '/medicine-demand',
    '/support',
  ],
  office: ['/stores', '/store-receivables', '/so-receivables', '/orders', '/purchases', '/inventory'],
};

const FULL_WRITE: WriteAccess = {
  stores: true,
  receivables: true,
  orders: true,
  purchases: true,
  inventory: true,
};

/** Office default: view stores / receivables / orders; full purchase invoices + inventory. */
export const OFFICE_WRITE_DEFAULTS: WriteAccess = {
  stores: false,
  receivables: false,
  orders: false,
  purchases: true,
  inventory: true,
};

export const PANEL_ROLES: PanelRole[] = ['admin', 'operations', 'office'];

export function isPanelRole(role: string | undefined): role is PanelRole {
  return role === 'admin' || role === 'operations' || role === 'office';
}

export function canAccessPanel(role: string | undefined): role is PanelRole {
  return isPanelRole(role);
}

export function defaultMenuPaths(role: PanelRole): string[] {
  return [...ROLE_MENU_PATHS[role]];
}

export function defaultWriteAccess(role: PanelRole): WriteAccess {
  if (role === 'office') return { ...OFFICE_WRITE_DEFAULTS };
  return { ...FULL_WRITE };
}

export function defaultHomePath(role: PanelRole): string {
  return role === 'office' ? '/stores' : '/';
}

function normalizeMenuPaths(role: PanelRole, raw: unknown): string[] {
  if (role === 'admin') return defaultMenuPaths('admin');
  if (!Array.isArray(raw) || raw.length === 0) return defaultMenuPaths(role);
  const allowed = new Set(ALL_MENU_PATHS);
  const paths = raw
    .map((p) => String(p || '').trim())
    .filter((p) => allowed.has(p));
  return paths.length > 0 ? [...new Set(paths)] : defaultMenuPaths(role);
}

function normalizeWriteAccess(role: PanelRole, raw: unknown): WriteAccess {
  const base = defaultWriteAccess(role);
  if (role === 'admin') return { ...FULL_WRITE };
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown>;
  return {
    stores: src.stores === undefined ? base.stores : src.stores === true,
    receivables: src.receivables === undefined ? base.receivables : src.receivables === true,
    orders: src.orders === undefined ? base.orders : src.orders === true,
    purchases: src.purchases === undefined ? base.purchases : src.purchases === true,
    inventory: src.inventory === undefined ? base.inventory : src.inventory === true,
  };
}

export function buildPanelPermissions(
  role: PanelRole,
  profile?: { menuPaths?: unknown; writeAccess?: unknown; homePath?: unknown }
): PanelPermissions {
  const menuPaths = normalizeMenuPaths(role, profile?.menuPaths);
  const homeFromProfile = String(profile?.homePath || '').trim();
  const homePath =
    role === 'admin'
      ? '/'
      : homeFromProfile && menuPaths.some((p) => pathMatches(p, homeFromProfile))
        ? homeFromProfile
        : defaultHomePath(role);
  return {
    role,
    menuPaths,
    writeAccess: normalizeWriteAccess(role, profile?.writeAccess),
    homePath: menuPaths.includes(homePath) || homePath === '/' ? homePath : menuPaths[0] || defaultHomePath(role),
  };
}

function pathMatches(base: string, pathname: string): boolean {
  if (base === '/') return pathname === '/';
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function canAccessPath(roleOrPerms: PanelRole | PanelPermissions, pathname: string): boolean {
  const perms: PanelPermissions =
    typeof roleOrPerms === 'string' ? buildPanelPermissions(roleOrPerms) : roleOrPerms;
  if (perms.role === 'admin') return true;
  return perms.menuPaths.some((base) => pathMatches(base, pathname));
}

export function canWrite(perms: PanelPermissions | null | undefined, module: WriteModule): boolean {
  if (!perms) return false;
  if (perms.role === 'admin') return true;
  return perms.writeAccess[module] === true;
}

export function getPanelTitle(role: PanelRole): string {
  if (role === 'operations') return 'Operations Panel';
  if (role === 'office') return 'Office Panel';
  return 'Admin Panel';
}

export type PanelRole = 'admin' | 'operations';

export type AppRole = PanelRole | 'retailer' | 'salesOfficer';

/** Base paths allowed per panel role (sub-routes matched by prefix). */
export const ROLE_MENU_PATHS: Record<PanelRole, string[]> = {
  admin: [
    '/',
    '/pending-retailers',
    '/expiry-returns',
    '/order-returns',
    '/vendors',
    '/stores',
    '/store-receivables',
    '/sales-officers',
    '/operations-users',
    '/inventory',
    '/purchases',
    '/orders',
    '/margin',
    '/product-demands',
    '/operations',
    '/invoices',
    '/credit-notes',
    '/banners',
  ],
  operations: [
    '/',
    '/expiry-returns',
    '/order-returns',
    '/vendors',
    '/inventory',
    '/purchases',
    '/orders',
    '/product-demands',
    '/operations',
    '/credit-notes',
  ],
};

export const PANEL_ROLES: PanelRole[] = ['admin', 'operations'];

export function isPanelRole(role: string | undefined): role is PanelRole {
  return role === 'admin' || role === 'operations';
}

export function canAccessPanel(role: string | undefined): role is PanelRole {
  return isPanelRole(role);
}

export function canAccessPath(role: PanelRole, pathname: string): boolean {
  const allowed = ROLE_MENU_PATHS[role];
  return allowed.some(
    (base) => pathname === base || (base !== '/' && pathname.startsWith(`${base}/`))
  );
}

export function getPanelTitle(role: PanelRole): string {
  return role === 'operations' ? 'Operations Panel' : 'Admin Panel';
}

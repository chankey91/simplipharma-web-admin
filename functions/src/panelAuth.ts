import * as admin from 'firebase-admin';

export type PanelRole = 'admin' | 'operations';

export async function getUserRole(uid: string): Promise<string | undefined> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  return userDoc.exists ? userDoc.data()?.role : undefined;
}

export function isAdminRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'Admin';
}

export function isOperationsRole(role: string | undefined): boolean {
  return role === 'operations' || role === 'Operations';
}

export function isAdminOrOperationsRole(role: string | undefined): boolean {
  return isAdminRole(role) || isOperationsRole(role);
}

export function isPanelRole(role: string | undefined): boolean {
  return isAdminOrOperationsRole(role);
}

export function isSalesOfficerRole(role: string | undefined): boolean {
  return role === 'salesOfficer' || role === 'SalesOfficer';
}

export function isPurchaseOfficerRole(role: string | undefined): boolean {
  return role === 'purchaseOfficer' || role === 'PurchaseOfficer';
}

export function isRetailerRole(role: string | undefined): boolean {
  return role === 'retailer' || role === 'Retailer';
}

export async function assertAdminOrOperations(uid: string): Promise<void> {
  const role = await getUserRole(uid);
  if (!isAdminOrOperationsRole(role)) {
    throw new Error('PERMISSION_DENIED');
  }
}

export async function assertAdmin(uid: string): Promise<void> {
  const role = await getUserRole(uid);
  if (!isAdminRole(role)) {
    throw new Error('PERMISSION_DENIED');
  }
}

import {
  addDoc,
  collection,
  db,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  where,
  auth,
  Timestamp,
} from './firebase';
import type { Vendor } from '../types';
import type { PurchaseOrderExcelLine } from '../utils/purchaseOrderDraftExcel';

export type PurchaseOrderDraftLine = {
  productId: string;
  excelName: string;
  quantity: number;
  medicineId?: string;
  medicineName?: string;
};

export type PurchaseOrderDraft = {
  id: string;
  vendorId?: string;
  vendorName: string;
  status: 'open' | 'used';
  sourceFileName?: string;
  lines: PurchaseOrderDraftLine[];
  createdAt?: Timestamp | Date | null;
  createdBy?: string;
};

function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchVendor(name: string, vendors: Vendor[]): Vendor | undefined {
  const key = normName(name);
  if (!key) return undefined;
  const active = vendors.filter((vendor) => vendor.isActive !== false);
  return (
    active.find((vendor) => normName(vendor.vendorName || '') === key) ||
    active.find((vendor) => {
      const vendorKey = normName(vendor.vendorName || '');
      return vendorKey.length > 3 && (vendorKey.includes(key) || key.includes(vendorKey));
    })
  );
}

export async function findMedicinesByProductIds(
  productIds: string[]
): Promise<Map<string, { id: string; name: string; productId: string }>> {
  const wanted = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  const found = new Map<string, { id: string; name: string; productId: string }>();
  if (!wanted.length) return found;

  const queryIds = new Set<string>();
  for (const id of wanted) {
    queryIds.add(id);
    queryIds.add(id.toUpperCase());
  }
  const ids = [...queryIds];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, 'medicines'), where('productId', 'in', chunk)));
    for (const row of snap.docs) {
      const data = row.data();
      const productId = String(data.productId || '').trim();
      if (!productId) continue;
      found.set(productId.toLowerCase(), {
        id: row.id,
        name: String(data.name || '').trim() || productId,
        productId,
      });
    }
  }
  return found;
}

export function buildDraftGroups(
  lines: PurchaseOrderExcelLine[],
  vendors: Vendor[],
  medicines: Map<string, { id: string; name: string; productId: string }>
): Array<{
  vendorName: string;
  vendorId?: string;
  lines: PurchaseOrderDraftLine[];
}> {
  const groups = new Map<string, { vendorName: string; vendorId?: string; lines: PurchaseOrderDraftLine[] }>();
  for (const line of lines) {
    const vendorName = line.vendorName.trim() || 'No vendor';
    const key = normName(vendorName) || 'no vendor';
    const vendor = matchVendor(vendorName, vendors);
    const group = groups.get(key) ?? {
      vendorName: vendor?.vendorName || vendorName,
      vendorId: vendor?.id,
      lines: [],
    };
    const medicine = line.productId ? medicines.get(line.productId.trim().toLowerCase()) : undefined;
    group.lines.push({
      productId: line.productId.trim(),
      excelName: line.itemName.trim(),
      quantity: line.quantity,
      medicineId: medicine?.id,
      medicineName: medicine?.name,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function savePurchaseOrderDrafts(
  groups: Array<{ vendorName: string; vendorId?: string; lines: PurchaseOrderDraftLine[] }>,
  sourceFileName: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');
  for (const group of groups) {
    const lines = group.lines.filter((line) => line.quantity > 0 || line.productId || line.excelName);
    if (!lines.length) continue;
    await addDoc(collection(db, 'purchaseOrderDrafts'), {
      vendorName: group.vendorName,
      ...(group.vendorId ? { vendorId: group.vendorId } : {}),
      status: 'open',
      sourceFileName,
      lines,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
  }
}

function createdMs(value: PurchaseOrderDraft['createdAt']): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

export async function listOpenPurchaseOrderDrafts(): Promise<PurchaseOrderDraft[]> {
  const snap = await getDocs(query(collection(db, 'purchaseOrderDrafts'), where('status', '==', 'open')));
  return snap.docs
    .map((row) => ({ id: row.id, ...(row.data() as Omit<PurchaseOrderDraft, 'id'>) }))
    .sort((a, b) => createdMs(b.createdAt) - createdMs(a.createdAt));
}

export async function getPurchaseOrderDraft(id: string): Promise<PurchaseOrderDraft | null> {
  const row = await getDoc(doc(db, 'purchaseOrderDrafts', id));
  if (!row.exists()) return null;
  return { id: row.id, ...(row.data() as Omit<PurchaseOrderDraft, 'id'>) };
}

export async function markPurchaseOrderDraftUsed(id: string): Promise<void> {
  await updateDoc(doc(db, 'purchaseOrderDrafts', id), { status: 'used', usedAt: serverTimestamp() });
}

import { collection, getDocs, getDoc, doc, query, where, orderBy, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import type { PurchaseItemStatus } from '../utils/purchaseListStatus';

export type PurchaseListStatus = 'open' | 'confirmed' | 'superseded';

export interface PurchaseList {
  id: string;
  fromDate: string;
  toDate: string;
  status: PurchaseListStatus;
  createdBy: string;
  source?: string;
  createdAt?: unknown;
  publishedAt?: unknown;
  confirmedAt?: unknown;
  confirmedBy?: string;
  supersededAt?: unknown;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  invoiceUploadedAt?: unknown;
  itemCount?: number;
  totalQtyNeeded?: number;
  pendingOrderCount?: number;
  eliminatedCount?: number;
  reducedCount?: number;
}

export interface PurchaseListItem {
  id: string;
  medicineId: string;
  medicineName: string;
  manufacturer: string;
  totalQty: number;
  grossQty?: number;
  coveredQty?: number;
  orderCount: number;
  orderNumbers: string[];
  status: PurchaseItemStatus;
  foundQty: number | null;
  remark?: string;
  updatedBy?: string;
  updatedAt?: unknown;
}

export type PublishPurchaseListNetResult = {
  listId: string | null;
  itemCount: number;
  totalQtyNeeded: number;
  pendingOrderCount: number;
  eliminatedCount: number;
  reducedCount: number;
  supersededOpenLists: number;
  fromDate: string;
  toDate: string;
  message: string;
};

/**
 * Publish / merge purchase need for a day (default today IST).
 * Same-day open list is merged (need increases, found kept, groups reopen).
 */
export async function publishPurchaseListNet(args?: {
  dateStr?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<PublishPurchaseListNetResult> {
  const fn = httpsCallable<
    { dateStr?: string; fromDate?: string; toDate?: string },
    PublishPurchaseListNetResult
  >(functions, 'publishPurchaseListNet');
  const result = await fn(args || {});
  return result.data;
}

/** Publish for a date range (manual admin). Uses cloud function net logic. */
export async function publishPurchaseList(args: {
  orders: unknown[];
  fromDate: string;
  toDate: string;
}): Promise<{
  listId: string;
  itemCount: number;
  eliminatedCount?: number;
  reducedCount?: number;
  message?: string;
}> {
  const result = await publishPurchaseListNet({
    fromDate: args.fromDate,
    toDate: args.toDate,
  });
  if (!result.listId && result.itemCount === 0) {
    throw new Error(result.message || 'Nothing to publish');
  }
  return {
    listId: result.listId || '',
    itemCount: result.itemCount,
    eliminatedCount: result.eliminatedCount,
    reducedCount: result.reducedCount,
    message: result.message,
  };
}

export async function getPurchaseLists(): Promise<PurchaseList[]> {
  const snap = await getDocs(query(collection(db, 'purchaseLists'), orderBy('publishedAt', 'desc')));
  return snap.docs.map(
    (d) =>
      ({
        id: d.id,
        ...d.data(),
      }) as PurchaseList
  );
}

export async function getOpenPurchaseLists(): Promise<PurchaseList[]> {
  const snap = await getDocs(query(collection(db, 'purchaseLists'), where('status', '==', 'open')));
  const lists = snap.docs.map(
    (d) =>
      ({
        id: d.id,
        ...d.data(),
      }) as PurchaseList
  );
  lists.sort((a, b) => {
    const ta = (a.publishedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tb = (b.publishedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return lists;
}

export async function getPurchaseListById(listId: string): Promise<PurchaseList | null> {
  const snap = await getDoc(doc(db, 'purchaseLists', listId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as PurchaseList;
}

export async function getPurchaseListItems(listId: string): Promise<PurchaseListItem[]> {
  const snap = await getDocs(collection(db, 'purchaseLists', listId, 'items'));
  return snap.docs.map(
    (d) =>
      ({
        id: d.id,
        ...d.data(),
      }) as PurchaseListItem
  );
}

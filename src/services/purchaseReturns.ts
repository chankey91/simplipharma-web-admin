import {
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  orderBy,
  Timestamp,
  serverTimestamp,
  db,
  getDoc,
  where,
  auth,
  updateDoc,
} from './firebase';
import { PurchaseReturn, PurchaseReturnItem } from '../types';
import { reduceStockBatchesFromMedicine } from './inventory';
import { generatePurchaseReturnNumber } from '../utils/invoiceNumber';
import { createInwardGstSnapshot } from './gstDocuments';
import { assertDocumentDateWritable } from './gstPeriods';
import { gstLinesFromPurchaseItems } from '../utils/gstLineSnapshot';
import {
  derivePurchaseReturnFulfillmentStatus,
  itemReturnOutcome,
} from '../utils/purchaseReturnFulfillment';

function mapPurchaseReturnDoc(docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}): PurchaseReturn {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    returnNumber: String(data.returnNumber ?? ''),
    vendorId: String(data.vendorId ?? ''),
    vendorName: String(data.vendorName ?? ''),
    returnDate: (data.returnDate as { toDate?: () => Date })?.toDate?.() || new Date(),
    createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(),
    createdBy: String(data.createdBy ?? ''),
    subTotal: Number(data.subTotal ?? 0),
    taxAmount: Number(data.taxAmount ?? 0),
    totalAmount: Number(data.totalAmount ?? 0),
    notes: data.notes != null ? String(data.notes) : undefined,
    reason: data.reason != null ? String(data.reason) : undefined,
    vendorGstin: data.vendorGstin != null ? String(data.vendorGstin) : undefined,
    gst: data.gst as PurchaseReturn['gst'],
    fulfillmentStatus:
      data.fulfillmentStatus === 'pending' ||
      data.fulfillmentStatus === 'partial' ||
      data.fulfillmentStatus === 'completed'
        ? data.fulfillmentStatus
        : undefined,
    items:
      (data.items as unknown[])?.map((item: unknown) => {
        const it = item as Record<string, unknown>;
        return {
          medicineId: String(it.medicineId ?? ''),
          medicineName: String(it.medicineName ?? ''),
          batchNumber: String(it.batchNumber ?? ''),
          quantity: Number(it.quantity ?? 0),
          unitPrice: Number(it.unitPrice ?? 0),
          purchasePrice: Number(it.purchasePrice ?? 0),
          mrp:
            it.mrp !== undefined && it.mrp !== null
              ? typeof it.mrp === 'number'
                ? it.mrp
                : parseFloat(String(it.mrp))
              : undefined,
          gstRate:
            it.gstRate !== undefined && it.gstRate !== null
              ? typeof it.gstRate === 'number'
                ? it.gstRate
                : parseFloat(String(it.gstRate))
              : undefined,
          expiryDate: (it.expiryDate as { toDate?: () => Date })?.toDate?.() || undefined,
          totalAmount: Number(it.totalAmount ?? 0),
          returnOutcome:
            it.returnOutcome === 'returned' ||
            it.returnOutcome === 'not_returned' ||
            it.returnOutcome === 'pending'
              ? it.returnOutcome
              : undefined,
          stockDeducted:
            it.stockDeducted === true ? true : it.stockDeducted === false ? false : undefined,
          returnedAt: (it.returnedAt as { toDate?: () => Date })?.toDate?.() || undefined,
        } as PurchaseReturnItem;
      }) || [],
  };
}

export const getAllPurchaseReturns = async (): Promise<PurchaseReturn[]> => {
  const col = collection(db, 'purchaseReturns');
  try {
    const q = query(col, orderBy('returnDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => mapPurchaseReturnDoc(docSnap));
  } catch (error) {
    console.warn('Purchase returns orderBy failed, sorting in memory:', error);
    const snapshot = await getDocs(col);
    const rows = snapshot.docs.map((docSnap) => mapPurchaseReturnDoc(docSnap));
    return rows.sort((a, b) => {
      const dateA = a.returnDate instanceof Date ? a.returnDate : new Date(a.returnDate);
      const dateB = b.returnDate instanceof Date ? b.returnDate : new Date(b.returnDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

export const getPurchaseReturnsByVendor = async (vendorId: string): Promise<PurchaseReturn[]> => {
  const col = collection(db, 'purchaseReturns');
  try {
    const q = query(col, where('vendorId', '==', vendorId), orderBy('returnDate', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => mapPurchaseReturnDoc(docSnap));
  } catch (error) {
    console.warn('getPurchaseReturnsByVendor query failed, falling back:', error);
    const all = await getAllPurchaseReturns();
    return all
      .filter((r) => r.vendorId === vendorId)
      .sort((a, b) => {
        const dateA = a.returnDate instanceof Date ? a.returnDate : new Date(a.returnDate);
        const dateB = b.returnDate instanceof Date ? b.returnDate : new Date(b.returnDate);
        return dateA.getTime() - dateB.getTime();
      });
  }
};

export const getPurchaseReturnsInRange = async (
  startMs: number,
  endMs?: number
): Promise<PurchaseReturn[]> => {
  const col = collection(db, 'purchaseReturns');
  const start = Timestamp.fromMillis(startMs);
  try {
    const q =
      endMs != null
        ? query(
            col,
            where('returnDate', '>=', start),
            where('returnDate', '<', Timestamp.fromMillis(endMs)),
            orderBy('returnDate', 'desc')
          )
        : query(col, where('returnDate', '>=', start), orderBy('returnDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => mapPurchaseReturnDoc(docSnap));
  } catch (error) {
    console.warn('getPurchaseReturnsInRange fallback:', error);
    const all = await getAllPurchaseReturns();
    return all.filter((row) => {
      const t =
        row.returnDate instanceof Date
          ? row.returnDate.getTime()
          : new Date(row.returnDate as string | number).getTime();
      if (endMs != null) return t >= startMs && t < endMs;
      return t >= startMs;
    });
  }
};

export const getPurchaseReturnById = async (
  returnId: string
): Promise<PurchaseReturn | null> => {
  const snap = await getDoc(doc(db, 'purchaseReturns', returnId));
  if (!snap.exists()) return null;
  return mapPurchaseReturnDoc(snap);
};

function serializeItem(item: PurchaseReturnItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    medicineId: item.medicineId,
    medicineName: item.medicineName,
    batchNumber: item.batchNumber,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    purchasePrice: item.purchasePrice,
    totalAmount: item.totalAmount,
  };
  if (item.mrp != null && !Number.isNaN(item.mrp)) row.mrp = item.mrp;
  if (item.gstRate != null && !Number.isNaN(item.gstRate)) row.gstRate = item.gstRate;
  if (item.expiryDate) {
    row.expiryDate =
      item.expiryDate instanceof Date
        ? Timestamp.fromDate(item.expiryDate)
        : item.expiryDate;
  }
  if (item.returnOutcome === 'returned' || item.returnOutcome === 'not_returned' || item.returnOutcome === 'pending') {
    row.returnOutcome = item.returnOutcome;
  }
  if (item.stockDeducted === true) row.stockDeducted = true;
  if (item.returnedAt) {
    row.returnedAt =
      item.returnedAt instanceof Date
        ? Timestamp.fromDate(item.returnedAt)
        : item.returnedAt;
  }
  return row;
}

export type CreatePurchaseReturnInput = Omit<
  PurchaseReturn,
  'id' | 'returnNumber' | 'createdAt' | 'createdBy'
> & {
  returnNumber?: string;
};

/**
 * Create a purchase return list for a vendor.
 * Stock is deducted later, when items are marked returned.
 */
export const createPurchaseReturn = async (
  input: CreatePurchaseReturnInput
): Promise<{ id: string; returnNumber: string }> => {
  if (!input.vendorId?.trim()) throw new Error('Vendor is required');
  if (!input.items?.length) throw new Error('Add at least one item to return');
  await assertDocumentDateWritable(input.returnDate || new Date());

  for (const item of input.items) {
    if (!item.medicineId || !item.batchNumber?.trim()) {
      throw new Error(`Invalid item: ${item.medicineName || 'unknown'}`);
    }
    if (!(item.quantity > 0)) {
      throw new Error(`Return quantity must be > 0 for ${item.medicineName}`);
    }
  }

  const returnNumber = input.returnNumber?.trim() || (await generatePurchaseReturnNumber());
  const returnRef = doc(collection(db, 'purchaseReturns'));
  const items = input.items.map((item) =>
    serializeItem({
      ...item,
      returnOutcome: 'pending',
      stockDeducted: false,
    })
  );

  const payload: Record<string, unknown> = {
    returnNumber,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    returnDate:
      input.returnDate instanceof Date
        ? Timestamp.fromDate(input.returnDate)
        : Timestamp.fromDate(new Date(input.returnDate)),
    items,
    subTotal: Math.round((input.subTotal ?? 0) * 100) / 100,
    taxAmount: Math.round((input.taxAmount ?? 0) * 100) / 100,
    totalAmount: Math.round((input.totalAmount ?? 0) * 100) / 100,
    fulfillmentStatus: 'pending',
    createdBy: auth.currentUser?.uid || '',
    createdAt: serverTimestamp(),
  };
  if (input.notes?.trim()) payload.notes = input.notes.trim();
  if (input.reason?.trim()) payload.reason = input.reason.trim();
  if (input.vendorGstin?.trim()) payload.vendorGstin = input.vendorGstin.trim();

  try {
    payload.gst = await createInwardGstSnapshot({
      taxAmount: Number(payload.taxAmount) || 0,
      taxableValue: Number(payload.subTotal) || 0,
      vendorGstin: input.vendorGstin,
      vendorName: input.vendorName,
      lines: gstLinesFromPurchaseItems(
        input.items,
        Number(payload.subTotal) || 0,
        Number(payload.taxAmount) || 0
      ),
    });
  } catch (error) {
    console.warn('GST snapshot skipped on purchase return:', error);
  }

  await setDoc(returnRef, payload);
  return { id: returnRef.id, returnNumber };
};

/**
 * Create one purchase return per vendor group (multi-vendor session on one screen).
 */
export const createPurchaseReturnsMultiVendor = async (
  inputs: CreatePurchaseReturnInput[]
): Promise<Array<{ id: string; returnNumber: string; vendorName: string }>> => {
  if (!inputs.length) throw new Error('Nothing to save');
  const results: Array<{ id: string; returnNumber: string; vendorName: string }> = [];
  for (const input of inputs) {
    const created = await createPurchaseReturn(input);
    results.push({ ...created, vendorName: input.vendorName });
  }
  return results;
};

export type PurchaseReturnItemOutcomeUpdate = {
  index: number;
  outcome: 'returned' | 'not_returned';
};

/**
 * Mark return lines as taken back by the vendor (deducts stock) or not returned.
 * Already-returned lines are left unchanged.
 */
export const updatePurchaseReturnItemOutcomes = async (
  returnId: string,
  updates: PurchaseReturnItemOutcomeUpdate[]
): Promise<PurchaseReturn> => {
  const existing = await getPurchaseReturnById(returnId);
  if (!existing) throw new Error('Purchase return not found');
  if (!updates.length) return existing;

  const items = [...(existing.items || [])];
  const toDeduct: Array<{ medicineId: string; batchNumber: string; quantity: number }> = [];

  for (const update of updates) {
    const item = items[update.index];
    if (!item) continue;
    const current = itemReturnOutcome(item, existing);
    if (current === 'returned') continue;

    if (update.outcome === 'returned') {
      if (!item.stockDeducted) {
        toDeduct.push({
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
        });
      }
      items[update.index] = {
        ...item,
        returnOutcome: 'returned',
        stockDeducted: true,
        returnedAt: new Date(),
      };
    } else if (current === 'pending') {
      items[update.index] = {
        ...item,
        returnOutcome: 'not_returned',
        stockDeducted: false,
      };
    }
  }

  const grouped = new Map<string, Array<{ batchNumber: string; quantity: number }>>();
  for (const row of toDeduct) {
    const list = grouped.get(row.medicineId) || [];
    const key = row.batchNumber.trim().toLowerCase();
    const found = list.find((d) => d.batchNumber.trim().toLowerCase() === key);
    if (found) found.quantity += row.quantity;
    else list.push({ batchNumber: row.batchNumber, quantity: row.quantity });
    grouped.set(row.medicineId, list);
  }

  for (const [medicineId, deductions] of grouped) {
    await reduceStockBatchesFromMedicine(medicineId, deductions);
  }

  const fulfillmentStatus = derivePurchaseReturnFulfillmentStatus(items);

  await updateDoc(doc(db, 'purchaseReturns', returnId), {
    items: items.map(serializeItem),
    fulfillmentStatus,
  });

  const refreshed = await getPurchaseReturnById(returnId);
  if (!refreshed) throw new Error('Purchase return not found after update');
  return refreshed;
};

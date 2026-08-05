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
} from './firebase';
import { PurchaseReturn, PurchaseReturnItem } from '../types';
import { reduceStockFromBatch } from './inventory';
import { generatePurchaseReturnNumber } from '../utils/invoiceNumber';

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
  return row;
}

export type CreatePurchaseReturnInput = Omit<
  PurchaseReturn,
  'id' | 'returnNumber' | 'createdAt' | 'createdBy'
> & {
  returnNumber?: string;
};

/**
 * Create a purchase return: deduct stock per line, then persist the document.
 * Stock is reduced before the doc write; if the write fails after stock moves, the error is thrown.
 */
export const createPurchaseReturn = async (
  input: CreatePurchaseReturnInput
): Promise<{ id: string; returnNumber: string }> => {
  if (!input.vendorId?.trim()) throw new Error('Vendor is required');
  if (!input.items?.length) throw new Error('Add at least one item to return');

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

  for (const item of input.items) {
    await reduceStockFromBatch(item.medicineId, item.batchNumber, item.quantity);
  }

  const payload: Record<string, unknown> = {
    returnNumber,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    returnDate:
      input.returnDate instanceof Date
        ? Timestamp.fromDate(input.returnDate)
        : Timestamp.fromDate(new Date(input.returnDate)),
    items: input.items.map(serializeItem),
    subTotal: Math.round((input.subTotal ?? 0) * 100) / 100,
    taxAmount: Math.round((input.taxAmount ?? 0) * 100) / 100,
    totalAmount: Math.round((input.totalAmount ?? 0) * 100) / 100,
    createdBy: auth.currentUser?.uid || '',
    createdAt: serverTimestamp(),
  };
  if (input.notes?.trim()) payload.notes = input.notes.trim();
  if (input.reason?.trim()) payload.reason = input.reason.trim();

  await setDoc(returnRef, payload);
  return { id: returnRef.id, returnNumber };
};

/**
 * Create one purchase return per vendor group (multi-vendor session on one screen).
 * Processes groups sequentially so stock deductions stay consistent.
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

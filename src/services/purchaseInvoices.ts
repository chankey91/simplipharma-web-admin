import { collection, getDocs, doc, setDoc, updateDoc, query, orderBy, Timestamp, serverTimestamp, db, getDoc, where, deleteField, deleteDoc } from './firebase';
import { ProductDemand, PurchaseInvoice, PurchaseInvoiceItem, VendorInvoicePayment } from '../types';
import {
  addStockBatchesToMedicine,
  reduceStockBatchesFromMedicineSoft,
} from './inventory';
import { attachLandedCostToBatchData } from '../utils/purchaseInvoiceLandedCost';
import { attachStandardDiscountToBatchData } from '../utils/orderFulfillmentDiscount';
import { purchaseItemStockBatchNumber } from '../utils/purchaseInvoiceBatch';

function mapVendorPayments(raw: unknown): VendorInvoicePayment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((p, i) => {
    const row = p as Record<string, unknown>;
    return {
      id: String(row.id ?? `pay-${i}`),
      amount: Number(row.amount ?? 0),
      paymentDate:
        (row.paymentDate as { toDate?: () => Date })?.toDate?.() ||
        (row.paymentDate ? new Date(row.paymentDate as string | number | Date) : new Date()),
      paymentMethod: row.paymentMethod as VendorInvoicePayment['paymentMethod'],
      transactionId: row.transactionId ? String(row.transactionId) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
    };
  });
}

function mapPurchaseInvoiceDoc(docSnap: { id: string; data: () => Record<string, unknown> }): PurchaseInvoice {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    invoiceDate: (data.invoiceDate as { toDate?: () => Date })?.toDate?.() || new Date(),
    createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(),
    paidAt: (data.paidAt as { toDate?: () => Date })?.toDate?.() || undefined,
    payments: mapVendorPayments(data.payments),
    items:
      (data.items as unknown[])?.map((item: unknown) => {
        const it = item as Record<string, unknown>;
        return {
          ...it,
          mfgDate: (it.mfgDate as { toDate?: () => Date })?.toDate?.() || undefined,
          expiryDate: (it.expiryDate as { toDate?: () => Date })?.toDate?.() || undefined,
          mrp:
            it.mrp !== undefined && it.mrp !== null
              ? typeof it.mrp === 'number'
                ? it.mrp
                : parseFloat(String(it.mrp))
              : undefined,
          standardDiscount:
            it.standardDiscount !== undefined && it.standardDiscount !== null
              ? typeof it.standardDiscount === 'number'
                ? it.standardDiscount
                : parseFloat(String(it.standardDiscount))
              : undefined,
        };
      }) || [],
  } as PurchaseInvoice;
}

export const getAllPurchaseInvoices = async (): Promise<PurchaseInvoice[]> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  try {
    const q = query(invoicesCol, orderBy('invoiceDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => mapPurchaseInvoiceDoc(docSnap));
  } catch (error) {
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(invoicesCol);
    const invoices = snapshot.docs.map((docSnap) => mapPurchaseInvoiceDoc(docSnap));
    
    return invoices.sort((a, b) => {
      const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : new Date(a.invoiceDate);
      const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : new Date(b.invoiceDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

/** Unpaid / partial purchase bills only — for vendor ledger (not the full collection). */
export const getPayablePurchaseInvoices = async (): Promise<PurchaseInvoice[]> => {
  const invoicesCol = collection(db, 'purchaseInvoices');

  try {
    const [unpaidSnap, partialSnap] = await Promise.all([
      getDocs(query(invoicesCol, where('paymentStatus', '==', 'Unpaid'))),
      getDocs(query(invoicesCol, where('paymentStatus', '==', 'Partial'))),
    ]);
    const byId = new Map<string, PurchaseInvoice>();
    for (const docSnap of [...unpaidSnap.docs, ...partialSnap.docs]) {
      byId.set(docSnap.id, mapPurchaseInvoiceDoc(docSnap));
    }
    return [...byId.values()].sort((a, b) => {
      const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : new Date(a.invoiceDate);
      const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : new Date(b.invoiceDate);
      return dateB.getTime() - dateA.getTime();
    });
  } catch (error) {
    console.warn('getPayablePurchaseInvoices query failed, falling back to full scan:', error);
    const all = await getAllPurchaseInvoices();
    return all.filter((inv) => inv.paymentStatus === 'Unpaid' || inv.paymentStatus === 'Partial' || !inv.paymentStatus);
  }
};

/** All purchase invoices for one vendor (for vendor ledger). */
export const getPurchaseInvoicesByVendor = async (vendorId: string): Promise<PurchaseInvoice[]> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  try {
    const q = query(invoicesCol, where('vendorId', '==', vendorId), orderBy('invoiceDate', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => mapPurchaseInvoiceDoc(docSnap));
  } catch (error) {
    console.warn('getPurchaseInvoicesByVendor query failed, falling back to full scan:', error);
    const all = await getAllPurchaseInvoices();
    return all
      .filter((inv) => inv.vendorId === vendorId)
      .sort((a, b) => {
        const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : new Date(a.invoiceDate);
        const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : new Date(b.invoiceDate);
        return dateA.getTime() - dateB.getTime();
      });
  }
};

export const getPurchaseInvoiceById = async (invoiceId: string): Promise<PurchaseInvoice | null> => {
  const invoiceRef = doc(db, 'purchaseInvoices', invoiceId);
  const invoiceDoc = await getDoc(invoiceRef);

  if (!invoiceDoc.exists()) return null;

  return mapPurchaseInvoiceDoc(invoiceDoc);
};

/** Resolve PI by Firestore id or human-readable invoice number (as stored on product demands). */
export const getPurchaseInvoiceByReference = async (
  reference: string
): Promise<PurchaseInvoice | null> => {
  const ref = reference.trim();
  if (!ref) return null;

  const byId = await getPurchaseInvoiceById(ref);
  if (byId) return byId;

  const invoicesCol = collection(db, 'purchaseInvoices');
  const q = query(invoicesCol, where('invoiceNumber', '==', ref));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return getPurchaseInvoiceById(snapshot.docs[0].id);
};

/** Load PI docs referenced on demands (by Firestore id or invoice number) for order-line repair. */
export const collectPurchaseInvoicesForDemands = async (
  base: PurchaseInvoice[] | undefined,
  demands: ProductDemand[],
  extraRefs: string[] = []
): Promise<PurchaseInvoice[]> => {
  const byId = new Map<string, PurchaseInvoice>();
  for (const inv of base ?? []) {
    byId.set(inv.id, inv);
  }

  const refs = new Set<string>();
  for (const d of demands) {
    const r = d.purchaseInvoiceId?.trim();
    if (r) refs.add(r);
  }
  for (const r of extraRefs) {
    const t = r.trim();
    if (t) refs.add(t);
  }

  await Promise.all(
    [...refs].map(async (ref) => {
      const inv = await getPurchaseInvoiceByReference(ref);
      if (inv) byId.set(inv.id, inv);
    })
  );

  return [...byId.values()].sort((a, b) => {
    const ta = a.invoiceDate instanceof Date ? a.invoiceDate.getTime() : new Date(a.invoiceDate).getTime();
    const tb = b.invoiceDate instanceof Date ? b.invoiceDate.getTime() : new Date(b.invoiceDate).getTime();
    return tb - ta;
  });
};

export const checkInvoiceNumberUnique = async (invoiceNumber: string, excludeId?: string): Promise<boolean> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  const q = query(invoicesCol, where('invoiceNumber', '==', invoiceNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

// Helper function to remove undefined values from an object
const removeUndefined = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        cleaned[key] = removeUndefined(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
};

export type CreatePurchaseInvoiceProgress = {
  phase: 'saving_invoice' | 'updating_stock' | 'done';
  current: number;
  total: number;
  medicineName?: string;
  batchNumber?: string;
};

export const createPurchaseInvoice = async (
  invoiceData: Omit<PurchaseInvoice, 'id'>,
  updateStock: boolean = true,
  onProgress?: (progress: CreatePurchaseInvoiceProgress) => void
) => {
  // Check invoice number uniqueness
  const isUnique = await checkInvoiceNumberUnique(invoiceData.invoiceNumber);
  if (!isUnique) {
    throw new Error('Invoice Number already exists');
  }
  
  const invoiceRef = doc(collection(db, 'purchaseInvoices'));
  
  // Prepare items with proper date conversion and remove undefined values
  const items = invoiceData.items.map(item => {
    const cleanedItem: any = {
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      purchasePrice: item.purchasePrice,
      totalAmount: item.totalAmount,
    };
    
    // Add optional fields only if they exist
    if (item.mfgDate) {
      cleanedItem.mfgDate = item.mfgDate instanceof Date ? Timestamp.fromDate(item.mfgDate) : item.mfgDate;
    }
    if (item.expiryDate) {
      cleanedItem.expiryDate = item.expiryDate instanceof Date ? Timestamp.fromDate(item.expiryDate) : item.expiryDate;
    }
    if (item.mrp !== undefined && item.mrp !== null) {
      cleanedItem.mrp = item.mrp;
    }
    if (item.freeQuantity !== undefined && item.freeQuantity !== null) {
      cleanedItem.freeQuantity = item.freeQuantity;
    }
    if (
      item.schemePaidQty !== undefined &&
      item.schemePaidQty !== null &&
      item.schemeFreeQty !== undefined &&
      item.schemeFreeQty !== null
    ) {
      const sp = typeof item.schemePaidQty === 'number' ? item.schemePaidQty : parseFloat(String(item.schemePaidQty));
      const sf = typeof item.schemeFreeQty === 'number' ? item.schemeFreeQty : parseFloat(String(item.schemeFreeQty));
      if (!isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0) {
        cleanedItem.schemePaidQty = Math.floor(sp);
        cleanedItem.schemeFreeQty = Math.floor(sf);
      }
    }
    if (item.gstRate !== undefined && item.gstRate !== null) {
      cleanedItem.gstRate = item.gstRate;
    }
    if (item.standardDiscount !== undefined && item.standardDiscount !== null) {
      const sd = typeof item.standardDiscount === 'number' ? item.standardDiscount : parseFloat(String(item.standardDiscount));
      if (!isNaN(sd)) {
        cleanedItem.standardDiscount = sd;
      }
    }
    if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
      cleanedItem.discountPercentage = item.discountPercentage;
    }
    if (item.qrCode) {
      cleanedItem.qrCode = item.qrCode;
    }
    if (item.nonReturnable === true) {
      cleanedItem.nonReturnable = true;
    }
    if (item.nrxDrug === true) {
      cleanedItem.nrxDrug = true;
    }
    const receivedBatch = String(item.receivedBatchNumber || '').trim();
    if (receivedBatch) {
      cleanedItem.receivedBatchNumber = receivedBatch;
    }

    return cleanedItem;
  });
  
  // Prepare invoice data, removing undefined values
  const invoiceDoc: any = {
    invoiceNumber: invoiceData.invoiceNumber,
    vendorId: invoiceData.vendorId,
    vendorName: invoiceData.vendorName,
    invoiceDate: invoiceData.invoiceDate instanceof Date 
      ? Timestamp.fromDate(invoiceData.invoiceDate)
      : invoiceData.invoiceDate,
    items,
    subTotal: invoiceData.subTotal,
    taxAmount: invoiceData.taxAmount,
    totalAmount: invoiceData.totalAmount,
    paymentStatus: invoiceData.paymentStatus,
    createdBy: invoiceData.createdBy,
    createdAt: serverTimestamp()
  };
  
  // Add optional fields only if they exist
  if (invoiceData.taxPercentage !== undefined && invoiceData.taxPercentage !== null) {
    invoiceDoc.taxPercentage = invoiceData.taxPercentage;
  }
  if (invoiceData.discount !== undefined && invoiceData.discount !== null) {
    invoiceDoc.discount = invoiceData.discount;
  }
  if (invoiceData.paymentMethod) {
    invoiceDoc.paymentMethod = invoiceData.paymentMethod;
  }
  if (invoiceData.notes) {
    invoiceDoc.notes = invoiceData.notes;
  }
  
  onProgress?.({
    phase: 'saving_invoice',
    current: 0,
    total: invoiceData.items.length,
  });

  await setDoc(invoiceRef, invoiceDoc);
  
  // Update medicine stock with purchase batches
  if (updateStock) {
    const stockUpdateErrors: string[] = [];

    // Group items by medicineId — one read/write per medicine, parallel across medicines.
    const itemsByMedicine = new Map<string, typeof invoiceData.items>();

    for (const item of invoiceData.items) {
      if (!item.medicineId) continue;

      if (!itemsByMedicine.has(item.medicineId)) {
        itemsByMedicine.set(item.medicineId, []);
      }
      itemsByMedicine.get(item.medicineId)!.push(item);
    }

    const stockItems = invoiceData.items.filter((i) => i.medicineId && i.batchNumber);
    let stockDone = 0;
    onProgress?.({
      phase: 'updating_stock',
      current: 0,
      total: Math.max(1, stockItems.length),
    });

    await Promise.all(
      [...itemsByMedicine.entries()].map(async ([medicineId, items]) => {
        const batchPayloads: Array<Record<string, unknown>> = [];
        const labels: string[] = [];

        for (const item of items) {
          try {
            if (!item.batchNumber) {
              throw new Error('Batch number is missing');
            }
            const totalQuantity = item.quantity + (item.freeQuantity || 0);
            if (!totalQuantity || totalQuantity <= 0) {
              throw new Error('Invalid quantity');
            }
            if (!purchaseItemStockBatchNumber(item)) {
              throw new Error('Batch number is missing');
            }

            batchPayloads.push(
              buildStockBatchPayloadFromPurchaseItem(
                item,
                totalQuantity,
                invoiceData.invoiceDate
              )
            );
            labels.push(`${item.medicineName || medicineId} / ${item.batchNumber}`);
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const errorMsg = `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${msg}`;
            console.error(errorMsg, error);
            stockUpdateErrors.push(errorMsg);
            stockDone += 1;
            onProgress?.({
              phase: 'updating_stock',
              current: stockDone,
              total: Math.max(1, stockItems.length),
              medicineName: item.medicineName,
              batchNumber: item.batchNumber,
            });
          }
        }

        if (!batchPayloads.length) return;

        try {
          onProgress?.({
            phase: 'updating_stock',
            current: stockDone,
            total: Math.max(1, stockItems.length),
            medicineName: items[0]?.medicineName,
            batchNumber: items[0]?.batchNumber,
          });
          console.log(
            `Updating stock for medicine ${medicineId} with ${batchPayloads.length} batch(es)`
          );
          await addStockBatchesToMedicine(medicineId, batchPayloads as any);
          stockDone += batchPayloads.length;
          onProgress?.({
            phase: 'updating_stock',
            current: stockDone,
            total: Math.max(1, stockItems.length),
            medicineName: items[0]?.medicineName,
            batchNumber: items[items.length - 1]?.batchNumber,
          });
          console.log(`✓ Stock updated successfully for medicine ${medicineId}`);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          for (const label of labels) {
            const errorMsg = `Failed to update stock for ${label}: ${msg}`;
            console.error(errorMsg, error);
            stockUpdateErrors.push(errorMsg);
          }
          stockDone += batchPayloads.length;
          onProgress?.({
            phase: 'updating_stock',
            current: stockDone,
            total: Math.max(1, stockItems.length),
          });
        }
      })
    );

    console.log(
      `Stock update summary: ${invoiceData.items.length - stockUpdateErrors.length} successful, ${stockUpdateErrors.length} failed`
    );

    if (stockUpdateErrors.length > 0) {
      console.warn('Some stock updates failed:', stockUpdateErrors);
    }
  }

  onProgress?.({
    phase: 'done',
    current: invoiceData.items.length,
    total: Math.max(1, invoiceData.items.length),
  });
  return invoiceRef.id;
};

export const updatePurchaseInvoice = async (
  invoiceId: string,
  invoiceData: Partial<PurchaseInvoice>
) => {
  const invoiceRef = doc(db, 'purchaseInvoices', invoiceId);

  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(invoiceData)) {
    if (key === 'items' || key === 'invoiceDate') continue;
    if (value !== undefined) {
      updateData[key] = value;
    }
  }

  if (invoiceData.invoiceDate) {
    updateData.invoiceDate =
      invoiceData.invoiceDate instanceof Date
        ? Timestamp.fromDate(invoiceData.invoiceDate)
        : invoiceData.invoiceDate;
  }

  if (invoiceData.items) {
    updateData.items = invoiceData.items.map((item: PurchaseInvoiceItem) => {
      const cleanedItem: Record<string, unknown> = {
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        purchasePrice: item.purchasePrice,
        totalAmount: item.totalAmount,
      };

      if (item.mfgDate) {
        cleanedItem.mfgDate =
          item.mfgDate instanceof Date ? Timestamp.fromDate(item.mfgDate) : item.mfgDate;
      }
      if (item.expiryDate) {
        cleanedItem.expiryDate =
          item.expiryDate instanceof Date ? Timestamp.fromDate(item.expiryDate) : item.expiryDate;
      }
      if (item.mrp !== undefined && item.mrp !== null) {
        cleanedItem.mrp = item.mrp;
      }
      if (item.freeQuantity !== undefined && item.freeQuantity !== null) {
        cleanedItem.freeQuantity = item.freeQuantity;
      }
      if (
        item.schemePaidQty !== undefined &&
        item.schemePaidQty !== null &&
        item.schemeFreeQty !== undefined &&
        item.schemeFreeQty !== null
      ) {
        const sp =
          typeof item.schemePaidQty === 'number'
            ? item.schemePaidQty
            : parseFloat(String(item.schemePaidQty));
        const sf =
          typeof item.schemeFreeQty === 'number'
            ? item.schemeFreeQty
            : parseFloat(String(item.schemeFreeQty));
        if (!isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0) {
          cleanedItem.schemePaidQty = Math.floor(sp);
          cleanedItem.schemeFreeQty = Math.floor(sf);
        }
      }
      if (item.gstRate !== undefined && item.gstRate !== null) {
        cleanedItem.gstRate = item.gstRate;
      }
      if (item.standardDiscount !== undefined && item.standardDiscount !== null) {
        const sd =
          typeof item.standardDiscount === 'number'
            ? item.standardDiscount
            : parseFloat(String(item.standardDiscount));
        if (!isNaN(sd)) {
          cleanedItem.standardDiscount = sd;
        }
      }
      if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
        cleanedItem.discountPercentage = item.discountPercentage;
      }
      if (item.qrCode) {
        cleanedItem.qrCode = item.qrCode;
      }
      if (item.nonReturnable === true) {
        cleanedItem.nonReturnable = true;
      }
      if (item.nrxDrug === true) {
        cleanedItem.nrxDrug = true;
      }
      const receivedBatchUpd = String(item.receivedBatchNumber || '').trim();
      if (receivedBatchUpd) {
        cleanedItem.receivedBatchNumber = receivedBatchUpd;
      }

      return cleanedItem;
    });
  }

  await updateDoc(invoiceRef, updateData);
};

function purchaseLinePhysicalQty(item: PurchaseInvoiceItem): number {
  return (Number(item.quantity) || 0) + (Number(item.freeQuantity) || 0);
}

function purchaseStockLineKey(item: PurchaseInvoiceItem): string {
  return `${item.medicineId || ''}||${purchaseItemStockBatchNumber(item).toLowerCase()}`;
}

function buildStockBatchPayloadFromPurchaseItem(
  item: PurchaseInvoiceItem,
  quantity: number,
  invoiceDate?: Date | unknown
): Record<string, unknown> {
  const stockBatchNumber = purchaseItemStockBatchNumber(item);
  const invoiceBatch = String(item.batchNumber || '').trim();
  const receivedBatch = String(item.receivedBatchNumber || '').trim();
  const batchData: Record<string, unknown> = {
    batchNumber: stockBatchNumber,
    quantity,
    purchasePrice: item.purchasePrice || 0,
  };
  attachLandedCostToBatchData(batchData, item);
  if (item.mfgDate) {
    batchData.mfgDate = item.mfgDate instanceof Date ? item.mfgDate : new Date(item.mfgDate);
  }
  if (item.expiryDate) {
    batchData.expiryDate =
      item.expiryDate instanceof Date ? item.expiryDate : new Date(item.expiryDate);
  }
  if (invoiceDate) {
    batchData.purchaseDate =
      invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate as string | number | Date);
  }
  if (item.mrp !== undefined && item.mrp !== null) {
    const mrp = typeof item.mrp === 'number' ? item.mrp : parseFloat(String(item.mrp));
    if (!isNaN(mrp)) batchData.mrp = mrp;
  }
  if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
    const d =
      typeof item.discountPercentage === 'number'
        ? item.discountPercentage
        : parseFloat(String(item.discountPercentage));
    if (!isNaN(d)) batchData.discountPercentage = d;
  }
  attachStandardDiscountToBatchData(batchData, item);
  if (
    item.schemePaidQty != null &&
    item.schemeFreeQty != null
  ) {
    const sp =
      typeof item.schemePaidQty === 'number'
        ? item.schemePaidQty
        : parseFloat(String(item.schemePaidQty));
    const sf =
      typeof item.schemeFreeQty === 'number'
        ? item.schemeFreeQty
        : parseFloat(String(item.schemeFreeQty));
    if (!isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0) {
      batchData.schemePaidQty = Math.floor(sp);
      batchData.schemeFreeQty = Math.floor(sf);
    }
  }
  if (item.nonReturnable === true) {
    batchData.nonReturnable = true;
  }
  if (item.nrxDrug === true) {
    batchData.nrxDrug = true;
  }
  if (receivedBatch && invoiceBatch && receivedBatch.toLowerCase() !== invoiceBatch.toLowerCase()) {
    batchData.invoiceBatchNumber = invoiceBatch;
  }
  return batchData;
}

/**
 * Apply inventory deltas between previous and new PI lines (qty + free).
 * Net by medicine+batch so stock stays aligned after admin edits.
 */
export async function syncStockForPurchaseInvoiceEdit(
  oldItems: PurchaseInvoiceItem[],
  newItems: PurchaseInvoiceItem[],
  invoiceDate?: Date | unknown,
  onProgress?: (progress: CreatePurchaseInvoiceProgress) => void
): Promise<string[]> {
  type Agg = { qty: number; sample: PurchaseInvoiceItem };
  const oldMap = new Map<string, Agg>();
  const newMap = new Map<string, Agg>();

  for (const item of oldItems) {
    if (!item.medicineId || !item.batchNumber) continue;
    const key = purchaseStockLineKey(item);
    const prev = oldMap.get(key);
    const qty = purchaseLinePhysicalQty(item);
    if (prev) prev.qty += qty;
    else oldMap.set(key, { qty, sample: item });
  }
  for (const item of newItems) {
    if (!item.medicineId || !item.batchNumber) continue;
    const key = purchaseStockLineKey(item);
    const prev = newMap.get(key);
    const qty = purchaseLinePhysicalQty(item);
    if (prev) prev.qty += qty;
    else newMap.set(key, { qty, sample: item });
  }

  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const errors: string[] = [];
  let done = 0;
  const total = Math.max(1, keys.size);
  onProgress?.({ phase: 'updating_stock', current: 0, total });

  // Group deltas by medicine so each SKU is one soft-reduce + one upsert write (in parallel across SKUs).
  type MedDelta = {
    medicineId: string;
    reduces: Array<{ batchNumber: string; quantity: number; sample: PurchaseInvoiceItem }>;
    upserts: Array<{
      mode: 'addQty' | 'set';
      batch: Record<string, unknown>;
      sample: PurchaseInvoiceItem;
    }>;
  };
  const byMedicine = new Map<string, MedDelta>();

  for (const key of keys) {
    const oldAgg = oldMap.get(key);
    const newAgg = newMap.get(key);
    const oldQty = oldAgg?.qty ?? 0;
    const newQty = newAgg?.qty ?? 0;
    const delta = newQty - oldQty;
    const sample = newAgg?.sample || oldAgg?.sample;
    if (!sample?.medicineId || !sample.batchNumber) {
      done += 1;
      continue;
    }
    const stockBatchNumber = purchaseItemStockBatchNumber(sample);
    if (!stockBatchNumber) {
      done += 1;
      continue;
    }

    let entry = byMedicine.get(sample.medicineId);
    if (!entry) {
      entry = { medicineId: sample.medicineId, reduces: [], upserts: [] };
      byMedicine.set(sample.medicineId, entry);
    }

    if (delta < 0) {
      entry.reduces.push({
        batchNumber: stockBatchNumber,
        quantity: -delta,
        sample,
      });
    } else if (delta > 0) {
      entry.upserts.push({
        mode: 'addQty',
        batch: buildStockBatchPayloadFromPurchaseItem(sample, delta, invoiceDate),
        sample,
      });
    } else if (newAgg) {
      // Same qty — refresh batch metadata only (add 0), do not overwrite on-hand stock.
      entry.upserts.push({
        mode: 'addQty',
        batch: buildStockBatchPayloadFromPurchaseItem(sample, 0, invoiceDate),
        sample,
      });
    } else {
      done += 1;
    }
  }

  await Promise.all(
    [...byMedicine.values()].map(async (entry) => {
      const labelOf = (sample: PurchaseInvoiceItem, batchNumber: string) =>
        `${sample.medicineName || sample.medicineId} / ${batchNumber}`;

      onProgress?.({
        phase: 'updating_stock',
        current: done,
        total,
        medicineName: entry.reduces[0]?.sample.medicineName || entry.upserts[0]?.sample.medicineName,
        batchNumber:
          entry.reduces[0]?.batchNumber ||
          String(entry.upserts[0]?.batch.batchNumber || ''),
      });

      try {
        if (entry.reduces.length > 0) {
          const softResults = await reduceStockBatchesFromMedicineSoft(
            entry.medicineId,
            entry.reduces.map((r) => ({
              batchNumber: r.batchNumber,
              quantity: r.quantity,
            }))
          );
          for (let i = 0; i < softResults.length; i++) {
            const r = softResults[i];
            const sample = entry.reduces[i]?.sample;
            if (r.shortfall > 0 && sample) {
              errors.push(
                `${labelOf(sample, r.batchNumber)}: ` +
                  `could only reduce ${r.reduced} of ${entry.reduces[i].quantity} (available ${r.available}). Invoice qty still saved.`
              );
            }
          }
        }

        if (entry.upserts.length > 0) {
          await addStockBatchesToMedicine(
            entry.medicineId,
            entry.upserts.map((u) => u.batch as any),
            'addQty'
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const sample =
          entry.reduces[0]?.sample || entry.upserts[0]?.sample;
        const batchNumber =
          entry.reduces[0]?.batchNumber ||
          String(entry.upserts[0]?.batch.batchNumber || '');
        errors.push(
          `${sample ? labelOf(sample, batchNumber) : entry.medicineId}: ${msg}`
        );
      }

      done += entry.reduces.length + entry.upserts.length;
      onProgress?.({
        phase: 'updating_stock',
        current: Math.min(done, total),
        total,
      });
    })
  );

  return errors;
}

/**
 * Update an existing purchase invoice and sync inventory to match the new lines.
 * Invoice is always saved; stock sync is best-effort (warnings returned if partial).
 */
export const updatePurchaseInvoiceWithStock = async (
  invoiceId: string,
  invoiceData: Partial<PurchaseInvoice> & { items: PurchaseInvoiceItem[] },
  onProgress?: (progress: CreatePurchaseInvoiceProgress) => void
): Promise<{ stockSyncErrors: string[] }> => {
  const existing = await getPurchaseInvoiceById(invoiceId);
  if (!existing) {
    throw new Error('Invoice not found');
  }

  onProgress?.({
    phase: 'saving_invoice',
    current: 0,
    total: invoiceData.items.length,
  });

  await updatePurchaseInvoice(invoiceId, invoiceData);

  onProgress?.({
    phase: 'updating_stock',
    current: 0,
    total: Math.max(1, invoiceData.items.length),
  });

  const invoiceDate = invoiceData.invoiceDate ?? existing.invoiceDate;
  const stockSyncErrors = await syncStockForPurchaseInvoiceEdit(
    existing.items || [],
    invoiceData.items,
    invoiceDate,
    onProgress
  );

  onProgress?.({
    phase: 'done',
    current: invoiceData.items.length,
    total: Math.max(1, invoiceData.items.length),
  });

  return { stockSyncErrors };
};

/**
 * Delete a purchase bill and remove the stock it added (qty + free qty per batch).
 * Uses soft reduce so already-sold units are skipped; remaining on-hand is reverted.
 */
export const deletePurchaseInvoice = async (
  invoiceId: string
): Promise<{ stockSyncErrors: string[] }> => {
  const existing = await getPurchaseInvoiceById(invoiceId);
  if (!existing) {
    throw new Error('Invoice not found');
  }

  const stockSyncErrors = await syncStockForPurchaseInvoiceEdit(
    existing.items || [],
    [],
    existing.invoiceDate
  );

  await deleteDoc(doc(db, 'purchaseInvoices', invoiceId));
  return { stockSyncErrors };
};

export const updatePurchaseInvoicePayment = async (
  invoiceId: string,
  paymentStatus: 'Paid' | 'Unpaid' | 'Partial',
  paymentMethod?: 'Cash' | 'Online',
  paidAmount?: number,
  paymentDate?: Date,
  transactionId?: string
) => {
  const invoiceRef = doc(db, 'purchaseInvoices', invoiceId);
  const snap = await getDoc(invoiceRef);
  const existing = snap.exists() ? snap.data() : null;
  const total = typeof existing?.totalAmount === 'number' ? existing.totalAmount : 0;
  const prevPaid = typeof existing?.paidAmount === 'number' ? existing.paidAmount : 0;

  const updateData: Record<string, unknown> = { paymentStatus };
  if (paymentMethod) {
    updateData.paymentMethod = paymentMethod;
  }
  if (paidAmount !== undefined) {
    updateData.paidAmount = paidAmount;
  }
  if (paymentStatus === 'Paid' && paidAmount === undefined) {
    updateData.paidAmount = total;
  }
  if (paymentStatus === 'Unpaid') {
    updateData.paymentMethod = deleteField();
    updateData.paidAmount = 0;
    updateData.paidAt = deleteField();
    updateData.payments = deleteField();
    updateData.transactionId = deleteField();
  } else {
    if (transactionId !== undefined) {
      updateData.transactionId = transactionId || null;
    }
    const nextPaid =
      paymentStatus === 'Paid'
        ? paidAmount ?? total
        : paidAmount ?? prevPaid;
    const creditAmount = Math.max(0, nextPaid - prevPaid);
    if (creditAmount > 0) {
      const when = paymentDate ?? new Date();
      const existingPayments = mapVendorPayments(existing?.payments) ?? [];
      const voucher: VendorInvoicePayment = {
        id: `vip-${Date.now()}`,
        amount: creditAmount,
        paymentDate: when,
        paymentMethod: paymentMethod || (existing?.paymentMethod as VendorInvoicePayment['paymentMethod']),
        transactionId: transactionId || undefined,
      };
      updateData.payments = [
        ...existingPayments,
        {
          ...voucher,
          paymentDate: Timestamp.fromDate(when),
        },
      ];
      updateData.paidAt = Timestamp.fromDate(when);
    }
  }
  await updateDoc(invoiceRef, updateData);
};

export const updateStockForExistingInvoice = async (invoiceId: string) => {
  const invoice = await getPurchaseInvoiceById(invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const stockUpdateErrors: string[] = [];

  const itemsByMedicine = new Map<string, typeof invoice.items>();

  for (const item of invoice.items) {
    if (!item.medicineId) continue;

    if (!itemsByMedicine.has(item.medicineId)) {
      itemsByMedicine.set(item.medicineId, []);
    }
    itemsByMedicine.get(item.medicineId)!.push(item);
  }

  await Promise.all(
    [...itemsByMedicine.entries()].map(async ([medicineId, items]) => {
      const batchPayloads: Array<Record<string, unknown>> = [];
      const labels: string[] = [];

      for (const item of items) {
        try {
          if (!item.batchNumber) {
            throw new Error('Batch number is missing');
          }
          const totalQuantity = item.quantity + (item.freeQuantity || 0);
          if (!totalQuantity || totalQuantity <= 0) {
            throw new Error('Invalid quantity');
          }

          batchPayloads.push(
            buildStockBatchPayloadFromPurchaseItem(item, totalQuantity, invoice.invoiceDate)
          );
          labels.push(
            `${item.medicineName || medicineId} / ${purchaseItemStockBatchNumber(item)}`
          );
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          stockUpdateErrors.push(
            `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${msg}`
          );
        }
      }

      if (!batchPayloads.length) return;

      try {
        console.log(
          `Updating stock for existing invoice - medicine ${medicineId} with ${batchPayloads.length} batch(es)`
        );
        await addStockBatchesToMedicine(medicineId, batchPayloads as any);
        console.log(`✓ Stock updated successfully for medicine ${medicineId}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        for (const label of labels) {
          stockUpdateErrors.push(`Failed to update stock for ${label}: ${msg}`);
        }
      }
    })
  );

  const totalItems = invoice.items.length;
  const successful = totalItems - stockUpdateErrors.length;
  const failed = stockUpdateErrors.length;

  console.log(`Stock update summary for invoice ${invoiceId}: ${successful} successful, ${failed} failed`);

  if (stockUpdateErrors.length > 0) {
    throw new Error(
      `Failed to update stock for ${stockUpdateErrors.length} item(s): ${stockUpdateErrors.join('; ')}`
    );
  }

  return { successful, failed };
};

export const updateStockForAllExistingInvoices = async () => {
  const invoices = await getAllPurchaseInvoices();
  const results = [];
  
  for (const invoice of invoices) {
    try {
      const result = await updateStockForExistingInvoice(invoice.id);
      results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, ...result });
    } catch (error: any) {
      results.push({ 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber, 
        successful: 0, 
        failed: invoice.items.length,
        error: error.message 
      });
    }
  }
  
  return results;
};


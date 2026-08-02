import { collection, getDocs, doc, setDoc, updateDoc, query, orderBy, Timestamp, serverTimestamp, db, getDoc, where, deleteField } from './firebase';
import { ProductDemand, PurchaseInvoice, PurchaseInvoiceItem, VendorInvoicePayment } from '../types';
import { addStockBatch, reduceStockFromBatchSoft } from './inventory';
import { attachLandedCostToBatchData } from '../utils/purchaseInvoiceLandedCost';
import { attachStandardDiscountToBatchData } from '../utils/orderFulfillmentDiscount';

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
    
    // Group items by medicineId to process sequentially per medicine
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
    
    // Process each medicine sequentially to avoid race conditions
    for (const [medicineId, items] of itemsByMedicine.entries()) {
      // Process batches for this medicine sequentially
      for (const item of items) {
        try {
          if (!item.batchNumber) {
            throw new Error('Batch number is missing');
          }
          const totalQuantity = item.quantity + (item.freeQuantity || 0);
          if (!totalQuantity || totalQuantity <= 0) {
            throw new Error('Invalid quantity');
          }
          
          const batchData: any = {
            batchNumber: item.batchNumber,
            quantity: totalQuantity, // Use quantity + free quantity
            purchasePrice: item.purchasePrice || 0,
          };
          attachLandedCostToBatchData(batchData, item);
          
          // Add optional fields only if they exist
          if (item.mfgDate) {
            batchData.mfgDate = item.mfgDate instanceof Date ? item.mfgDate : new Date(item.mfgDate);
          }
          if (item.expiryDate) {
            batchData.expiryDate = item.expiryDate instanceof Date ? item.expiryDate : new Date(item.expiryDate);
          }
          if (invoiceData.invoiceDate) {
            batchData.purchaseDate = invoiceData.invoiceDate instanceof Date ? invoiceData.invoiceDate : new Date(invoiceData.invoiceDate);
          }
          if (item.mrp !== undefined && item.mrp !== null) {
            // Ensure MRP is a number
            batchData.mrp = typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp);
            if (isNaN(batchData.mrp)) {
              console.warn(`Invalid MRP value for item ${item.medicineName}: ${item.mrp}`);
              delete batchData.mrp;
            }
          }
          if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
            // Ensure discountPercentage is a number
            batchData.discountPercentage = typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage));
            if (isNaN(batchData.discountPercentage)) {
              console.warn(`Invalid discountPercentage value for item ${item.medicineName}: ${item.discountPercentage}`);
              delete batchData.discountPercentage;
            }
          }
          attachStandardDiscountToBatchData(batchData, item);
          if (
            item.schemePaidQty !== undefined &&
            item.schemePaidQty !== null &&
            item.schemeFreeQty !== undefined &&
            item.schemeFreeQty !== null
          ) {
            const sp = typeof item.schemePaidQty === 'number' ? item.schemePaidQty : parseFloat(String(item.schemePaidQty));
            const sf = typeof item.schemeFreeQty === 'number' ? item.schemeFreeQty : parseFloat(String(item.schemeFreeQty));
            if (!isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0) {
              batchData.schemePaidQty = Math.floor(sp);
              batchData.schemeFreeQty = Math.floor(sf);
            }
          }
          if (item.nonReturnable === true) {
            batchData.nonReturnable = true;
          }

          onProgress?.({
            phase: 'updating_stock',
            current: stockDone,
            total: Math.max(1, stockItems.length),
            medicineName: item.medicineName,
            batchNumber: item.batchNumber,
          });

          console.log(`Updating stock for medicine ${medicineId} with batch data:`, batchData);
          await addStockBatch(medicineId, batchData);
          stockDone += 1;
          onProgress?.({
            phase: 'updating_stock',
            current: stockDone,
            total: Math.max(1, stockItems.length),
            medicineName: item.medicineName,
            batchNumber: item.batchNumber,
          });
          console.log(`✓ Stock updated successfully for medicine ${medicineId}, batch ${item.batchNumber}, quantity: ${totalQuantity}`);
        } catch (error: any) {
          const errorMsg = `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${error.message || error}`;
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
    }
    
    console.log(`Stock update summary: ${invoiceData.items.length - stockUpdateErrors.length} successful, ${stockUpdateErrors.length} failed`);
    
    if (stockUpdateErrors.length > 0) {
      console.warn('Some stock updates failed:', stockUpdateErrors);
      // You could optionally throw an error here if you want to prevent invoice creation on stock update failure
      // throw new Error(`Failed to update stock for ${stockUpdateErrors.length} item(s). Please update stock manually.`);
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

      return cleanedItem;
    });
  }

  await updateDoc(invoiceRef, updateData);
};

function purchaseLinePhysicalQty(item: PurchaseInvoiceItem): number {
  return (Number(item.quantity) || 0) + (Number(item.freeQuantity) || 0);
}

function purchaseStockLineKey(item: PurchaseInvoiceItem): string {
  return `${item.medicineId || ''}||${String(item.batchNumber || '').trim().toLowerCase()}`;
}

function buildStockBatchPayloadFromPurchaseItem(
  item: PurchaseInvoiceItem,
  quantity: number,
  invoiceDate?: Date | unknown
): Record<string, unknown> {
  const batchData: Record<string, unknown> = {
    batchNumber: item.batchNumber,
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

    onProgress?.({
      phase: 'updating_stock',
      current: done,
      total,
      medicineName: sample.medicineName,
      batchNumber: sample.batchNumber,
    });

    try {
      if (delta < 0) {
        const { shortfall, available, reduced } = await reduceStockFromBatchSoft(
          sample.medicineId,
          sample.batchNumber,
          -delta
        );
        if (shortfall > 0) {
          errors.push(
            `${sample.medicineName || sample.medicineId} / ${sample.batchNumber}: ` +
              `could only reduce ${reduced} of ${-delta} (available ${available}). Invoice qty still saved.`
          );
        }
      } else if (delta > 0) {
        const batchData = buildStockBatchPayloadFromPurchaseItem(sample, delta, invoiceDate);
        await addStockBatch(sample.medicineId, batchData as any);
      } else if (newAgg) {
        // Same qty — refresh batch metadata from the edited line
        const batchData = buildStockBatchPayloadFromPurchaseItem(sample, 0, invoiceDate);
        await addStockBatch(sample.medicineId, batchData as any);
      }
    } catch (e: any) {
      errors.push(
        `${sample.medicineName || sample.medicineId} / ${sample.batchNumber}: ${e?.message || e}`
      );
    }

    done += 1;
    onProgress?.({
      phase: 'updating_stock',
      current: done,
      total,
      medicineName: sample.medicineName,
      batchNumber: sample.batchNumber,
    });
  }

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
  
  // Group items by medicineId to process sequentially per medicine
  const itemsByMedicine = new Map<string, typeof invoice.items>();
  
  for (const item of invoice.items) {
    if (!item.medicineId) continue;
    
    if (!itemsByMedicine.has(item.medicineId)) {
      itemsByMedicine.set(item.medicineId, []);
    }
    itemsByMedicine.get(item.medicineId)!.push(item);
  }
  
  // Process each medicine sequentially to avoid race conditions
  for (const [medicineId, items] of itemsByMedicine.entries()) {
    // Process batches for this medicine sequentially
    for (const item of items) {
      try {
        if (!item.batchNumber) {
          throw new Error('Batch number is missing');
        }
        const totalQuantity = item.quantity + (item.freeQuantity || 0);
        if (!totalQuantity || totalQuantity <= 0) {
          throw new Error('Invalid quantity');
        }
        
        const batchData: any = {
          batchNumber: item.batchNumber,
          quantity: totalQuantity, // Use quantity + free quantity
          purchasePrice: item.purchasePrice || 0,
        };
        attachLandedCostToBatchData(batchData, item);
        
        // Add optional fields only if they exist
        if (item.mfgDate) {
          batchData.mfgDate = item.mfgDate instanceof Date ? item.mfgDate : new Date(item.mfgDate);
        }
        if (item.expiryDate) {
          batchData.expiryDate = item.expiryDate instanceof Date ? item.expiryDate : new Date(item.expiryDate);
        }
        if (invoice.invoiceDate) {
          batchData.purchaseDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
        }
        if (item.mrp !== undefined && item.mrp !== null) {
          // Ensure MRP is a number
          batchData.mrp = typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp);
          if (isNaN(batchData.mrp)) {
            console.warn(`Invalid MRP value for item ${item.medicineName}: ${item.mrp}`);
            delete batchData.mrp;
          }
        }
        if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
          // Ensure discountPercentage is a number
          batchData.discountPercentage = typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage));
          if (isNaN(batchData.discountPercentage)) {
            console.warn(`Invalid discountPercentage value for item ${item.medicineName}: ${item.discountPercentage}`);
            delete batchData.discountPercentage;
          }
        }
        attachStandardDiscountToBatchData(batchData, item);
        if (
          item.schemePaidQty !== undefined &&
          item.schemePaidQty !== null &&
          item.schemeFreeQty !== undefined &&
          item.schemeFreeQty !== null
        ) {
          const sp = typeof item.schemePaidQty === 'number' ? item.schemePaidQty : parseFloat(String(item.schemePaidQty));
          const sf = typeof item.schemeFreeQty === 'number' ? item.schemeFreeQty : parseFloat(String(item.schemeFreeQty));
          if (!isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0) {
            batchData.schemePaidQty = Math.floor(sp);
            batchData.schemeFreeQty = Math.floor(sf);
          }
        }
        if (item.nonReturnable === true) {
          batchData.nonReturnable = true;
        }

        console.log(`Updating stock for existing invoice - medicine ${medicineId} with batch data:`, batchData);
        await addStockBatch(medicineId, batchData);
        console.log(`✓ Stock updated successfully for medicine ${medicineId}, batch ${item.batchNumber}, quantity: ${totalQuantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${error.message || error}`;
        console.error(errorMsg, error);
        stockUpdateErrors.push(errorMsg);
      }
    }
  }
  
  const totalItems = invoice.items.length;
  const successful = totalItems - stockUpdateErrors.length;
  const failed = stockUpdateErrors.length;
  
  console.log(`Stock update summary for invoice ${invoiceId}: ${successful} successful, ${failed} failed`);
  
  if (stockUpdateErrors.length > 0) {
    throw new Error(`Failed to update stock for ${stockUpdateErrors.length} item(s): ${stockUpdateErrors.join('; ')}`);
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


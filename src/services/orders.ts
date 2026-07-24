import { collection, getDocs, doc, updateDoc, query, orderBy, limit, Timestamp, db, getDoc, where } from './firebase';
import { deleteField } from 'firebase/firestore';
import { Order, OrderStatus, OrderTimelineEvent, Medicine, PurchaseInvoice, Payment } from '../types';
import { reduceStockFromBatch, restoreStockToBatch, restoreStockBatchesToMedicine, getMedicineById } from './inventory';
import { generateOrderInvoiceNumber } from '../utils/invoiceNumber';
import { paidFreeFromAllocation, physicalQtyFromAllocation } from '../utils/schemeFulfillment';
import { nestedFirestoreTimestamp, serverTimestamp } from '../utils/firestoreTimestamps';
import {
  buildPurchaseBatchDiscountLookup,
  resolveOrderLineDisplayDiscountPct,
} from '../utils/orderFulfillmentDiscount';
import { getAllPurchaseInvoices } from './purchaseInvoices';
import { recalculateMedicinesPricingFromInventory } from '../utils/recalculateOrderLinePricing';
import { calculateOrderTotalsFromLines } from '../utils/orderTotals';

const createTimelineEvent = (status: OrderStatus, updatedBy: string, note?: string): OrderTimelineEvent => ({
  status,
  timestamp: nestedFirestoreTimestamp(),
  updatedBy,
  note
});

/** Restore inventory deducted at fulfill time (paid + scheme-free physical qty). */
async function restoreStockForOrderMedicines(medicines: Order['medicines'] | undefined): Promise<string[]> {
  const errors: string[] = [];
  if (!medicines?.length) return errors;

  // Aggregate qty per medicine+batch, then one read/write per medicine in parallel.
  const byMedicine = new Map<
    string,
    { label: string; batches: Map<string, { batchNumber: string; quantity: number }> }
  >();

  const addRestore = (
    medicineId: string,
    label: string,
    batchNumber: string,
    quantity: number
  ) => {
    if (!medicineId || !batchNumber || quantity <= 0) return;
    const batchKey = String(batchNumber).trim().toLowerCase();
    let entry = byMedicine.get(medicineId);
    if (!entry) {
      entry = { label, batches: new Map() };
      byMedicine.set(medicineId, entry);
    }
    const prev = entry.batches.get(batchKey);
    if (prev) {
      prev.quantity += quantity;
    } else {
      entry.batches.set(batchKey, { batchNumber: String(batchNumber).trim(), quantity });
    }
  };

  for (const item of medicines) {
    if (item.lineType === 'product_demand') continue;
    if (!item.medicineId) continue;
    const label = String(item.name || item.medicineId);

    if (item.batchAllocations && Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
      for (const allocation of item.batchAllocations) {
        const qty = physicalQtyFromAllocation(allocation);
        if (!allocation.batchNumber || qty <= 0) continue;
        addRestore(item.medicineId, label, allocation.batchNumber, qty);
      }
    } else if (item.batchNumber) {
      const qty = toNum(item.quantity) + toNum(item.freeQuantity);
      const restoreQty = qty > 0 ? qty : toNum(item.quantity);
      if (restoreQty <= 0) continue;
      addRestore(item.medicineId, label, item.batchNumber, restoreQty);
    }
  }

  await Promise.all(
    [...byMedicine.entries()].map(async ([medicineId, { label, batches }]) => {
      try {
        await restoreStockBatchesToMedicine(medicineId, [...batches.values()]);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to restore stock for ${label}: ${msg}`);
      }
    })
  );

  return errors;
}

function toNum(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

import type { LedgerOrder } from '../utils/storeLedger';

function mapOrderDoc(docSnap: { id: string; data: () => Record<string, unknown> }): Order {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    orderDate: (data.orderDate as { toDate?: () => Date })?.toDate?.() || new Date(),
    timeline:
      (data.timeline as Array<Record<string, unknown>> | undefined)?.map((t) => ({
        ...t,
        timestamp: (t.timestamp as { toDate?: () => Date })?.toDate?.() || new Date(),
      })) || [],
  } as Order;
}

/** Payments recorded under orders/{orderId}/payments (mobile / SO collection flow). */
export const getOrderPayments = async (orderId: string): Promise<Payment[]> => {
  const snapshot = await getDocs(collection(db, 'orders', orderId, 'payments'));
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      orderId,
      ...data,
      paymentDate: data.paymentDate?.toDate?.() || new Date(),
    } as Payment;
  });
};

async function enrichOrdersWithPayments(orders: Order[]): Promise<LedgerOrder[]> {
  return Promise.all(
    orders.map(async (order) => {
      const subPayments = await getOrderPayments(order.id);
      const docPayments =
        Array.isArray(order.payments) && order.payments.length > 0 ? order.payments : [];
      const ledgerPayments = subPayments.length > 0 ? subPayments : docPayments;
      return { ...order, ledgerPayments };
    })
  );
}

/** All orders for a retailer, with payment lines attached for ledger generation. */
export const getOrdersByRetailer = async (retailerId: string): Promise<LedgerOrder[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    const snapshot = await getDocs(
      query(ordersCol, where('retailerId', '==', retailerId), orderBy('orderDate', 'asc'))
    );
    const orders = snapshot.docs.map((docSnap) => mapOrderDoc(docSnap));
    return enrichOrdersWithPayments(orders);
  } catch (error) {
    console.warn('getOrdersByRetailer query failed, falling back to full scan:', error);
    const snapshot = await getDocs(ordersCol);
    const orders = snapshot.docs
      .map((docSnap) => mapOrderDoc(docSnap))
      .filter((o) => o.retailerId === retailerId)
      .sort((a, b) => {
        const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
        const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
        return dateA.getTime() - dateB.getTime();
      });
    return enrichOrdersWithPayments(orders);
  }
};

/**
 * Retailer orders for scheme history (no payment subcollection reads).
 * Prefer recent first; caller builds last-scheme map.
 */
export const getRetailerOrdersForSchemeHistory = async (
  retailerId: string
): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    const snapshot = await getDocs(
      query(ordersCol, where('retailerId', '==', retailerId), orderBy('orderDate', 'desc'))
    );
    return snapshot.docs.map((docSnap) => mapOrderDoc(docSnap));
  } catch (error) {
    console.warn('getRetailerOrdersForSchemeHistory query failed, falling back:', error);
    const snapshot = await getDocs(ordersCol);
    return snapshot.docs
      .map((docSnap) => mapOrderDoc(docSnap))
      .filter((o) => o.retailerId === retailerId)
      .sort((a, b) => {
        const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
        const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
        return dateB.getTime() - dateA.getTime();
      });
  }
};

export const getOrderById = async (orderId: string): Promise<Order | null> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) return null;
  
  const data = orderDoc.data();
  return {
    id: orderDoc.id,
    ...data,
    orderDate: data.orderDate?.toDate() || new Date(),
    timeline: data.timeline?.map((t: any) => ({
      ...t,
      timestamp: t.timestamp?.toDate() || new Date()
    })) || []
  } as Order;
};

/** Lightweight payment-status lookup for a set of order ids (e.g. payment request rows). */
export const getOrderPaymentStatuses = async (
  orderIds: string[]
): Promise<Map<string, string>> => {
  const unique = [...new Set(orderIds.filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (id) => {
      const snap = await getDoc(doc(db, 'orders', id));
      if (snap.exists()) {
        const ps = snap.data().paymentStatus;
        map.set(id, ps ? String(ps) : 'Unpaid');
      }
    })
  );
  return map;
};

export const getAllOrders = async (): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  try {
    const q = query(ordersCol, orderBy('orderDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
  } catch (error) {
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(ordersCol);
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        orderDate: data.orderDate?.toDate() || new Date(),
        timeline: data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date()
        })) || []
      } as Order;
    });
    
    return orders.sort((a, b) => {
      const dateA = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
      const dateB = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

/**
 * Fetch full order documents for a single status. Used by on-demand actions
 * (e.g. exports) so we can avoid loading the entire `orders` collection just to
 * filter it in memory. The `status` field is single-field indexed by default.
 */
export const getOrdersByStatus = async (status: OrderStatus): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  const mapDoc = (docSnap: any): Order => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      orderDate: data.orderDate?.toDate() || new Date(),
      timeline:
        data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date(),
        })) || [],
    } as Order;
  };
  try {
    const snapshot = await getDocs(query(ordersCol, where('status', '==', status)));
    return snapshot.docs.map(mapDoc);
  } catch (error) {
    console.warn('getOrdersByStatus query failed, falling back to full scan:', error);
    const snapshot = await getDocs(ordersCol);
    return snapshot.docs.map(mapDoc).filter((o) => o.status === status);
  }
};

/**
 * Fetch orders for the given statuses (default: those that still hold stock
 * reservations before dispatch). Used to compute batch reservations without
 * loading the entire `orders` collection.
 */
export const getOrdersByStatuses = async (statuses: OrderStatus[]): Promise<Order[]> => {
  const results = await Promise.all(statuses.map((s) => getOrdersByStatus(s)));
  return results.flat();
};

/**
 * Orders with money still owed (Unpaid / Partial, or paymentStatus unset).
 * Order Details treats a missing paymentStatus as Unpaid, so receivables must
 * include those docs too — Firestore `in` queries skip missing fields.
 * Cancelled / Pending are excluded client-side.
 */
export const getReceivableOrders = async (): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  const mapDoc = (docSnap: any): Order => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      orderDate: data.orderDate?.toDate() || new Date(),
      timeline:
        data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date(),
        })) || [],
    } as Order;
  };
  const isCandidate = (o: Order) => {
    if (o.status === 'Cancelled' || o.status === 'Pending') return false;
    const ps = o.paymentStatus;
    return ps === 'Unpaid' || ps === 'Partial' || !ps;
  };
  try {
    // Explicit Unpaid / Partial
    const unpaidPartialSnap = await getDocs(
      query(ordersCol, where('paymentStatus', 'in', ['Unpaid', 'Partial']))
    );
    // Orders with no paymentStatus still show as Unpaid in the UI; Firestore
    // cannot query "field missing", so load billable statuses and keep those.
    const billableSnap = await getDocs(
      query(ordersCol, where('status', 'in', ['Order Fulfillment', 'In Transit', 'Delivered']))
    );
    const byId = new Map<string, Order>();
    for (const docSnap of [...unpaidPartialSnap.docs, ...billableSnap.docs]) {
      const o = mapDoc(docSnap);
      if (isCandidate(o)) byId.set(o.id, o);
    }
    return [...byId.values()];
  } catch (error) {
    console.warn('getReceivableOrders query failed, falling back to full scan:', error);
    const snapshot = await getDocs(ordersCol);
    return snapshot.docs.map(mapDoc).filter(isCandidate);
  }
};

/**
 * Orders whose orderDate falls in [startMs, endMs). Used by the Margin report so
 * a "this month" / "last month" view doesn't scan the entire orders history.
 */
export const getOrdersInRange = async (startMs: number, endMs?: number): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  const mapDoc = (docSnap: any): Order => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      orderDate: data.orderDate?.toDate() || new Date(),
      timeline:
        data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date(),
        })) || [],
    } as Order;
  };
  const constraints = [where('orderDate', '>=', Timestamp.fromMillis(startMs))];
  if (endMs != null) constraints.push(where('orderDate', '<', Timestamp.fromMillis(endMs)));
  try {
    const snapshot = await getDocs(query(ordersCol, ...constraints, orderBy('orderDate', 'desc')));
    return snapshot.docs.map(mapDoc);
  } catch (error) {
    console.warn('getOrdersInRange query failed, falling back to full scan:', error);
    const snapshot = await getDocs(ordersCol);
    return snapshot.docs
      .map(mapDoc)
      .filter((o) => {
        const t = (o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate)).getTime();
        return t >= startMs && (endMs == null || t < endMs);
      });
  }
};

/**
 * The N most recent orders (by orderDate). Used by the Dashboard's "Recent
 * orders" panel so it doesn't download the whole collection just to show a few.
 */
export const getRecentOrders = async (max = 6): Promise<Order[]> => {
  const ordersCol = collection(db, 'orders');
  const mapDoc = (docSnap: any): Order => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      orderDate: data.orderDate?.toDate() || new Date(),
      timeline:
        data.timeline?.map((t: any) => ({
          ...t,
          timestamp: t.timestamp?.toDate() || new Date(),
        })) || [],
    } as Order;
  };
  try {
    const snapshot = await getDocs(query(ordersCol, orderBy('orderDate', 'desc'), limit(max)));
    return snapshot.docs.map(mapDoc);
  } catch (error) {
    console.warn('getRecentOrders query failed, falling back to full scan:', error);
    const snapshot = await getDocs(ordersCol);
    return snapshot.docs
      .map(mapDoc)
      .sort((a, b) => {
        const da = a.orderDate instanceof Date ? a.orderDate : new Date(a.orderDate);
        const db2 = b.orderDate instanceof Date ? b.orderDate : new Date(b.orderDate);
        return db2.getTime() - da.getTime();
      })
      .slice(0, max);
  }
};

export const updateOrderMedicines = async (
  orderId: string,
  medicines: Order['medicines']
): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, { medicines });
};

export const saveOrderFulfillmentDraft = async (
  orderId: string,
  draft: { medicines: any[]; taxPercentage?: number }
): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    fulfillmentDraft: {
      medicines: draft.medicines,
      taxPercentage: draft.taxPercentage ?? 5,
      updatedAt: serverTimestamp(),
    },
  });
};

export const clearOrderFulfillmentDraft = async (orderId: string): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, { fulfillmentDraft: deleteField() });
};

export const updateOrderTotalAmount = async (
  orderId: string,
  totalAmount: number,
  paidAmount = 0,
  extras?: {
    taxAmount?: number;
    subTotal?: number;
    totalDiscount?: number;
  }
): Promise<void> => {
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    totalAmount,
    dueAmount: Math.max(0, totalAmount - paidAmount),
    ...(extras?.taxAmount !== undefined ? { taxAmount: extras.taxAmount } : {}),
    ...(extras?.subTotal !== undefined ? { subTotal: extras.subTotal } : {}),
    ...(extras?.totalDiscount !== undefined ? { totalDiscount: extras.totalDiscount } : {}),
  });
};

export const updateOrderStatus = async (
  orderId: string, 
  status: OrderStatus, 
  updatedBy: string, 
  note?: string
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, { 
    status,
    timeline: [...currentTimeline, createTimelineEvent(status, updatedBy, note)]
  });
};

export const cancelOrder = async (
  orderId: string,
  cancelledBy: string,
  reason: string
): Promise<{ stockRestoreErrors: string[] }> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }
  
  const orderData = orderDoc.data();
  const currentTimeline = orderData?.timeline || [];
  const currentStatus = orderData?.status;

  let stockRestoreErrors: string[] = [];
  // Pending never deducted inventory; mark restored so repair UI does not double-add.
  let stockRestoredOnCancel = currentStatus === 'Pending';
  
  // If order has been fulfilled (stock deducted), restore inventory batches
  if (currentStatus && currentStatus !== 'Pending' && currentStatus !== 'Cancelled' && orderData.medicines) {
    console.log(`Order ${orderId} has status ${currentStatus}, restoring stock from batches...`);
    stockRestoreErrors = await restoreStockForOrderMedicines(orderData.medicines);
    stockRestoredOnCancel = stockRestoreErrors.length === 0;
    if (stockRestoreErrors.length > 0) {
      console.warn('Some stock restorations failed during cancel:', stockRestoreErrors);
    } else {
      console.log(`✓ All stock restored for order ${orderId}`);
    }
  }
  
  await updateDoc(orderRef, {
    status: 'Cancelled',
    cancelReason: reason,
    cancelledAt: serverTimestamp(),
    stockRestoredOnCancel,
    timeline: [...currentTimeline, createTimelineEvent('Cancelled', cancelledBy, reason)]
  });

  return { stockRestoreErrors };
};

/**
 * Repair path: restore inventory for a cancelled order that never got stock back
 * (e.g. cancelled from retailer app while in Order Fulfillment).
 */
export const restoreStockForCancelledOrder = async (
  orderId: string
): Promise<{ stockRestoreErrors: string[] }> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);

  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }

  const data = orderDoc.data();
  if (data?.status !== 'Cancelled') {
    throw new Error('Order is not cancelled');
  }
  if (data?.stockRestoredOnCancel === true) {
    throw new Error('Stock was already restored for this cancelled order');
  }

  const medicines = data?.medicines as Order['medicines'] | undefined;
  const stockRestoreErrors = await restoreStockForOrderMedicines(medicines);
  if (stockRestoreErrors.length === 0) {
    await updateDoc(orderRef, { stockRestoredOnCancel: true });
  }
  return { stockRestoreErrors };
};

export const fulfillOrder = async (
  orderId: string, 
  fulfilledBy: string, 
  fulfillmentData: {
    medicines: any[];
    taxAmount: number;
    taxPercentage: number;
    subTotal: number;
    totalDiscount?: number;
    totalAmount: number;
    trayNumber?: string;
    processedBy?: string;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  // Generate invoice number if not already set
  const order = orderDoc.data() as Order;
  let invoiceNumber = order.invoiceNumber;
  if (!invoiceNumber) {
    try {
      invoiceNumber = await generateOrderInvoiceNumber();
      console.log(`Generated invoice number for order ${orderId}: ${invoiceNumber}`);
    } catch (error) {
      console.error('Failed to generate invoice number:', error);
      // Continue without invoice number if generation fails
    }
  }
  
  // Reduce stock from batches for items that have batch numbers assigned
  const stockUpdateErrors: string[] = [];
  
  for (const item of fulfillmentData.medicines) {
    const isUnresolvedDemand =
      item.lineType === 'product_demand' &&
      item.productDemandId &&
      (!item.medicineId || String(item.medicineId).trim() === '');
    if (isUnresolvedDemand) continue;

    const workItem =
      item.lineType === 'product_demand' && item.medicineId
        ? { ...item, lineType: 'medicine' as const }
        : item;
    if (!workItem.medicineId || !workItem.quantity) continue;

    // Handle new multi-batch allocation structure
    if (workItem.batchAllocations && workItem.batchAllocations.length > 0) {
      // Process each batch allocation
      for (const allocation of workItem.batchAllocations) {
        if (allocation.batchNumber && physicalQtyFromAllocation(allocation) > 0) {
          try {
            const deductQty = physicalQtyFromAllocation(allocation);
            await reduceStockFromBatch(
              workItem.medicineId,
              allocation.batchNumber,
              deductQty
            );
            console.log(`✓ Stock reduced for medicine ${workItem.medicineId}, batch ${allocation.batchNumber}, quantity: ${deductQty}`);
          } catch (error: any) {
            const errorMsg = `Failed to reduce stock for ${workItem.name || workItem.medicineId} (batch ${allocation.batchNumber}): ${error.message || error}`;
            console.error(errorMsg, error);
            stockUpdateErrors.push(errorMsg);
            // Continue with other items even if one fails
          }
        }
      }
    } 
    // Backward compatibility: Handle single batchNumber
    else if (workItem.batchNumber) {
      try {
        await reduceStockFromBatch(
          workItem.medicineId,
          workItem.batchNumber,
          workItem.quantity
        );
        console.log(`✓ Stock reduced for medicine ${workItem.medicineId}, batch ${workItem.batchNumber}, quantity: ${workItem.quantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to reduce stock for ${workItem.name || workItem.medicineId} (batch ${workItem.batchNumber}): ${error.message || error}`;
        console.error(errorMsg, error);
        stockUpdateErrors.push(errorMsg);
        // Continue with other items even if one fails
      }
    }
  }
  
  if (stockUpdateErrors.length > 0) {
    console.warn('Some stock updates failed:', stockUpdateErrors);
    // Still update the order, but log the errors
  }
  
  // Expand medicines with multiple batchAllocations into separate line items
  // This ensures each batch gets its own line item in the invoice
  const expandedMedicines: any[] = [];

  // Dedupe medicine reads within this fulfill call: the same medicine can appear
  // across many lines/allocations, so cache each doc read for the duration of the
  // call instead of re-reading it once per line (N+1 -> 1 per unique medicine).
  const medicineFetchCache = new Map<string, Medicine | null>();
  const getMedicineCached = async (medicineId: string): Promise<Medicine | null> => {
    if (medicineFetchCache.has(medicineId)) {
      return medicineFetchCache.get(medicineId) ?? null;
    }
    const fetched = await getMedicineById(medicineId);
    medicineFetchCache.set(medicineId, fetched);
    return fetched;
  };

  let purchaseDiscountLookup = buildPurchaseBatchDiscountLookup([]);
  try {
    purchaseDiscountLookup = buildPurchaseBatchDiscountLookup(await getAllPurchaseInvoices());
  } catch (error) {
    console.warn('Failed to load purchase invoices for fulfill discount resolution:', error);
  }

  const toNum = (value: unknown): number => {
    if (value === undefined || value === null || value === '') return 0;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  };

  const resolveLineDiscount = (
    line: any,
    allocation:
      | { batchNumber?: string; discountPercentage?: unknown; mrp?: number; gstRate?: number }
      | undefined,
    batch?: { mrp?: number; purchasePrice?: number; discountPercentage?: number; standardDiscount?: number }
  ): number => {
    const batchNumber = allocation?.batchNumber ?? line.batchNumber;
    const gstRate = toNum(allocation?.gstRate) || toNum(line.gstRate) || 5;
    return resolveOrderLineDisplayDiscountPct({
      itemDiscount: line.discountPercentage,
      allocationDiscount: allocation?.discountPercentage,
      medicineId: line.medicineId,
      batchNumber,
      purchaseLookup: purchaseDiscountLookup,
      batch: {
        batchNumber,
        mrp: toNum(allocation?.mrp) || toNum(batch?.mrp) || toNum(line.mrp),
        purchasePrice: batch?.purchasePrice,
        discountPercentage: batch?.discountPercentage,
        standardDiscount: batch?.standardDiscount,
      },
      gstRate,
      discountManuallySet: line.discountManuallySet === true,
    });
  };
  
  for (const item of fulfillmentData.medicines) {
    const isUnresolvedDemand =
      item.lineType === 'product_demand' &&
      item.productDemandId &&
      (!item.medicineId || String(item.medicineId).trim() === '');
    if (isUnresolvedDemand) {
      expandedMedicines.push({
        medicineId: item.medicineId || '',
        name: item.name,
        price: 0,
        quantity: item.quantity || 0,
        lineType: 'product_demand',
        manufacturerName: item.manufacturerName,
        requestedUnit: item.requestedUnit,
        notes: item.notes,
        productDemandId: item.productDemandId,
        freeQuantity: 0,
      });
      continue;
    }

    const workItem =
      item.lineType === 'product_demand' && item.medicineId
        ? { ...item, lineType: 'medicine' as const }
        : item;
    const line = workItem;
    // If line has multiple batch allocations, create separate line item for each batch
    if (line.batchAllocations && line.batchAllocations.length > 1) {
      // Fetch medicine data to get batch discountPercentage if needed
      let medicineData = null;
      if (line.medicineId) {
        try {
          medicineData = await getMedicineCached(line.medicineId);
        } catch (error) {
          console.warn(`Failed to fetch medicine ${line.medicineId} for discountPercentage:`, error);
        }
      }
      
      for (const allocation of line.batchAllocations) {
        const batch = medicineData?.stockBatches?.find(
          (b) => b.batchNumber === allocation.batchNumber
        );
        const finalDiscountPct = resolveLineDiscount(line, allocation, batch);

        const purchasePrice = allocation.purchasePrice || 0;

        // Create a clean medicine item for this batch (no undefined values)
        const { paid: allocPaid, free: allocFree } = paidFreeFromAllocation(allocation);
        const batchItem: any = {
          medicineId: line.medicineId,
          name: line.name,
          price: purchasePrice > 0 ? purchasePrice : line.price || 0,
          quantity: allocPaid,
          freeQuantity: allocFree,
          batchNumber: allocation.batchNumber,
          gstRate: allocation.gstRate || line.gstRate || 5,
          batchAllocations: [
            {
              batchNumber: allocation.batchNumber,
              quantity: allocPaid,
              allocationFreeQty: allocFree,
              ...(allocation.expiryDate ? { expiryDate: allocation.expiryDate } : {}),
              ...(allocation.mrp !== undefined && allocation.mrp !== null
                ? { mrp: allocation.mrp }
                : {}),
              ...(allocation.purchasePrice !== undefined && allocation.purchasePrice !== null
                ? { purchasePrice: allocation.purchasePrice }
                : {}),
              ...(allocation.gstRate !== undefined && allocation.gstRate !== null
                ? { gstRate: allocation.gstRate }
                : {}),
              ...(allocation.schemePaidQty ? { schemePaidQty: allocation.schemePaidQty } : {}),
              ...(allocation.schemeFreeQty ? { schemeFreeQty: allocation.schemeFreeQty } : {}),
              discountPercentage: finalDiscountPct,
            },
          ],
        };
        
        // ALWAYS include discountPercentage if it exists (even if 0, but preserve actual value)
        if (finalDiscountPct !== undefined && !isNaN(finalDiscountPct)) {
          batchItem.discountPercentage = finalDiscountPct;
          console.log(`[fulfillOrder] Setting discountPercentage: ${finalDiscountPct}% for batch ${allocation.batchNumber} in expanded medicine`);
        }
        
        // Add optional fields only if they exist and are not undefined
        if (allocation.expiryDate) {
          batchItem.expiryDate = allocation.expiryDate;
        } else if (line.batchExpiryDate) {
          batchItem.expiryDate = line.batchExpiryDate;
        } else if (line.expiryDate) {
          batchItem.expiryDate = line.expiryDate;
        }
        
        if (allocation.mrp !== undefined && allocation.mrp !== null) {
          batchItem.mrp = allocation.mrp;
        }
        const invBatchForNr = medicineData?.stockBatches?.find(
          (b) => b.batchNumber === allocation.batchNumber
        );
        if (allocation.nonReturnable === true || invBatchForNr?.nonReturnable === true) {
          batchItem.nonReturnable = true;
        }
        if (line.productDemandId) {
          batchItem.productDemandId = line.productDemandId;
          batchItem.lineType = 'medicine';
        }
        if ((line as { discountManuallySet?: boolean }).discountManuallySet === true) {
          batchItem.discountManuallySet = true;
        }
        if (line.notes?.trim()) {
          batchItem.notes = line.notes.trim();
        }

        // Final cleanup: Remove any undefined or null values
        Object.keys(batchItem).forEach(key => {
          if (batchItem[key] === undefined || batchItem[key] === null) {
            // Keep 0 values and empty strings, only remove undefined/null
            if (batchItem[key] !== 0 && batchItem[key] !== '') {
              delete batchItem[key];
            }
          }
        });
        
        expandedMedicines.push(batchItem);
      }
    } 
    // Single batch or no batch allocations - use as is but clean undefined values
    else {
      const cleanItem: any = {
        medicineId: line.medicineId,
        name: line.name,
        price: line.price || 0,
        quantity: line.quantity || 0,
        freeQuantity: line.freeQuantity || 0,
      };
      
      // Add expiryDate only if it exists
      if (line.batchExpiryDate) {
        cleanItem.expiryDate = line.batchExpiryDate;
      } else if (line.expiryDate) {
        cleanItem.expiryDate = line.expiryDate;
      }
      
      // Add optional fields only if they exist and are not undefined
      if (line.batchNumber) cleanItem.batchNumber = line.batchNumber;
      if (line.batchAllocations && line.batchAllocations.length === 1) {
        const allocation = line.batchAllocations[0];
        let invBatch:
          | { purchasePrice?: number; discountPercentage?: number; nonReturnable?: boolean }
          | undefined;
        if (line.medicineId) {
          try {
            const medicineData = await getMedicineCached(line.medicineId);
            invBatch = medicineData?.stockBatches?.find(
              (b) => b.batchNumber === allocation.batchNumber
            );
            if (invBatch?.nonReturnable === true) {
              cleanItem.nonReturnable = true;
            }
          } catch (error) {
            console.warn(`Failed to fetch medicine ${line.medicineId} for discountPercentage:`, error);
          }
        }

        const finalDiscountPct = resolveLineDiscount(line, allocation, invBatch);

        const purchasePrice = allocation.purchasePrice || line.price || 0;

        cleanItem.price = purchasePrice > 0 ? purchasePrice : cleanItem.price;
        cleanItem.batchNumber = allocation.batchNumber;
        if (allocation.expiryDate) {
          cleanItem.expiryDate = allocation.expiryDate;
        } else if (line.expiryDate) {
          cleanItem.expiryDate = line.expiryDate;
        }
        if (allocation.mrp !== undefined && allocation.mrp !== null) cleanItem.mrp = allocation.mrp;
        if (allocation.gstRate !== undefined && allocation.gstRate !== null) cleanItem.gstRate = allocation.gstRate;
        const { paid: ap, free: af } = paidFreeFromAllocation(allocation);
        if (allocation.schemePaidQty && allocation.schemeFreeQty) {
          cleanItem.quantity = ap;
          cleanItem.freeQuantity = af;
        }
        cleanItem.batchAllocations = [
          {
            batchNumber: allocation.batchNumber,
            quantity: ap,
            allocationFreeQty: af,
            ...(allocation.expiryDate ? { expiryDate: allocation.expiryDate } : {}),
            ...(allocation.mrp !== undefined && allocation.mrp !== null ? { mrp: allocation.mrp } : {}),
            ...(allocation.purchasePrice !== undefined && allocation.purchasePrice !== null
              ? { purchasePrice: allocation.purchasePrice }
              : {}),
            ...(allocation.gstRate !== undefined && allocation.gstRate !== null
              ? { gstRate: allocation.gstRate }
              : {}),
            ...(allocation.schemePaidQty ? { schemePaidQty: allocation.schemePaidQty } : {}),
            ...(allocation.schemeFreeQty ? { schemeFreeQty: allocation.schemeFreeQty } : {}),
            discountPercentage: finalDiscountPct,
          },
        ];
        if (allocation.nonReturnable === true) {
          cleanItem.nonReturnable = true;
        }
        // ALWAYS include discountPercentage (even if 0) - it's important to preserve this value
        cleanItem.discountPercentage = finalDiscountPct;
        if ((line as { discountManuallySet?: boolean }).discountManuallySet === true) {
          cleanItem.discountManuallySet = true;
        }
      } else {
        if (line.mrp !== undefined && line.mrp !== null) cleanItem.mrp = line.mrp;
        if (line.gstRate !== undefined && line.gstRate !== null) cleanItem.gstRate = line.gstRate;
        if (line.batchNumber && line.medicineId) {
          try {
            const medicineData = await getMedicineCached(line.medicineId);
            const invBatch = medicineData?.stockBatches?.find(
              (b) => b.batchNumber === line.batchNumber
            );
            if (invBatch?.nonReturnable === true) {
              cleanItem.nonReturnable = true;
            }
            cleanItem.discountPercentage = resolveLineDiscount(line, undefined, invBatch);
          } catch (error) {
            console.warn(
              `Failed to fetch medicine ${line.medicineId} for batch metadata:`,
              error
            );
          }
        } else if (line.discountManuallySet === true && line.discountPercentage !== undefined) {
          const discountPct =
            typeof line.discountPercentage === 'number'
              ? line.discountPercentage
              : parseFloat(String(line.discountPercentage));
          if (!isNaN(discountPct)) {
            cleanItem.discountPercentage = discountPct;
          }
        }
      }

      if (line.productDemandId) {
        cleanItem.productDemandId = line.productDemandId;
        cleanItem.lineType = 'medicine';
      }
      if (line.notes?.trim()) {
        cleanItem.notes = line.notes.trim();
      }
      
      // Final cleanup: Remove any undefined or null values that might have been missed
      Object.keys(cleanItem).forEach(key => {
        if (cleanItem[key] === undefined || cleanItem[key] === null) {
          // Keep 0 values and empty strings, only remove undefined/null
          if (cleanItem[key] !== 0 && cleanItem[key] !== '') {
            delete cleanItem[key];
          }
        }
      });
      
      expandedMedicines.push(cleanItem);
    }
  }
  
  // Clean fulfillmentData to remove undefined values
  const cleanFulfillmentData: any = {
    taxAmount: fulfillmentData.taxAmount || 0,
    taxPercentage: fulfillmentData.taxPercentage || 5,
    subTotal: fulfillmentData.subTotal || 0,
    totalDiscount: fulfillmentData.totalDiscount || 0,
    totalAmount: fulfillmentData.totalAmount || 0,
  };
  
  // Convert Date objects to Timestamps and ensure all fields are properly set
  const processedMedicines = expandedMedicines.map(m => {
    const processed: any = { ...m };
    
    // Convert expiryDate to Timestamp if it's a Date object
    if (processed.expiryDate instanceof Date) {
      processed.expiryDate = Timestamp.fromDate(processed.expiryDate);
    } else if (processed.expiryDate && typeof processed.expiryDate.toDate === 'function') {
      // Already a Timestamp, keep as is
      processed.expiryDate = processed.expiryDate;
    }
    
    // Ensure discountPercentage is preserved (even if 0, but not undefined/null)
    if (processed.discountPercentage === undefined || processed.discountPercentage === null) {
      // Don't include undefined/null discountPercentage
      delete processed.discountPercentage;
    }
    
    // Remove any undefined or null values
    Object.keys(processed).forEach(key => {
      if (processed[key] === undefined || processed[key] === null) {
        // Keep 0 values and empty strings, only remove undefined/null
        if (processed[key] !== 0 && processed[key] !== '') {
          delete processed[key];
        }
      }
    });
    
    return processed;
  });
  
  const updateData: any = {
    ...cleanFulfillmentData,
    medicines: processedMedicines, // Use processed medicines array with proper Timestamps
    status: 'Order Fulfillment',
    fulfillmentDraft: deleteField(),
    timeline: [...currentTimeline, createTimelineEvent('Order Fulfillment', fulfilledBy, 'Order items verified and tax added')]
  };

  // Default payment fields so Store Receivables can query Unpaid bills
  const existingPaymentStatus = orderDoc.data()?.paymentStatus;
  if (!existingPaymentStatus || existingPaymentStatus === 'Unpaid') {
    updateData.paymentStatus = 'Unpaid';
    updateData.paidAmount = 0;
    updateData.dueAmount = cleanFulfillmentData.totalAmount || 0;
  } else if (existingPaymentStatus === 'Partial') {
    const paid = Number(orderDoc.data()?.paidAmount) || 0;
    updateData.dueAmount = Math.max(0, (cleanFulfillmentData.totalAmount || 0) - paid);
  }
  
  // Add invoice number if generated
  if (invoiceNumber) {
    updateData.invoiceNumber = invoiceNumber;
  }
  
  // Add tray number and processed by if provided
  if (fulfillmentData.trayNumber) {
    updateData.trayNumber = fulfillmentData.trayNumber;
  }
  if (fulfillmentData.processedBy) {
    updateData.processedBy = fulfillmentData.processedBy;
  }
  
  await updateDoc(orderRef, updateData);
};

/**
 * Revert Order Fulfillment → Pending: restores batch stock and keeps line/batch assignments.
 * Only allowed before dispatch (not In Transit / Delivered).
 */
export const unfulfillOrder = async (
  orderId: string,
  unfulfilledBy: string,
  note?: string
): Promise<{ stockRestoreErrors: string[] }> => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);

  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }

  const data = orderDoc.data();
  const status = data?.status as OrderStatus | undefined;

  if (status !== 'Order Fulfillment') {
    throw new Error(
      'Only orders in Order Fulfillment can be un-fulfilled. Dispatched or delivered orders cannot be reversed here.'
    );
  }

  const stockRestoreErrors = await restoreStockForOrderMedicines(data.medicines as Order['medicines']);
  const currentTimeline = data.timeline || [];

  await updateDoc(orderRef, {
    status: 'Pending',
    timeline: [
      ...currentTimeline,
      createTimelineEvent(
        'Pending',
        unfulfilledBy,
        note || 'Order un-fulfilled; stock restored and order returned to Pending for edits'
      ),
    ],
  });

  return { stockRestoreErrors };
};

/** Recompute line prices/discounts from current inventory and persist order totals. */
export const recalculateOrderPricing = async (
  orderId: string,
  medicinesCatalog: Medicine[],
  purchaseInvoices: PurchaseInvoice[]
): Promise<{ medicines: Order['medicines']; totals: ReturnType<typeof calculateOrderTotalsFromLines> }> => {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  if (
    order.status === 'Cancelled' ||
    order.status === 'In Transit' ||
    order.status === 'Delivered'
  ) {
    throw new Error('Cannot recalculate pricing for cancelled, in-transit, or delivered orders');
  }

  const purchaseLookup = buildPurchaseBatchDiscountLookup(purchaseInvoices);
  const recalculated = recalculateMedicinesPricingFromInventory(
    order.medicines || [],
    medicinesCatalog,
    purchaseLookup
  );

  const taxPct = order.taxPercentage || 5;
  const totals = calculateOrderTotalsFromLines(
    recalculated,
    medicinesCatalog,
    taxPct,
    purchaseLookup
  );

  const paidAmount = toNum(order.paidAmount);
  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    medicines: recalculated,
    subTotal: totals.subTotal,
    totalDiscount: totals.totalDiscount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.grandTotal,
    dueAmount: Math.max(0, totals.grandTotal - paidAmount),
  });

  return { medicines: recalculated, totals };
};

export const updateOrderDispatch = async (
  orderId: string, 
  dispatchData: {
    status: 'In Transit';
    dispatchDate: Date;
    dispatchNotes?: string;
    trackingNumber?: string;
    courierName?: string;
    dispatchedBy: string;
    estimatedDeliveryDate?: Date;
  }
) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  const updatePayload: any = {
    status: dispatchData.status,
    dispatchDate: Timestamp.fromDate(dispatchData.dispatchDate),
    dispatchedBy: dispatchData.dispatchedBy,
    timeline: [...currentTimeline, createTimelineEvent('In Transit', dispatchData.dispatchedBy, dispatchData.dispatchNotes)]
  };
  
  if (dispatchData.trackingNumber) updatePayload.trackingNumber = dispatchData.trackingNumber;
  if (dispatchData.courierName) updatePayload.courierName = dispatchData.courierName;
  if (dispatchData.dispatchNotes) updatePayload.dispatchNotes = dispatchData.dispatchNotes;
  if (dispatchData.estimatedDeliveryDate) {
    updatePayload.estimatedDeliveryDate = Timestamp.fromDate(dispatchData.estimatedDeliveryDate);
  }
  
  await updateDoc(orderRef, updatePayload);
};

export const markOrderDelivered = async (orderId: string, deliveredBy: string) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    throw new Error('Order not found');
  }
  
  const currentTimeline = orderDoc.data()?.timeline || [];
  
  await updateDoc(orderRef, {
    status: 'Delivered',
    deliveryConfirmation: {
      deliveredAt: serverTimestamp(),
      deliveredBy
    },
    timeline: [...currentTimeline, createTimelineEvent('Delivered', deliveredBy, 'Order delivered successfully')]
  });
};

export const updatePaymentStatus = async (
  orderId: string,
  paymentStatus: 'Paid' | 'Unpaid' | 'Partial',
  paidAmount?: number,
  totalAmount?: number,
  paymentMethod?: 'Cash' | 'Online',
  transactionId?: string
) => {
  const orderRef = doc(db, 'orders', orderId);
  const updateData: any = {
    paymentStatus,
  };

  if (paidAmount !== undefined) {
    updateData.paidAmount = paidAmount;
  }

  if (totalAmount !== undefined) {
    updateData.totalAmount = totalAmount;
    updateData.dueAmount = totalAmount - (paidAmount || 0);
  }

  if (paymentMethod) {
    updateData.paymentMethod = paymentMethod;
  }

  if (transactionId !== undefined) {
    updateData.transactionId = transactionId || null;
  }
  if (paymentStatus === 'Unpaid') {
    updateData.transactionId = deleteField();
    updateData.paymentMethod = deleteField();
  }

  await updateDoc(orderRef, updateData);
};

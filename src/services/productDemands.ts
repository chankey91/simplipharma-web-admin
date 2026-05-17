import {
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  Timestamp,
  writeBatch,
} from './firebase';
import { OrderMedicine, ProductDemand, PurchaseInvoice } from '../types';
import { getMedicineById } from './inventory';
import { getAllPurchaseInvoices, getPurchaseInvoiceByReference } from './purchaseInvoices';
import {
  buildFulfilledDemandOrderLine,
  findPiItemForFulfilledDemand,
  serializePromotedDemandLine,
  withInferredPurchaseInvoiceId,
} from '../utils/productDemandOrderLine';

function parseDemandDoc(id: string, data: Record<string, unknown>): ProductDemand {
  const rqRaw = data.requestedQuantity;
  let requestedQuantity = 1;
  if (typeof rqRaw === 'number' && Number.isFinite(rqRaw)) {
    requestedQuantity = Math.max(1, Math.floor(rqRaw));
  } else if (rqRaw != null && rqRaw !== '') {
    const p = parseInt(String(rqRaw), 10);
    if (!isNaN(p) && p >= 1) requestedQuantity = p;
  }
  const ruRaw = data.requestedUnit;
  const requestedUnit =
    typeof ruRaw === 'string' && ruRaw.trim().length > 0 ? ruRaw.trim() : '—';

  return {
    id,
    ...(data as object),
    requestedQuantity,
    requestedUnit,
    createdAt: (data.createdAt as any)?.toDate?.() || data.createdAt,
    updatedAt: (data.updatedAt as any)?.toDate?.() || data.updatedAt,
    fulfilledAt: (data.fulfilledAt as any)?.toDate?.() || data.fulfilledAt,
    rejectedAt: (data.rejectedAt as any)?.toDate?.() || data.rejectedAt,
  } as ProductDemand;
}

/** Load demand docs by id (e.g. for order lines / invoice). */
export const getProductDemandsByIds = async (ids: string[]): Promise<Map<string, ProductDemand>> => {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  const map = new Map<string, ProductDemand>();
  await Promise.all(
    unique.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, 'product_demands', id));
        if (snap.exists()) {
          map.set(id, parseDemandDoc(id, snap.data() as Record<string, unknown>));
        }
      } catch {
        /* ignore missing / permission */
      }
    })
  );
  return map;
};

export const getAllProductDemands = async (): Promise<ProductDemand[]> => {
  const snap = await getDocs(collection(db, 'product_demands'));
  const list = snap.docs.map((d) => parseDemandDoc(d.id, d.data()));
  return list.sort((a, b) => {
    const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return tb - ta;
  });
};

export const fulfillProductDemand = async (
  demandId: string,
  medicineId: string,
  options?: { quantity?: number; fulfillmentNote?: string; purchaseInvoiceId?: string }
): Promise<{ orderId?: string }> => {
  const demandRef = doc(db, 'product_demands', demandId);
  const demandSnap = await getDoc(demandRef);
  if (!demandSnap.exists()) throw new Error('Demand not found');
  const d = demandSnap.data() as Record<string, unknown>;
  if (d.status !== 'pending') throw new Error('Demand is not pending');

  const medicine = await getMedicineById(medicineId);
  if (!medicine) throw new Error('Medicine not found');

  const rqRaw = d.requestedQuantity;
  let lineQty = 1;
  if (typeof rqRaw === 'number' && Number.isFinite(rqRaw) && rqRaw >= 1) {
    lineQty = Math.floor(rqRaw);
  } else if (rqRaw != null && rqRaw !== '') {
    const p = parseInt(String(rqRaw), 10);
    if (!isNaN(p) && p >= 1) lineQty = p;
  }
  if (
    typeof options?.quantity === 'number' &&
    !isNaN(options.quantity) &&
    options.quantity >= 1
  ) {
    lineQty = Math.floor(options.quantity);
  }

  const uid = auth.currentUser?.uid || '';
  const batch = writeBatch(db);
  const fulfilledName = medicine.name || String(d.productName || '');
  const cartQty =
    options?.quantity != null && options.quantity > 0 ? Math.floor(options.quantity) : undefined;

  const demandUpdate: Record<string, unknown> = {
    status: 'fulfilled',
    fulfilledMedicineId: medicineId,
    fulfilledMedicineName: fulfilledName,
    fulfilledAt: Timestamp.now(),
    fulfilledBy: uid,
    fulfillmentNote: options?.fulfillmentNote?.trim() || '',
    purchaseInvoiceId: options?.purchaseInvoiceId?.trim() || '',
    updatedAt: Timestamp.now(),
  };
  if (cartQty != null) {
    demandUpdate.fulfilledCartQuantity = cartQty;
  }

  batch.update(demandRef, demandUpdate);

  const piRef = (options?.purchaseInvoiceId?.trim() || String(d.purchaseInvoiceId || '')).trim();
  let purchaseInvoices: PurchaseInvoice[] | undefined;
  try {
    purchaseInvoices = await getAllPurchaseInvoices();
  } catch {
    purchaseInvoices = undefined;
  }
  if (piRef) {
    const inv = await getPurchaseInvoiceByReference(piRef);
    if (inv) {
      purchaseInvoices = [inv, ...(purchaseInvoices ?? []).filter((p) => p.id !== inv.id)];
    }
  }

  const orderId = typeof d.orderId === 'string' ? d.orderId.trim() : '';
  if (orderId) {
    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (orderSnap.exists()) {
      const orderMedicines = (orderSnap.data().medicines || []) as OrderMedicine[];
      let lineIndex = orderMedicines.findIndex((m) => m.productDemandId === demandId);
      if (lineIndex < 0) {
        lineIndex = orderMedicines.findIndex(
          (m) =>
            m.lineType === 'product_demand' &&
            String(m.name || '')
              .toLowerCase()
              .includes(String(d.productName || '').toLowerCase().slice(0, 8))
        );
      }
      if (lineIndex >= 0) {
        const demandForLine = parseDemandDoc(demandId, {
          ...d,
          status: 'fulfilled',
          fulfilledMedicineId: medicineId,
          fulfilledMedicineName: fulfilledName,
          purchaseInvoiceId: piRef || d.purchaseInvoiceId,
          ...(cartQty != null ? { fulfilledCartQuantity: cartQty } : {}),
        });
        let medList = [medicine];
        const piPreview = findPiItemForFulfilledDemand(
          purchaseInvoices,
          demandForLine,
          orderMedicines[lineIndex].name
        );
        if (piPreview?.medicineId && piPreview.medicineId !== medicine.id) {
          const linked = await getMedicineById(piPreview.medicineId);
          if (linked) medList = [linked];
        }
        const promoted = buildFulfilledDemandOrderLine(
          orderMedicines[lineIndex],
          demandForLine,
          purchaseInvoices,
          medList,
          cartQty
        );
        const nextMedicines = orderMedicines.map((m, i) =>
          i === lineIndex ? (serializePromotedDemandLine(promoted) as unknown as OrderMedicine) : m
        );
        batch.update(orderRef, { medicines: nextMedicines });
      }
    }
  }

  await batch.commit();

  return { orderId: orderId || undefined };
};

/** Attach PI doc id / invoice number to demands when it can be inferred from PI lines. */
export const syncDemandPurchaseInvoiceRefs = async (
  demands: ProductDemand[],
  invoices: PurchaseInvoice[],
  orderMedicines?: OrderMedicine[]
): Promise<ProductDemand[]> => {
  return Promise.all(
    demands.map(async (d) => {
      const line = orderMedicines?.find((m) => m.productDemandId === d.id);
      const enriched = withInferredPurchaseInvoiceId(d, invoices, line?.name);
      const nextRef = enriched.purchaseInvoiceId?.trim();
      const prevRef = d.purchaseInvoiceId?.trim();
      if (nextRef && nextRef !== prevRef) {
        await updateDoc(doc(db, 'product_demands', d.id), {
          purchaseInvoiceId: nextRef,
          updatedAt: Timestamp.now(),
        });
      }
      return enriched;
    })
  );
};

export const rejectProductDemand = async (demandId: string, reason: string): Promise<void> => {
  const demandRef = doc(db, 'product_demands', demandId);
  const demandSnap = await getDoc(demandRef);
  if (!demandSnap.exists()) throw new Error('Demand not found');
  const d = demandSnap.data() as Record<string, unknown>;
  if (d.status !== 'pending') throw new Error('Demand is not pending');

  await updateDoc(demandRef, {
    status: 'rejected',
    rejectionReason: reason.trim(),
    rejectedAt: Timestamp.now(),
    rejectedBy: auth.currentUser?.uid || '',
    updatedAt: Timestamp.now(),
  });
};

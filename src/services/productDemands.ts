import {
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  Timestamp,
  serverTimestamp,
  writeBatch,
} from './firebase';
import { OrderMedicine, ProductDemand, PurchaseInvoice } from '../types';
import { createMedicine, getAllMedicines, getMedicineById } from './inventory';
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

  const imageRaw = data.imageUrl;
  const imageUrl =
    typeof imageRaw === 'string' && imageRaw.trim() ? imageRaw.trim() : undefined;

  return {
    id,
    ...(data as object),
    requestedQuantity,
    requestedUnit,
    imageUrl,
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

/**
 * Ensure a catalog medicine exists for a fulfilled product demand.
 * Matches existing medicines by name (case-insensitive); otherwise creates a new medicines doc.
 */
export async function ensureMedicineForProductDemand(
  demand: {
    productName: string;
    manufacturerName: string;
    requestedUnit: string;
    notes?: string;
    imageUrl?: string;
  },
  nameToMedicineId?: Map<string, string>
): Promise<{ medicineId: string; created: boolean }> {
  const name = demand.productName.trim();
  if (!name) throw new Error('Product name is required to create a medicine');

  const key = name.toLowerCase().trim();
  const cachedId = nameToMedicineId?.get(key);
  if (cachedId) {
    return { medicineId: cachedId, created: false };
  }

  if (!nameToMedicineId) {
    const all = await getAllMedicines();
    const existing = all.find((m) => m.name.toLowerCase().trim() === key);
    if (existing) {
      return { medicineId: existing.id, created: false };
    }
  }

  const medicineId = await createMedicine({
    name,
    manufacturer: (demand.manufacturerName || '').trim() || '—',
    category: 'General',
    unit: demand.requestedUnit?.trim() || undefined,
    stock: 0,
    price: 0,
    gstRate: 5,
    description: demand.notes?.trim() || undefined,
    imageUrl: demand.imageUrl?.trim() || undefined,
  });

  nameToMedicineId?.set(key, medicineId);
  return { medicineId, created: true };
}

export type MigrateProductDemandsToMedicinesResult = {
  processed: number;
  created: number;
  linkedExisting: number;
  demandsUpdated: number;
  ordersRepaired: number;
  skipped: number;
  errors: string[];
};

/**
 * Backfill medicines catalog from existing product_demands (fulfilled, and optionally pending).
 * Does not delete product_demands — links via fulfilledMedicineId and repairs order lines when needed.
 */
export async function migrateProductDemandsToMedicines(options?: {
  /** Also create catalog rows for pending demands (status stays pending). */
  includePending?: boolean;
  /** Promote product_demand lines on linked orders. Default true. */
  repairOrders?: boolean;
}): Promise<MigrateProductDemandsToMedicinesResult> {
  const result: MigrateProductDemandsToMedicinesResult = {
    processed: 0,
    created: 0,
    linkedExisting: 0,
    demandsUpdated: 0,
    ordersRepaired: 0,
    skipped: 0,
    errors: [],
  };

  const demands = await getAllProductDemands();
  const toProcess = demands.filter((d) => {
    if (d.status === 'rejected') return false;
    if (d.status === 'fulfilled') return true;
    return Boolean(options?.includePending && d.status === 'pending');
  });

  const allMedicines = await getAllMedicines();
  const nameToMedicineId = new Map<string, string>();
  for (const m of allMedicines) {
    const k = m.name.toLowerCase().trim();
    if (k && !nameToMedicineId.has(k)) {
      nameToMedicineId.set(k, m.id);
    }
  }

  let purchaseInvoices: PurchaseInvoice[] | undefined;
  try {
    purchaseInvoices = await getAllPurchaseInvoices();
  } catch {
    purchaseInvoices = undefined;
  }

  for (const demand of toProcess) {
    result.processed++;
    try {
      if (!demand.productName?.trim()) {
        result.skipped++;
        continue;
      }

      let medicineId = demand.fulfilledMedicineId?.trim() || '';
      if (medicineId) {
        const med = await getMedicineById(medicineId);
        if (!med) medicineId = '';
      }

      let created = false;
      if (!medicineId) {
        const ensured = await ensureMedicineForProductDemand(
          {
            productName: demand.productName,
            manufacturerName: demand.manufacturerName,
            requestedUnit: demand.requestedUnit,
            notes: demand.notes,
            imageUrl: demand.imageUrl,
          },
          nameToMedicineId
        );
        medicineId = ensured.medicineId;
        created = ensured.created;
        if (created) result.created++;
        else result.linkedExisting++;
      } else {
        result.linkedExisting++;
      }

      const medicine = await getMedicineById(medicineId);
      if (!medicine) {
        throw new Error('Medicine missing after ensure');
      }

      const fulfilledName = medicine.name || demand.productName;

      if (demand.status === 'fulfilled') {
        const needsDemandUpdate =
          demand.fulfilledMedicineId !== medicineId ||
          !demand.fulfilledMedicineName ||
          demand.fulfilledMedicineName !== fulfilledName;

        if (needsDemandUpdate) {
          await updateDoc(doc(db, 'product_demands', demand.id), {
            fulfilledMedicineId: medicineId,
            fulfilledMedicineName: fulfilledName,
            updatedAt: serverTimestamp(),
          });
          result.demandsUpdated++;
        }
      }

      const orderId = demand.orderId?.trim();
      if (options?.repairOrders !== false && orderId && demand.status === 'fulfilled') {
        const orderRef = doc(db, 'orders', orderId);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          const orderMedicines = (orderSnap.data().medicines || []) as OrderMedicine[];
          const lineIndex = orderMedicines.findIndex(
            (m) =>
              m.productDemandId === demand.id ||
              (m.lineType === 'product_demand' &&
                String(m.name || '')
                  .toLowerCase()
                  .includes(demand.productName.toLowerCase().slice(0, 8)))
          );
          if (lineIndex >= 0 && orderMedicines[lineIndex].lineType === 'product_demand') {
            const dSnap = await getDoc(doc(db, 'product_demands', demand.id));
            const d = dSnap.data() as Record<string, unknown>;
            const cartQty =
              typeof demand.fulfilledCartQuantity === 'number'
                ? demand.fulfilledCartQuantity
                : undefined;
            const demandForLine = parseDemandDoc(demand.id, {
              ...d,
              status: 'fulfilled',
              fulfilledMedicineId: medicineId,
              fulfilledMedicineName: fulfilledName,
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
            await updateDoc(orderRef, { medicines: nextMedicines });
            result.ordersRepaired++;
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (result.errors.length < 40) {
        result.errors.push(`${demand.id} (${demand.productName}): ${msg}`);
      }
    }
  }

  return result;
}

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
  options?: {
    /** Link to an existing catalog item; if omitted, creates or matches by product name. */
    medicineId?: string;
    quantity?: number;
    fulfillmentNote?: string;
    purchaseInvoiceId?: string;
  }
): Promise<{ orderId?: string; medicineId: string; medicineCreated: boolean }> => {
  const demandRef = doc(db, 'product_demands', demandId);
  const demandSnap = await getDoc(demandRef);
  if (!demandSnap.exists()) throw new Error('Demand not found');
  const d = demandSnap.data() as Record<string, unknown>;
  if (d.status !== 'pending') throw new Error('Demand is not pending');

  let medicineId = options?.medicineId?.trim() || '';
  let medicineCreated = false;

  if (!medicineId) {
    const ensured = await ensureMedicineForProductDemand({
      productName: String(d.productName || ''),
      manufacturerName: String(d.manufacturerName || ''),
      requestedUnit: String(d.requestedUnit || '—'),
      notes: typeof d.notes === 'string' ? d.notes : undefined,
      imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : undefined,
    });
    medicineId = ensured.medicineId;
    medicineCreated = ensured.created;
  }

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
    fulfilledAt: serverTimestamp(),
    fulfilledBy: uid,
    fulfillmentNote: options?.fulfillmentNote?.trim() || '',
    purchaseInvoiceId: options?.purchaseInvoiceId?.trim() || '',
    updatedAt: serverTimestamp(),
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

  return {
    orderId: orderId || undefined,
    medicineId,
    medicineCreated,
  };
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
          updatedAt: serverTimestamp(),
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
    rejectedAt: serverTimestamp(),
    rejectedBy: auth.currentUser?.uid || '',
    updatedAt: serverTimestamp(),
  });
};

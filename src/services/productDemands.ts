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
import { ProductDemand } from '../types';

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
): Promise<void> => {
  const demandRef = doc(db, 'product_demands', demandId);
  const demandSnap = await getDoc(demandRef);
  if (!demandSnap.exists()) throw new Error('Demand not found');
  const d = demandSnap.data() as Record<string, unknown>;
  if (d.status !== 'pending') throw new Error('Demand is not pending');

  const medSnap = await getDoc(doc(db, 'medicines', medicineId));
  if (!medSnap.exists()) throw new Error('Medicine not found');
  const med = medSnap.data() as Record<string, unknown>;

  const uid = auth.currentUser?.uid || '';
  const batch = writeBatch(db);

  batch.update(demandRef, {
    status: 'fulfilled',
    fulfilledMedicineId: medicineId,
    fulfilledMedicineName: (med.name as string) || d.productName,
    fulfilledAt: Timestamp.now(),
    fulfilledBy: uid,
    fulfillmentNote: options?.fulfillmentNote?.trim() || '',
    purchaseInvoiceId: options?.purchaseInvoiceId?.trim() || '',
    updatedAt: Timestamp.now(),
  });

  const rq = d.requestedQuantity;
  const defaultFromDemand =
    typeof rq === 'number' && Number.isFinite(rq) && rq >= 1 ? Math.floor(rq) : 1;

  const queueRef = doc(collection(db, 'users', String(d.retailerId), 'demandCartQueue'));
  batch.set(queueRef, {
    medicineId,
    quantity:
      options?.quantity && options.quantity > 0 ? Math.floor(options.quantity) : defaultFromDemand,
    demandId,
    productName: d.productName,
    createdAt: Timestamp.now(),
  });

  await batch.commit();
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

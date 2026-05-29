import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  db,
  auth,
} from './firebase';
import { addStockBatch, restoreStockToBatch } from './inventory';

export interface ExpiryReturnItem {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | any;
  unitRefundPrice: number;
  refundAmount: number;
  orderId?: string;
}

export type ExpiryReturnStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface ExpiryReturnRequest {
  id: string;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  salesOfficerId: string;
  items: ExpiryReturnItem[];
  totalRefundAmount: number;
  status: ExpiryReturnStatus;
  createdAt: Date | any;
  updatedAt?: Date | any;
  submittedBy?: string;
  soNotes?: string;
  receivedBySO?: string;
  receivedAt?: Date | any;
  approvedBy?: string;
  approvedAt?: Date | any;
  rejectedBy?: string;
  rejectedAt?: Date | any;
  rejectionReason?: string;
  paymentReferenceNumber?: string;
  paymentDate?: Date | any;
  paymentMethod?: string;
  paidBy?: string;
  paidAt?: Date | any;
}

const parseDoc = (d: any): ExpiryReturnRequest => {
  const data = d.data();
  const items = (data.items || []).map((i: any) => ({
    ...i,
    expiryDate: i.expiryDate?.toDate?.() || i.expiryDate,
  }));
  return {
    id: d.id,
    ...data,
    items,
    totalRefundAmount: data.totalRefundAmount ?? 0,
    createdAt: data.createdAt?.toDate?.() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
    receivedAt: data.receivedAt?.toDate?.() || data.receivedAt,
    approvedAt: data.approvedAt?.toDate?.() || data.approvedAt,
    rejectedAt: data.rejectedAt?.toDate?.() || data.rejectedAt,
    paymentDate: data.paymentDate?.toDate?.() || data.paymentDate,
    paidAt: data.paidAt?.toDate?.() || data.paidAt,
  } as ExpiryReturnRequest;
};

const toDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate();
  }
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export const getExpiryReturnRequests = async (
  status?: ExpiryReturnStatus
): Promise<ExpiryReturnRequest[]> => {
  const col = collection(db, 'expiry_return_requests');
  let q;
  if (status) {
    q = query(col, where('status', '==', status), orderBy('createdAt', 'desc'));
  } else {
    q = query(col, orderBy('createdAt', 'desc'));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => parseDoc(d));
};

export const approveExpiryReturnRequest = async (requestId: string): Promise<void> => {
  const reqRef = doc(db, 'expiry_return_requests', requestId);

  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Expiry return request not found');
  }

  const reqData = parseDoc(reqSnap);
  if (reqData.status !== 'pending') {
    throw new Error('Expiry return request is not awaiting approval');
  }
  const missingBatchItems = (reqData.items || []).filter(
    (item) => String(item.batchNumber || '').trim().length === 0
  );
  if (missingBatchItems.length > 0) {
    const names = missingBatchItems
      .map((i) => i.medicineName || i.medicineId || 'Unknown item')
      .join(', ');
    throw new Error(`Batch number missing for expiry return item(s): ${names}. Please capture batch in return request.`);
  }

  // Restore inventory on approval by medicine+batch.
  const restoreMap = new Map<string, { medicineId: string; batchNumber: string; quantity: number; expiryDate?: unknown }>();
  for (const item of reqData.items || []) {
    const medicineId = String(item.medicineId || '').trim();
    const batchNumber = String(item.batchNumber || '').trim();
    const qty = Number(item.quantity) || 0;
    if (!medicineId || !batchNumber || qty <= 0) continue;
    const key = `${medicineId}|${batchNumber}`;
    const prev = restoreMap.get(key);
    if (prev) {
      prev.quantity += qty;
    } else {
      restoreMap.set(key, {
        medicineId,
        batchNumber,
        quantity: qty,
        expiryDate: item.expiryDate,
      });
    }
  }

  for (const restore of restoreMap.values()) {
    try {
      await restoreStockToBatch(restore.medicineId, restore.batchNumber, restore.quantity);
    } catch (error: any) {
      const msg = String(error?.message || error || '').toLowerCase();
      if (msg.includes('batch') && msg.includes('not found')) {
        await addStockBatch(restore.medicineId, {
          batchNumber: restore.batchNumber,
          quantity: restore.quantity,
          expiryDate: toDate(restore.expiryDate),
        } as any);
      } else {
        throw error;
      }
    }
  }

  await updateDoc(reqRef, {
    status: 'approved',
    approvedBy: auth.currentUser?.uid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const rejectExpiryReturnRequest = async (
  requestId: string,
  reason?: string
): Promise<void> => {
  const reqRef = doc(db, 'expiry_return_requests', requestId);
  await updateDoc(reqRef, {
    status: 'rejected',
    rejectionReason: reason || '',
    rejectedBy: auth.currentUser?.uid,
    rejectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const recordExpiryReturnPayment = async (
  requestId: string,
  data: {
    paymentReferenceNumber: string;
    paymentDate: Date;
    paymentMethod: string;
  }
): Promise<void> => {
  const reqRef = doc(db, 'expiry_return_requests', requestId);
  await updateDoc(reqRef, {
    status: 'paid',
    paymentReferenceNumber: data.paymentReferenceNumber.trim(),
    paymentDate: Timestamp.fromDate(data.paymentDate),
    paymentMethod: data.paymentMethod || 'Offline',
    paidBy: auth.currentUser?.uid,
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

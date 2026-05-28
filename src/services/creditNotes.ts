import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  writeBatch,
  Timestamp,
  db,
  auth,
} from './firebase';
import { getOrderById } from './orders';
import { getMedicineById } from './inventory';
import { addStockBatch, restoreStockToBatch } from './inventory';
import { generateCreditNoteNumber } from '../utils/invoiceNumber';
import { CreditNote, CreditNoteLine } from '../types';

type ReturnItemInput = {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  expiryDate?: unknown;
  unitRefundPrice: number;
  refundAmount: number;
};

export type ReturnRequestInput = {
  id: string;
  orderId: string;
  retailerId: string;
  retailerName?: string;
  retailerEmail?: string;
  invoiceNumber?: string;
  items: ReturnItemInput[];
  totalRefundAmount: number;
  status: string;
  creditNoteId?: string;
  creditNoteNumber?: string;
  approvedAt?: unknown;
  approvedBy?: string;
  createdAt?: unknown;
};

function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  if (value != null) {
    const d = new Date(value as string | number);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function toTimestamp(value: unknown): Timestamp {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return value as Timestamp;
  }
  if (value instanceof Date) return Timestamp.fromDate(value);
  return Timestamp.now();
}

function parseReturnRequestDoc(id: string, data: Record<string, unknown>): ReturnRequestInput {
  return {
    id,
    ...(data as object),
    items: ((data.items as ReturnItemInput[]) || []).map((i) => ({
      ...i,
      expiryDate: (i.expiryDate as { toDate?: () => Date })?.toDate?.() || i.expiryDate,
    })),
    createdAt: data.createdAt,
    approvedAt: data.approvedAt,
  } as ReturnRequestInput;
}

function parseCreditNoteDoc(id: string, data: Record<string, unknown>): CreditNote {
  const items = ((data.items as CreditNoteLine[]) || []).map((item) => ({
    ...item,
    expiryDate: item.expiryDate ? toDate(item.expiryDate) : undefined,
  }));

  return {
    id,
    ...(data as object),
    items,
    creditNoteDate: toDate(data.creditNoteDate ?? data.createdAt),
    createdAt: toDate(data.createdAt),
  } as CreditNote;
}

async function buildCreditNoteLines(
  items: ReturnItemInput[],
  defaultTaxPercentage: number
): Promise<{ lines: CreditNoteLine[]; subTotal: number; taxAmount: number; taxPercentage: number }> {
  let subTotal = 0;
  let taxAmount = 0;
  let taxPercentage = defaultTaxPercentage;

  const lines: CreditNoteLine[] = await Promise.all(
    items.map(async (item) => {
      let hsn = '—';
      let gstRate = defaultTaxPercentage;
      try {
        const medicine = await getMedicineById(item.medicineId);
        if (medicine?.code) hsn = medicine.code;
        if (medicine?.gstRate != null) gstRate = medicine.gstRate;
      } catch {
        /* ignore lookup failures */
      }

      const lineTotal = item.refundAmount ?? item.unitRefundPrice * item.quantity;
      const taxable = lineTotal / (1 + gstRate / 100);
      const lineTax = lineTotal - taxable;
      subTotal += taxable;
      taxAmount += lineTax;
      taxPercentage = gstRate;

      return {
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        expiryDate: item.expiryDate ? toDate(item.expiryDate) : undefined,
        hsn,
        gstRate,
        unitRefundPrice: item.unitRefundPrice,
        refundAmount: lineTotal,
      };
    })
  );

  return { lines, subTotal, taxAmount, taxPercentage };
}

async function findCreditNoteByReturnRequestId(
  orderReturnRequestId: string
): Promise<CreditNote | null> {
  const col = collection(db, 'credit_notes');
  try {
    const snap = await getDocs(
      query(col, where('orderReturnRequestId', '==', orderReturnRequestId), limit(1))
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return parseCreditNoteDoc(d.id, d.data() as Record<string, unknown>);
  } catch {
    const snap = await getDocs(col);
    const match = snap.docs.find((d) => d.data().orderReturnRequestId === orderReturnRequestId);
    return match ? parseCreditNoteDoc(match.id, match.data() as Record<string, unknown>) : null;
  }
}

export const getAllCreditNotes = async (): Promise<CreditNote[]> => {
  const col = collection(db, 'credit_notes');
  try {
    const snap = await getDocs(query(col, orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => parseCreditNoteDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    const snap = await getDocs(col);
    const list = snap.docs.map((d) => parseCreditNoteDoc(d.id, d.data() as Record<string, unknown>));
    return list.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
  }
};

export const getCreditNoteById = async (creditNoteId: string): Promise<CreditNote | null> => {
  const snap = await getDoc(doc(db, 'credit_notes', creditNoteId));
  if (!snap.exists()) return null;
  return parseCreditNoteDoc(snap.id, snap.data() as Record<string, unknown>);
};

export async function issueCreditNoteForOrderReturn(
  returnRequest: ReturnRequestInput,
  options?: { creditNoteDate?: Date }
): Promise<{ creditNoteId: string; creditNoteNumber: string; created: boolean }> {
  const reqRef = doc(db, 'order_return_requests', returnRequest.id);

  if (returnRequest.creditNoteId && returnRequest.creditNoteNumber) {
    return {
      creditNoteId: returnRequest.creditNoteId,
      creditNoteNumber: returnRequest.creditNoteNumber,
      created: false,
    };
  }

  const existing = await findCreditNoteByReturnRequestId(returnRequest.id);
  if (existing) {
    const batch = writeBatch(db);
    batch.update(reqRef, {
      creditNoteId: existing.id,
      creditNoteNumber: existing.creditNoteNumber,
      updatedAt: Timestamp.now(),
    });
    await batch.commit();
    return {
      creditNoteId: existing.id,
      creditNoteNumber: existing.creditNoteNumber,
      created: false,
    };
  }

  if (returnRequest.status !== 'approved' && returnRequest.status !== 'paid') {
    throw new Error('Credit notes can only be issued for approved or paid returns');
  }

  const order = returnRequest.orderId ? await getOrderById(returnRequest.orderId) : null;
  const defaultTaxPercentage = order?.taxPercentage ?? 5;
  const { lines, subTotal, taxAmount, taxPercentage } = await buildCreditNoteLines(
    returnRequest.items,
    defaultTaxPercentage
  );

  const creditNoteNumber = await generateCreditNoteNumber();
  const creditNoteRef = doc(collection(db, 'credit_notes'));
  const creditNoteDate = options?.creditNoteDate
    ? Timestamp.fromDate(options.creditNoteDate)
    : returnRequest.approvedAt
      ? toTimestamp(returnRequest.approvedAt)
      : Timestamp.now();
  const now = Timestamp.now();

  const note: Omit<CreditNote, 'id'> = {
    creditNoteNumber,
    creditNoteDate,
    type: 'order_return',
    orderReturnRequestId: returnRequest.id,
    orderId: returnRequest.orderId,
    originalInvoiceNumber: returnRequest.invoiceNumber || order?.invoiceNumber,
    retailerId: returnRequest.retailerId,
    retailerName: returnRequest.retailerName,
    retailerEmail: returnRequest.retailerEmail,
    items: lines,
    subTotal: Math.round(subTotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    totalAmount: returnRequest.totalRefundAmount,
    taxPercentage,
    status: 'issued',
    createdBy: returnRequest.approvedBy || auth.currentUser?.uid,
    createdAt: now,
  };

  const batch = writeBatch(db);
  batch.set(creditNoteRef, note);
  batch.update(reqRef, {
    creditNoteId: creditNoteRef.id,
    creditNoteNumber,
    updatedAt: now,
  });
  await batch.commit();

  return { creditNoteId: creditNoteRef.id, creditNoteNumber, created: true };
}

export const approveOrderReturnRequest = async (
  requestId: string
): Promise<{ creditNoteNumber: string; creditNoteId: string }> => {
  const reqRef = doc(db, 'order_return_requests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Return request not found');
  }

  const returnRequest = parseReturnRequestDoc(reqSnap.id, reqSnap.data() as Record<string, unknown>);

  if (returnRequest.status !== 'pending_admin') {
    throw new Error('Return request is not awaiting admin approval');
  }

  // Restore inventory back to the original medicine batch on approval.
  // Group by medicine+batch to avoid multiple writes for split rows.
  const restoreMap = new Map<string, { medicineId: string; batchNumber: string; quantity: number; expiryDate?: unknown }>();
  for (const item of returnRequest.items || []) {
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
      // If original batch was deleted/missing, recreate a batch bucket and add returned quantity.
      if (msg.includes('batch') && msg.includes('not found')) {
        await addStockBatch(restore.medicineId, {
          batchNumber: restore.batchNumber,
          quantity: restore.quantity,
          expiryDate: restore.expiryDate ? toDate(restore.expiryDate) : undefined,
        } as any);
      } else {
        throw error;
      }
    }
  }

  const now = Timestamp.now();
  const approveBatch = writeBatch(db);
  approveBatch.update(reqRef, {
    status: 'approved',
    approvedBy: auth.currentUser?.uid,
    approvedAt: now,
    updatedAt: now,
  });
  await approveBatch.commit();

  const issued = await issueCreditNoteForOrderReturn(
    { ...returnRequest, status: 'approved', approvedAt: now, approvedBy: auth.currentUser?.uid },
    { creditNoteDate: new Date() }
  );

  return { creditNoteId: issued.creditNoteId, creditNoteNumber: issued.creditNoteNumber };
};

export const issueCreditNoteForReturnRequestId = async (
  requestId: string
): Promise<{ creditNoteNumber: string; creditNoteId: string; created: boolean }> => {
  const reqSnap = await getDoc(doc(db, 'order_return_requests', requestId));
  if (!reqSnap.exists()) {
    throw new Error('Return request not found');
  }
  const returnRequest = parseReturnRequestDoc(reqSnap.id, reqSnap.data() as Record<string, unknown>);
  const issued = await issueCreditNoteForOrderReturn(returnRequest, {
    creditNoteDate: returnRequest.approvedAt
      ? toDate(returnRequest.approvedAt)
      : toDate(returnRequest.createdAt),
  });
  return {
    creditNoteId: issued.creditNoteId,
    creditNoteNumber: issued.creditNoteNumber,
    created: issued.created,
  };
};

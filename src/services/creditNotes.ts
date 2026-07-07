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
  updateDoc,
  Timestamp,
  serverTimestamp,
  db,
  auth,
} from './firebase';
import { getOrderById } from './orders';
import { getMedicineById } from './inventory';
import { addStockBatch, restoreStockToBatch } from './inventory';
import { generateCreditNoteNumber } from '../utils/invoiceNumber';
import { getTodayStartIST } from '../utils/dateTime';
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

const normalizeBatchNumber = (value: unknown): string => String(value || '').trim();

function resolveItemBatchFromOrder(item: ReturnItemInput, order: Awaited<ReturnType<typeof getOrderById>>): string {
  const explicit = normalizeBatchNumber(item.batchNumber);
  if (explicit) return explicit;
  if (!order?.medicines?.length) return '';

  const candidates = new Set<string>();
  for (const line of order.medicines) {
    if (!line || line.medicineId !== item.medicineId) continue;
    const lineBatch = normalizeBatchNumber((line as any).batchNumber);
    if (lineBatch) candidates.add(lineBatch);
    if (Array.isArray((line as any).batchAllocations)) {
      for (const alloc of (line as any).batchAllocations) {
        const allocBatch = normalizeBatchNumber((alloc as any)?.batchNumber);
        if (allocBatch) candidates.add(allocBatch);
      }
    }
  }
  return candidates.size === 1 ? [...candidates][0] : '';
}

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

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
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
      let lineMrp: number | undefined = undefined;
      try {
        const medicine = await getMedicineById(item.medicineId);
        if (medicine?.code) hsn = medicine.code;
        if (medicine?.gstRate != null) gstRate = medicine.gstRate;
        const batchNo = normalizeBatchNumber(item.batchNumber);
        const batch = batchNo
          ? medicine?.stockBatches?.find((b: any) => normalizeBatchNumber((b as any)?.batchNumber) === batchNo)
          : undefined;
        const batchMrp = typeof batch?.mrp === 'number' ? batch.mrp : parseFloat(String(batch?.mrp ?? ''));
        const medMrp =
          typeof medicine?.mrp === 'number' ? medicine.mrp : parseFloat(String((medicine as any)?.mrp ?? ''));
        if (Number.isFinite(batchMrp) && batchMrp > 0) {
          lineMrp = batchMrp;
        } else if (Number.isFinite(medMrp) && medMrp > 0) {
          lineMrp = medMrp;
        }
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
        batchNumber: normalizeBatchNumber(item.batchNumber),
        ...(lineMrp !== undefined ? { mrp: lineMrp } : {}),
        quantity: item.quantity,
        ...(item.expiryDate ? { expiryDate: toDate(item.expiryDate) } : {}),
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

/** Credit notes for a retailer (store ledger). */
export const getCreditNotesByRetailer = async (retailerId: string): Promise<CreditNote[]> => {
  const col = collection(db, 'credit_notes');
  try {
    const snap = await getDocs(
      query(col, where('retailerId', '==', retailerId), orderBy('creditNoteDate', 'asc'))
    );
    return snap.docs.map((d) => parseCreditNoteDoc(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    console.warn('getCreditNotesByRetailer query failed, falling back to full scan:', error);
    const all = await getAllCreditNotes();
    return all
      .filter((n) => n.retailerId === retailerId)
      .sort(
        (a, b) =>
          toDate(a.creditNoteDate).getTime() - toDate(b.creditNoteDate).getTime()
      );
  }
};

/** Credit notes in a reporting window (for margin report — avoids full collection when period ≠ all). */
export const getCreditNotesInRange = async (
  startMs: number,
  endMs?: number
): Promise<CreditNote[]> => {
  const col = collection(db, 'credit_notes');
  const start = Timestamp.fromMillis(startMs);
  try {
    const q =
      endMs != null
        ? query(
            col,
            where('creditNoteDate', '>=', start),
            where('creditNoteDate', '<', Timestamp.fromMillis(endMs)),
            orderBy('creditNoteDate', 'desc')
          )
        : query(col, where('creditNoteDate', '>=', start), orderBy('creditNoteDate', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => parseCreditNoteDoc(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    console.warn('getCreditNotesInRange fallback:', error);
    const all = await getAllCreditNotes();
    return all.filter((note) => {
      const d = toDate(note.creditNoteDate ?? note.createdAt);
      const t = d.getTime();
      if (endMs != null) return t >= startMs && t < endMs;
      return t >= startMs;
    });
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
      updatedAt: serverTimestamp(),
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
  const resolvedItems = (returnRequest.items || []).map((item) => ({
    ...item,
    batchNumber: resolveItemBatchFromOrder(item, order),
  }));
  const missingBatchItems = resolvedItems.filter((item) => !normalizeBatchNumber(item.batchNumber));
  if (missingBatchItems.length > 0) {
    const names = missingBatchItems
      .map((i) => i.medicineName || i.medicineId || 'Unknown item')
      .join(', ');
    throw new Error(`Batch number missing for return item(s): ${names}. Please capture batch in return request.`);
  }

  const defaultTaxPercentage = order?.taxPercentage ?? 5;
  const { lines, subTotal, taxAmount, taxPercentage } = await buildCreditNoteLines(
    resolvedItems,
    defaultTaxPercentage
  );

  const creditNoteNumber = await generateCreditNoteNumber();
  const creditNoteRef = doc(collection(db, 'credit_notes'));
  const creditNoteDate = options?.creditNoteDate
    ? Timestamp.fromDate(options.creditNoteDate)
    : returnRequest.approvedAt
      ? toTimestamp(returnRequest.approvedAt)
      : serverTimestamp();

  const note: Omit<CreditNote, 'id'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
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
    createdAt: serverTimestamp(),
  };
  const noteSafe = stripUndefinedDeep(note);

  const batch = writeBatch(db);
  batch.set(creditNoteRef, noteSafe);
  batch.update(reqRef, {
    creditNoteId: creditNoteRef.id,
    creditNoteNumber,
    updatedAt: serverTimestamp(),
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

  const order = returnRequest.orderId ? await getOrderById(returnRequest.orderId) : null;
  const resolvedItems = (returnRequest.items || []).map((item) => ({
    ...item,
    batchNumber: resolveItemBatchFromOrder(item, order),
  }));
  const missingBatchItems = resolvedItems.filter((item) => !normalizeBatchNumber(item.batchNumber));
  if (missingBatchItems.length > 0) {
    const names = missingBatchItems
      .map((i) => i.medicineName || i.medicineId || 'Unknown item')
      .join(', ');
    throw new Error(`Batch number missing for return item(s): ${names}. Please capture batch in return request.`);
  }

  // Restore inventory back to the original medicine batch on approval.
  // Group by medicine+batch to avoid multiple writes for split rows.
  const restoreMap = new Map<string, { medicineId: string; batchNumber: string; quantity: number; expiryDate?: unknown }>();
  for (const item of resolvedItems) {
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

  const approveBatch = writeBatch(db);
  approveBatch.update(reqRef, {
    status: 'approved',
    approvedBy: auth.currentUser?.uid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await approveBatch.commit();

  const issued = await issueCreditNoteForOrderReturn(
    {
      ...returnRequest,
      items: resolvedItems,
      status: 'approved',
      approvedBy: auth.currentUser?.uid,
    },
    { creditNoteDate: getTodayStartIST() }
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

async function loadReturnRequestForCreditNote(
  note: CreditNote
): Promise<ReturnRequestInput | null> {
  if (!note.orderReturnRequestId) return null;
  const snap = await getDoc(doc(db, 'order_return_requests', note.orderReturnRequestId));
  if (!snap.exists()) return null;
  return parseReturnRequestDoc(snap.id, snap.data() as Record<string, unknown>);
}

async function resolveLineMrp(
  medicineId: string,
  batchNumber: string,
  existingMrp?: number
): Promise<number | undefined> {
  if (existingMrp != null && Number.isFinite(existingMrp) && existingMrp > 0) {
    return existingMrp;
  }
  try {
    const medicine = await getMedicineById(medicineId);
    const batch = batchNumber
      ? medicine?.stockBatches?.find(
          (b) => normalizeBatchNumber((b as { batchNumber?: string }).batchNumber) === batchNumber
        )
      : undefined;
    const batchMrp =
      typeof batch?.mrp === 'number' ? batch.mrp : parseFloat(String(batch?.mrp ?? ''));
    const medMrp =
      typeof medicine?.mrp === 'number'
        ? medicine.mrp
        : parseFloat(String((medicine as { mrp?: number })?.mrp ?? ''));
    if (Number.isFinite(batchMrp) && batchMrp > 0) return batchMrp;
    if (Number.isFinite(medMrp) && medMrp > 0) return medMrp;
  } catch {
    /* ignore */
  }
  return undefined;
}

async function enrichCreditNoteLine(
  line: CreditNoteLine,
  order: Awaited<ReturnType<typeof getOrderById>>,
  returnRequest: ReturnRequestInput | null
): Promise<CreditNoteLine> {
  const returnItem = returnRequest?.items?.find((i) => i.medicineId === line.medicineId);
  const pseudoItem: ReturnItemInput = {
    medicineId: line.medicineId,
    medicineName: line.medicineName,
    batchNumber:
      normalizeBatchNumber(line.batchNumber) ||
      normalizeBatchNumber(returnItem?.batchNumber) ||
      '',
    quantity: line.quantity,
    expiryDate: line.expiryDate ?? returnItem?.expiryDate,
    unitRefundPrice: line.unitRefundPrice,
    refundAmount: line.refundAmount,
  };

  const batchNumber =
    normalizeBatchNumber(line.batchNumber) ||
    normalizeBatchNumber(returnItem?.batchNumber) ||
    resolveItemBatchFromOrder(pseudoItem, order);

  const mrp = await resolveLineMrp(line.medicineId, batchNumber, line.mrp);

  return {
    ...line,
    batchNumber,
    ...(mrp !== undefined ? { mrp } : {}),
    ...(line.expiryDate || returnItem?.expiryDate
      ? { expiryDate: line.expiryDate ?? (returnItem?.expiryDate ? toDate(returnItem.expiryDate) : undefined) }
      : {}),
  };
}

function creditNoteLineToFirestore(line: CreditNoteLine): Record<string, unknown> {
  const row: Record<string, unknown> = {
    medicineId: line.medicineId,
    medicineName: line.medicineName,
    batchNumber: normalizeBatchNumber(line.batchNumber),
    quantity: line.quantity,
    gstRate: line.gstRate,
    unitRefundPrice: line.unitRefundPrice,
    refundAmount: line.refundAmount,
  };
  if (line.hsn) row.hsn = line.hsn;
  if (line.mrp != null && Number.isFinite(line.mrp) && line.mrp > 0) row.mrp = line.mrp;
  if (line.expiryDate) {
    row.expiryDate =
      line.expiryDate instanceof Date ? Timestamp.fromDate(line.expiryDate) : line.expiryDate;
  }
  return row;
}

function creditNoteNeedsBackfill(note: CreditNote): boolean {
  if (!note.originalInvoiceNumber?.trim()) return true;
  return (note.items || []).some((line) => {
    const batchMissing = !normalizeBatchNumber(line.batchNumber);
    const mrpMissing = line.mrp == null || !Number.isFinite(line.mrp) || line.mrp <= 0;
    return batchMissing || mrpMissing;
  });
}

function linesChanged(before: CreditNoteLine[], after: CreditNoteLine[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((line, idx) => {
    const next = after[idx];
    return (
      normalizeBatchNumber(line.batchNumber) !== normalizeBatchNumber(next.batchNumber) ||
      (line.mrp ?? 0) !== (next.mrp ?? 0)
    );
  });
}

export type CreditNoteBackfillResult = {
  creditNoteId: string;
  creditNoteNumber: string;
  updated: boolean;
  message?: string;
};

export type CreditNoteBackfillSummary = {
  scanned: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: CreditNoteBackfillResult[];
};

/** Repair stored batch/MRP (and missing original invoice ref) on an existing credit note. */
export async function backfillCreditNoteById(creditNoteId: string): Promise<CreditNoteBackfillResult> {
  const note = await getCreditNoteById(creditNoteId);
  if (!note) {
    return {
      creditNoteId,
      creditNoteNumber: '—',
      updated: false,
      message: 'Credit note not found',
    };
  }

  if (!creditNoteNeedsBackfill(note)) {
    return {
      creditNoteId: note.id,
      creditNoteNumber: note.creditNoteNumber,
      updated: false,
      message: 'Already complete',
    };
  }

  const order = note.orderId ? await getOrderById(note.orderId) : null;
  const returnRequest = await loadReturnRequestForCreditNote(note);

  const enrichedItems = await Promise.all(
    (note.items || []).map((line) => enrichCreditNoteLine(line, order, returnRequest))
  );

  const originalInvoiceNumber =
    note.originalInvoiceNumber?.trim() ||
    returnRequest?.invoiceNumber?.trim() ||
    order?.invoiceNumber?.trim() ||
    '';

  const headerChanged = Boolean(originalInvoiceNumber && !note.originalInvoiceNumber?.trim());
  const itemsChanged = linesChanged(note.items || [], enrichedItems);

  if (!headerChanged && !itemsChanged) {
    return {
      creditNoteId: note.id,
      creditNoteNumber: note.creditNoteNumber,
      updated: false,
      message: 'Could not resolve missing batch/MRP from order or return data',
    };
  }

  const updatePayload = stripUndefinedDeep({
    items: enrichedItems.map(creditNoteLineToFirestore),
    ...(originalInvoiceNumber ? { originalInvoiceNumber } : {}),
  });

  await updateDoc(doc(db, 'credit_notes', note.id), updatePayload);

  return {
    creditNoteId: note.id,
    creditNoteNumber: note.creditNoteNumber,
    updated: true,
    message: 'Batch/MRP repaired',
  };
}

/** Backfill all order-return credit notes that are missing batch or MRP on line items. */
export async function backfillAllCreditNotes(): Promise<CreditNoteBackfillSummary> {
  const notes = await getAllCreditNotes();
  const targets = notes.filter((n) => n.type === 'order_return' && creditNoteNeedsBackfill(n));

  const summary: CreditNoteBackfillSummary = {
    scanned: targets.length,
    updated: 0,
    unchanged: 0,
    failed: 0,
    results: [],
  };

  for (const note of targets) {
    try {
      const result = await backfillCreditNoteById(note.id);
      summary.results.push(result);
      if (result.updated) summary.updated += 1;
      else summary.unchanged += 1;
    } catch (err: unknown) {
      summary.failed += 1;
      summary.results.push({
        creditNoteId: note.id,
        creditNoteNumber: note.creditNoteNumber,
        updated: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

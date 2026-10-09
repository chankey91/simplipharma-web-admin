import {
  addDoc,
  collection,
  db,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
  writeBatch,
} from './firebase';
import type { PaymentRequest, SoCashRemittance } from '../types';
import {
  isSoCollectedCashRequest,
  resolveSoCashCollector,
} from './paymentRequests';

function toDate(value: unknown): Date | unknown {
  if (!value) return value;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? value : parsed;
}

function parsePaymentRequestDoc(id: string, data: Record<string, unknown>): PaymentRequest {
  return {
    id,
    ...(data as Omit<PaymentRequest, 'id'>),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    reviewedAt: toDate(data.reviewedAt),
    remittedAt: toDate(data.remittedAt),
  } as PaymentRequest;
}

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type SoCashBagRow = {
  salesOfficerId: string;
  salesOfficerName: string;
  unremittedAmount: number;
  remittedAmount: number;
  requestCount: number;
  requests: PaymentRequest[];
};

export type SoCashStatusFilter = 'unremitted' | 'remitted' | 'all';

export function isSoCashRemitted(r: PaymentRequest): boolean {
  return r.remittanceStatus === 'remitted';
}

function requestDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date used for range filters: remittedAt for remitted, else approved/created. */
export function soCashRecordDate(r: PaymentRequest): Date | null {
  if (isSoCashRemitted(r)) {
    return requestDate(r.remittedAt) || requestDate(r.reviewedAt) || requestDate(r.createdAt);
  }
  return requestDate(r.reviewedAt) || requestDate(r.createdAt);
}

export function inSoCashDateRange(
  r: PaymentRequest,
  fromMs?: number,
  toMs?: number
): boolean {
  if (fromMs == null && toMs == null) return true;
  const d = soCashRecordDate(r);
  if (!d) return false;
  const t = d.getTime();
  if (fromMs != null && t < fromMs) return false;
  if (toMs != null && t > toMs) return false;
  return true;
}

async function loadApprovedSoCashRequests(): Promise<PaymentRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'payment_requests'),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc')
    )
  );
  return snap.docs
    .map((d) => parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>))
    .filter((r) => {
      if (!isSoCollectedCashRequest(r)) return false;
      if (r.remittanceStatus === 'n_a') return false;
      return Number(r.approvedAmount ?? r.requestedAmount ?? 0) > 0.01;
    });
}

/** Approved SO-collected cash not yet remitted to office. */
export async function getUnremittedSoCashRequests(): Promise<PaymentRequest[]> {
  const all = await loadApprovedSoCashRequests();
  return all.filter((r) => !isSoCashRemitted(r));
}

export async function getSoCashRequests(opts?: {
  status?: SoCashStatusFilter;
  fromMs?: number;
  toMs?: number;
}): Promise<PaymentRequest[]> {
  const status = opts?.status ?? 'unremitted';
  const all = await loadApprovedSoCashRequests();
  return all.filter((r) => {
    if (status === 'unremitted' && isSoCashRemitted(r)) return false;
    if (status === 'remitted' && !isSoCashRemitted(r)) return false;
    return inSoCashDateRange(r, opts?.fromMs, opts?.toMs);
  });
}

export function groupUnremittedBySo(requests: PaymentRequest[]): SoCashBagRow[] {
  const map = new Map<string, SoCashBagRow>();
  for (const r of requests) {
    const collector = resolveSoCashCollector(r);
    if (!collector) continue;
    const amount = roundMoney2(Number(r.approvedAmount ?? r.requestedAmount ?? 0));
    const remitted = isSoCashRemitted(r);
    const existing = map.get(collector.id);
    if (existing) {
      if (remitted) existing.remittedAmount = roundMoney2(existing.remittedAmount + amount);
      else existing.unremittedAmount = roundMoney2(existing.unremittedAmount + amount);
      existing.requestCount += 1;
      existing.requests.push(r);
      if (!existing.salesOfficerName && collector.name) {
        existing.salesOfficerName = collector.name;
      }
    } else {
      map.set(collector.id, {
        salesOfficerId: collector.id,
        salesOfficerName: collector.name,
        unremittedAmount: remitted ? 0 : amount,
        remittedAmount: remitted ? amount : 0,
        requestCount: 1,
        requests: [r],
      });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.unremittedAmount + b.remittedAmount - (a.unremittedAmount + a.remittedAmount)
  );
}

/**
 * Stamp collectedBy / remittanceStatus on approved SO cash requests that lack them,
 * and mirror onto order payment rows when found.
 */
export async function backfillSoCashCollectionFields(): Promise<{
  requestsUpdated: number;
  paymentsUpdated: number;
}> {
  const snap = await getDocs(
    query(collection(db, 'payment_requests'), where('status', '==', 'approved'))
  );
  const candidates = snap.docs
    .map((d) => parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>))
    .filter(isSoCollectedCashRequest);

  let requestsUpdated = 0;
  let paymentsUpdated = 0;

  for (const r of candidates) {
    const collector = resolveSoCashCollector(r);
    if (!collector) continue;

    const needsRequestStamp =
      !r.collectedBySoId ||
      r.remittanceStatus == null ||
      (r.remittanceStatus !== 'remitted' && r.remittanceStatus !== 'unremitted');

    if (needsRequestStamp) {
      await updateDoc(doc(db, 'payment_requests', r.id), {
        collectedBySoId: collector.id,
        collectedBySoName: collector.name,
        remittanceStatus: r.remittanceStatus === 'remitted' ? 'remitted' : 'unremitted',
        updatedAt: serverTimestamp(),
      });
      requestsUpdated += 1;
    }

    try {
      const paySnap = await getDocs(collection(db, 'orders', r.orderId, 'payments'));
      for (const p of paySnap.docs) {
        const data = p.data() as Record<string, unknown>;
        if (data.paymentRequestId !== r.id) continue;
        if (data.settlementKind && data.settlementKind !== 'cash') continue;
        if (data.salesOfficerId && data.remittanceStatus) continue;
        await updateDoc(doc(db, 'orders', r.orderId, 'payments', p.id), {
          collectedBy: collector.name,
          salesOfficerId: collector.id,
          remittanceStatus:
            data.remittanceStatus === 'remitted'
              ? 'remitted'
              : r.remittanceStatus === 'remitted'
                ? 'remitted'
                : 'unremitted',
        });
        paymentsUpdated += 1;
      }
    } catch {
      // Order payments may be missing; request stamp is enough for the SO Cash page.
    }
  }

  return { requestsUpdated, paymentsUpdated };
}

/** Mark all current unremitted SO cash for one officer as remitted. */
export async function remittanceSoCash(payload: {
  salesOfficerId: string;
  salesOfficerName?: string;
  remittedBy: string;
  notes?: string;
  requestIds?: string[];
}): Promise<SoCashRemittance> {
  const all = await getUnremittedSoCashRequests();
  const forSo = all.filter((r) => {
    const c = resolveSoCashCollector(r);
    return c?.id === payload.salesOfficerId;
  });
  const selected = payload.requestIds?.length
    ? forSo.filter((r) => payload.requestIds!.includes(r.id))
    : forSo;

  if (selected.length === 0) {
    throw new Error('No unremitted cash found for this sales officer.');
  }

  const amount = roundMoney2(
    selected.reduce(
      (sum, r) => sum + Number(r.approvedAmount ?? r.requestedAmount ?? 0),
      0
    )
  );
  const paymentRequestIds = selected.map((r) => r.id);
  const remittanceRef = await addDoc(collection(db, 'so_cash_remittances'), {
    salesOfficerId: payload.salesOfficerId,
    salesOfficerName: payload.salesOfficerName || selected[0]?.collectedBySoName || null,
    amount,
    paymentRequestIds,
    remittedBy: payload.remittedBy,
    notes: payload.notes || null,
    remittedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  // Firestore batches max 500 ops; chunk if needed.
  const chunkSize = 400;
  for (let i = 0; i < selected.length; i += chunkSize) {
    const chunk = selected.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const r of chunk) {
      batch.update(doc(db, 'payment_requests', r.id), {
        remittanceStatus: 'remitted',
        remittanceId: remittanceRef.id,
        remittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  for (const r of selected) {
    try {
      const paySnap = await getDocs(collection(db, 'orders', r.orderId, 'payments'));
      for (const p of paySnap.docs) {
        const data = p.data() as Record<string, unknown>;
        if (data.paymentRequestId !== r.id) continue;
        if (data.settlementKind && data.settlementKind !== 'cash') continue;
        await updateDoc(doc(db, 'orders', r.orderId, 'payments', p.id), {
          remittanceStatus: 'remitted',
          remittanceId: remittanceRef.id,
        });
      }
    } catch {
      // best-effort mirror
    }
  }

  return {
    id: remittanceRef.id,
    salesOfficerId: payload.salesOfficerId,
    salesOfficerName: payload.salesOfficerName,
    amount,
    paymentRequestIds,
    remittedBy: payload.remittedBy,
    notes: payload.notes,
    remittedAt: new Date(),
    createdAt: new Date(),
  };
}

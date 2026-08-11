import {
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  getCountFromServer,
  addDoc,
  Timestamp,
} from './firebase';
import type { Order, PaymentRequest, PaymentRequestStatus } from '../types';

const PAYMENT_REQUEST_STATUSES: PaymentRequestStatus[] = [
  'pending_admin_review',
  'approved',
  'rejected',
  'cancelled',
];

function toReadableQueryError(error: unknown, fallback: string): Error {
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message;
  if (code === 'permission-denied') {
    return new Error(
      'Permission denied while reading payment requests. Deploy latest Firestore rules and verify your panel role has access.'
    );
  }
  if (code === 'failed-precondition') {
    return new Error(
      'Firestore index is required for payment requests query. Create/deploy indexes from the Firebase console and retry.'
    );
  }
  return new Error(message || fallback);
}

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
  } as PaymentRequest;
}

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function maxCreditUsableFromReturnDoc(data: Record<string, unknown>): number {
  const totalRefund = Number(data.creditNoteAmount ?? data.totalRefundAmount ?? 0);
  return Math.max(0, totalRefund);
}

async function incrementReturnCreditUsed(
  collectionName: 'order_return_requests' | 'expiry_return_requests',
  id: string,
  apply: number
): Promise<number> {
  if (!id || apply <= 0.01) return 0;
  const ref = doc(db, collectionName, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;
  const data = snap.data() as Record<string, unknown>;
  const currentUsed = Math.max(0, Number(data.creditAmountUsed ?? 0));
  const maxAllowed = maxCreditUsableFromReturnDoc(data);
  const usable = roundMoney2(Math.min(apply, Math.max(0, maxAllowed - currentUsed)));
  if (usable <= 0.01) return 0;
  await updateDoc(ref, {
    creditAmountUsed: roundMoney2(currentUsed + usable),
    updatedAt: serverTimestamp(),
  });
  return usable;
}

async function incrementCreditNoteUsed(id: string, apply: number): Promise<number> {
  if (!id || apply <= 0.01) return 0;
  const ref = doc(db, 'credit_notes', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;
  const data = snap.data() as Record<string, unknown>;
  if (data.ledgerOnly === true) return 0;
  const creditTotal = Math.max(0, Number(data.amount ?? data.totalAmount ?? 0));
  const currentUsed = Math.max(0, Number(data.amountUsed ?? 0));
  const usable = roundMoney2(Math.min(apply, Math.max(0, creditTotal - currentUsed)));
  if (usable <= 0.01) return 0;
  const nextUsed = roundMoney2(currentUsed + usable);
  const remaining = roundMoney2(creditTotal - nextUsed);
  await updateDoc(ref, {
    amountUsed: nextUsed,
    status: remaining <= 0.01 ? 'fully_used' : 'available',
    updatedAt: serverTimestamp(),
  });
  return usable;
}

async function mirrorCreditToLinkedDocs(
  data: Record<string, unknown>,
  apply: number,
  from: 'credit_note' | 'return'
): Promise<void> {
  if (apply <= 0.01) return;
  const creditNoteId = String(data.creditNoteId || '').trim();
  const orderReturnId = String(
    data.orderReturnRequestId || (from === 'return' ? '' : data.returnRequestId) || ''
  ).trim();
  const expiryReturnId = String(data.expiryReturnRequestId || '').trim();
  const typeRaw = String(data.type || data.returnType || '').trim();

  if (from === 'credit_note') {
    if (orderReturnId || typeRaw === 'order_return') {
      await incrementReturnCreditUsed(
        'order_return_requests',
        orderReturnId || String(data.returnRequestId || ''),
        apply
      );
    }
    if (expiryReturnId || typeRaw === 'expiry_return') {
      await incrementReturnCreditUsed(
        'expiry_return_requests',
        expiryReturnId || String(data.returnRequestId || ''),
        apply
      );
    }
    return;
  }

  if (creditNoteId) {
    await incrementCreditNoteUsed(creditNoteId, apply);
  }
}

/**
 * Wallet ids may be a dedicated `credit_notes` doc even when `source` is a
 * return type (web app used to send returnType on dedicated notes). Always
 * resolve by which document actually exists.
 */
async function applyOneCreditApplication(
  app: NonNullable<PaymentRequest['creditApplications']>[number]
): Promise<number> {
  const requestApply = roundMoney2(Math.max(0, Number(app.requestedApplyAmount ?? 0)));
  if (requestApply <= 0.01) return 0;
  const id = String(app.creditNoteId || '').trim();
  if (!id) return 0;

  const creditRef = doc(db, 'credit_notes', id);
  const creditSnap = await getDoc(creditRef);
  if (creditSnap.exists()) {
    const applied = await incrementCreditNoteUsed(id, requestApply);
    if (applied > 0.01) {
      await mirrorCreditToLinkedDocs(creditSnap.data() as Record<string, unknown>, applied, 'credit_note');
    }
    return applied;
  }

  const preferExpiry = app.source === 'expiry_return';
  const firstCol = preferExpiry ? 'expiry_return_requests' : 'order_return_requests';
  const secondCol = preferExpiry ? 'order_return_requests' : 'expiry_return_requests';

  for (const col of [firstCol, secondCol] as const) {
    const ref = doc(db, col, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const applied = await incrementReturnCreditUsed(col, id, requestApply);
    if (applied > 0.01) {
      await mirrorCreditToLinkedDocs(snap.data() as Record<string, unknown>, applied, 'return');
    }
    return applied;
  }

  return 0;
}

async function applyCreditApplications(
  apps: PaymentRequest['creditApplications']
): Promise<number> {
  if (!apps?.length) return 0;
  let appliedTotal = 0;
  for (const app of apps) {
    appliedTotal += await applyOneCreditApplication(app);
  }
  return roundMoney2(appliedTotal);
}

async function existingSettlementKinds(
  orderId: string,
  requestId: string
): Promise<Set<string>> {
  const snap = await getDocs(collection(db, 'orders', orderId, 'payments'));
  const kinds = new Set<string>();
  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (String(data.paymentRequestId || '') !== requestId) return;
    const kind = String(data.settlementKind || 'cash');
    kinds.add(kind);
  });
  return kinds;
}

export const getAllPaymentRequests = async (): Promise<PaymentRequest[]> => {
  const col = collection(db, 'payment_requests');
  try {
    const q = query(col, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    console.warn('payment_requests orderBy query failed, sorting in memory:', error);
    try {
      const snap = await getDocs(col);
      const list = snap.docs.map((d) =>
        parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>)
      );
      return list.sort((a, b) => {
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bt - at;
      });
    } catch (fallbackError) {
      throw toReadableQueryError(
        fallbackError,
        'Unable to read payment requests.'
      );
    }
  }
};

/**
 * Payment requests for a single status (newest first). Used by the Payment
 * Requests page so each tab doesn't download the entire collection.
 */
export const getPaymentRequestsByStatus = async (
  status: PaymentRequestStatus
): Promise<PaymentRequest[]> => {
  const col = collection(db, 'payment_requests');
  try {
    const q = query(
      col,
      where('status', '==', status),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    console.warn('getPaymentRequestsByStatus query failed, filtering in memory:', error);
    const list = await getAllPaymentRequests();
    return list.filter((r) => r.status === status);
  }
};

/** Per-status counts for tab labels without loading every payment request doc. */
export const getPaymentRequestStatusCounts = async (): Promise<
  Record<PaymentRequestStatus, number>
> => {
  const col = collection(db, 'payment_requests');
  const counts = PAYMENT_REQUEST_STATUSES.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as Record<PaymentRequestStatus, number>);
  try {
    const snaps = await Promise.all(
      PAYMENT_REQUEST_STATUSES.map((s) =>
        getCountFromServer(query(col, where('status', '==', s)))
      )
    );
    PAYMENT_REQUEST_STATUSES.forEach((s, i) => {
      counts[s] = snaps[i].data().count ?? 0;
    });
    return counts;
  } catch (error) {
    console.warn('getPaymentRequestStatusCounts failed, falling back to full scan:', error);
    const list = await getAllPaymentRequests();
    for (const r of list) {
      if (counts[r.status] != null) counts[r.status]++;
    }
    return counts;
  }
};

export const getPendingPaymentRequests = async (): Promise<PaymentRequest[]> => {
  const col = collection(db, 'payment_requests');
  try {
    const q = query(
      col,
      where('status', '==', 'pending_admin_review'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => parsePaymentRequestDoc(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    console.warn('pending payment request query failed, filtering in memory:', error);
    try {
      const list = await getAllPaymentRequests();
      return list.filter((r) => r.status === 'pending_admin_review');
    } catch (fallbackError) {
      throw toReadableQueryError(
        fallbackError,
        'Unable to read pending payment requests.'
      );
    }
  }
};

export const approvePaymentRequest = async (
  requestId: string,
  payload: {
    reviewedBy: string;
    approvedAmount?: number;
    reviewNote?: string;
    /** Re-apply wallet/cash onto an already-approved request that did not settle the order. */
    resettle?: boolean;
  }
): Promise<{ orderId: string; paymentStatus: 'Paid' | 'Partial' | 'Unpaid' }> => {
  const reqRef = doc(db, 'payment_requests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Payment request not found');
  }

  const request = parsePaymentRequestDoc(
    reqSnap.id,
    reqSnap.data() as Record<string, unknown>
  );
  const canResettle = payload.resettle === true && request.status === 'approved';
  if (request.status !== 'pending_admin_review' && !canResettle) {
    throw new Error('Only pending payment requests can be approved');
  }

  const orderRef = doc(db, 'orders', request.orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) {
    throw new Error('Order not found for this payment request');
  }

  const order = { id: orderSnap.id, ...(orderSnap.data() as Record<string, unknown>) } as Order;
  const totalAmount = Number(order.totalAmount ?? request.orderTotalSnapshot ?? 0);
  const currentPaid = Number(order.paidAmount ?? 0);
  const remainingDue = roundMoney2(Math.max(0, totalAmount - currentPaid));
  const requestedAmount = Number(request.requestedAmount ?? 0);
  const approvedAmount = roundMoney2(
    Math.max(0, Number(payload.approvedAmount ?? request.approvedAmount ?? requestedAmount))
  );
  const postedKinds = await existingSettlementKinds(request.orderId, requestId);
  const cashToPost = postedKinds.has('cash')
    ? 0
    : roundMoney2(Math.min(approvedAmount, remainingDue));
  const creditWanted = roundMoney2(Math.max(0, remainingDue - cashToPost));
  const approvedCreditRaw =
    creditWanted > 0.01 ? await applyCreditApplications(request.creditApplications) : 0;
  const approvedCredit = roundMoney2(Math.min(approvedCreditRaw, creditWanted));
  const settlementTotal = roundMoney2(cashToPost + approvedCredit);
  if (settlementTotal <= 0.01 && remainingDue > 0.01 && !canResettle) {
    throw new Error(
      'Nothing to apply: enter a cash/online amount or ensure wallet credit notes still have balance.'
    );
  }

  const nextPaid = roundMoney2(Math.min(totalAmount, currentPaid + settlementTotal));
  const nextDue = roundMoney2(Math.max(0, totalAmount - nextPaid));
  const nextStatus: 'Paid' | 'Partial' | 'Unpaid' =
    nextDue <= 0.01 ? 'Paid' : nextPaid > 0.01 ? 'Partial' : 'Unpaid';
  const paymentMethod = request.method === 'online' ? 'Online' : 'Cash';

  if (cashToPost > 0.01) {
    await addDoc(collection(db, 'orders', request.orderId, 'payments'), {
      orderId: request.orderId,
      amount: cashToPost,
      paymentDate: Timestamp.now(),
      paymentMethod,
      transactionId: request.transactionId || request.cashReference || null,
      notes: `Approved payment request ${requestId}`,
      paymentRequestId: requestId,
      settlementKind: 'cash',
      createdAt: serverTimestamp(),
    });
  }

  if (approvedCredit > 0.01 && !postedKinds.has('wallet')) {
    await addDoc(collection(db, 'orders', request.orderId, 'payments'), {
      orderId: request.orderId,
      amount: approvedCredit,
      paymentDate: Timestamp.now(),
      paymentMethod,
      notes: `Wallet / credit notes — payment request ${requestId}`,
      paymentRequestId: requestId,
      settlementKind: 'wallet',
      createdAt: serverTimestamp(),
    });
  }

  const previousCredit = Number(order.creditApplied ?? 0);
  await updateDoc(orderRef, {
    paidAmount: nextPaid,
    dueAmount: nextDue,
    paymentStatus: nextStatus,
    paymentMethod,
    transactionId: request.transactionId || null,
    paymentReviewStatus: nextStatus === 'Paid' ? 'none' : 'approved',
    paymentRejectedReason: null,
    lastPaymentRequestId: requestId,
    ...(approvedCredit > 0.01
      ? {
          creditApplied: roundMoney2(previousCredit + approvedCredit),
          creditAppliedAt: 'payment',
        }
      : {}),
  });

  const priorApprovedCredit = Number(request.approvedCreditAmount ?? 0);
  await updateDoc(reqRef, {
    status: 'approved',
    reviewedBy: payload.reviewedBy,
    reviewedAt: serverTimestamp(),
    reviewNote: payload.reviewNote || null,
    approvedAmount,
    approvedCreditAmount: roundMoney2(priorApprovedCredit + approvedCredit),
    updatedAt: serverTimestamp(),
  });

  return { orderId: request.orderId, paymentStatus: nextStatus };
};

export const rejectPaymentRequest = async (
  requestId: string,
  payload: { reviewedBy: string; rejectionReason: string }
): Promise<void> => {
  const reqRef = doc(db, 'payment_requests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Payment request not found');
  }

  const request = parsePaymentRequestDoc(
    reqSnap.id,
    reqSnap.data() as Record<string, unknown>
  );
  if (request.status !== 'pending_admin_review') {
    throw new Error('Only pending payment requests can be rejected');
  }

  const orderRef = doc(db, 'orders', request.orderId);
  await updateDoc(orderRef, {
    paymentReviewStatus: 'rejected',
    paymentRejectedReason: payload.rejectionReason,
  });

  await updateDoc(reqRef, {
    status: 'rejected',
    reviewedBy: payload.reviewedBy,
    reviewedAt: serverTimestamp(),
    rejectionReason: payload.rejectionReason,
    updatedAt: serverTimestamp(),
  });
};

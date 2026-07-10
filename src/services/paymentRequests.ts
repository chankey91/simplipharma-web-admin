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

function maxCreditUsableFromReturnDoc(data: Record<string, unknown>): number {
  const totalRefund = Number(data.creditNoteAmount ?? data.totalRefundAmount ?? 0);
  return Math.max(0, totalRefund);
}

async function applyCreditApplications(
  apps: PaymentRequest['creditApplications']
): Promise<number> {
  if (!apps?.length) return 0;
  let appliedTotal = 0;

  for (const app of apps) {
    const requestApply = Math.max(0, Number(app.requestedApplyAmount ?? 0));
    if (requestApply <= 0.01) continue;

    const source = app.source;
    if (source === 'order_return') {
      const ref = doc(db, 'order_return_requests', app.creditNoteId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data() as Record<string, unknown>;
      const currentUsed = Math.max(0, Number(data.creditAmountUsed ?? 0));
      const maxAllowed = maxCreditUsableFromReturnDoc(data);
      const apply = Math.min(requestApply, Math.max(0, maxAllowed - currentUsed));
      if (apply <= 0.01) continue;
      await updateDoc(ref, {
        creditAmountUsed: Math.round((currentUsed + apply) * 100) / 100,
        updatedAt: serverTimestamp(),
      });
      appliedTotal += apply;
      continue;
    }

    if (source === 'expiry_return') {
      const ref = doc(db, 'expiry_return_requests', app.creditNoteId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data() as Record<string, unknown>;
      const currentUsed = Math.max(0, Number(data.creditAmountUsed ?? 0));
      const maxAllowed = maxCreditUsableFromReturnDoc(data);
      const apply = Math.min(requestApply, Math.max(0, maxAllowed - currentUsed));
      if (apply <= 0.01) continue;
      await updateDoc(ref, {
        creditAmountUsed: Math.round((currentUsed + apply) * 100) / 100,
        updatedAt: serverTimestamp(),
      });
      appliedTotal += apply;
      continue;
    }

    const creditRef = doc(db, 'credit_notes', app.creditNoteId);
    const creditSnap = await getDoc(creditRef);
    if (!creditSnap.exists()) continue;
    const data = creditSnap.data() as Record<string, unknown>;
    const creditTotal = Math.max(
      0,
      Number(data.amount ?? data.totalAmount ?? 0)
    );
    const currentUsed = Math.max(0, Number(data.amountUsed ?? 0));
    const apply = Math.min(requestApply, Math.max(0, creditTotal - currentUsed));
    if (apply <= 0.01) continue;
    await updateDoc(creditRef, {
      amountUsed: Math.round((currentUsed + apply) * 100) / 100,
      updatedAt: serverTimestamp(),
    });
    appliedTotal += apply;
  }

  return Math.round(appliedTotal * 100) / 100;
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
  payload: { reviewedBy: string; approvedAmount?: number; reviewNote?: string }
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
  if (request.status !== 'pending_admin_review') {
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
  const requestedAmount = Number(request.requestedAmount ?? 0);
  const approvedAmount = Math.max(0, Number(payload.approvedAmount ?? requestedAmount));
  const approvedCredit = await applyCreditApplications(request.creditApplications);
  const settlementTotal = approvedAmount + approvedCredit;
  const nextPaid = Math.min(totalAmount, currentPaid + settlementTotal);
  const nextDue = Math.max(0, totalAmount - nextPaid);
  const nextStatus: 'Paid' | 'Partial' | 'Unpaid' =
    nextDue <= 0.01 ? 'Paid' : nextPaid > 0.01 ? 'Partial' : 'Unpaid';
  const paymentMethod = request.method === 'online' ? 'Online' : 'Cash';

  // Cash/online portion only — credit applications are tracked separately on credit notes
  if (approvedAmount > 0.01) {
    await addDoc(collection(db, 'orders', request.orderId, 'payments'), {
      orderId: request.orderId,
      amount: approvedAmount,
      paymentDate: Timestamp.now(),
      paymentMethod,
      transactionId: request.transactionId || request.cashReference || null,
      notes: `Approved payment request ${requestId}`,
      paymentRequestId: requestId,
      createdAt: serverTimestamp(),
    });
  }

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
          creditApplied: approvedCredit,
          creditAppliedAt: 'payment',
        }
      : {}),
  });

  await updateDoc(reqRef, {
    status: 'approved',
    reviewedBy: payload.reviewedBy,
    reviewedAt: serverTimestamp(),
    reviewNote: payload.reviewNote || null,
    approvedAmount,
    approvedCreditAmount: approvedCredit,
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

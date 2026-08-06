import { getDocs, collection, db } from './firebase';
import { getOrderById } from './orders';
import {
  getOrderReturnRequests,
  type OrderReturnRequest,
  type OrderReturnStatus,
} from './orderReturns';
import {
  recalculateOrderReturnItemPricing,
  roundMoney2,
} from '../utils/orderReturnPricing';

export type OrderReturnPriceFixCandidate = {
  id: string;
  status: OrderReturnStatus;
  retailerName: string;
  orderId: string;
  invoiceNumber: string;
  creditNoteNumber?: string;
  storedTotal: number;
  correctTotal: number;
  delta: number;
  /** Safe to auto-fix (not paid / rejected). */
  canAutoFix: boolean;
  reason?: string;
};

export type OrderReturnPriceFixScanSummary = {
  scanned: number;
  mismatched: number;
  canAutoFix: number;
  needsReview: number;
  skippedNoOrder: number;
  candidates: OrderReturnPriceFixCandidate[];
};

const AUTO_FIX_STATUSES: OrderReturnStatus[] = ['pending_so', 'pending_admin', 'approved'];

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dry-run: compare stored return totals to formula
 * price × (1 − disc%) × (1 + GST%) from the original order.
 * Does not write anything.
 */
export async function scanOrderReturnsNeedingPriceFix(options?: {
  /** Limit how many return docs to load (default: all). */
  status?: OrderReturnStatus | 'all';
}): Promise<OrderReturnPriceFixScanSummary> {
  const status = options?.status ?? 'all';
  const requests = await getOrderReturnRequests(status === 'all' ? 'all' : status);

  const summary: OrderReturnPriceFixScanSummary = {
    scanned: requests.length,
    mismatched: 0,
    canAutoFix: 0,
    needsReview: 0,
    skippedNoOrder: 0,
    candidates: [],
  };

  const orderCache = new Map<string, Awaited<ReturnType<typeof getOrderById>>>();

  for (const req of requests) {
    if (req.status === 'rejected') continue;

    const orderId = String(req.orderId || '').trim();
    if (!orderId) {
      summary.skippedNoOrder += 1;
      continue;
    }

    let order = orderCache.get(orderId);
    if (order === undefined) {
      order = await getOrderById(orderId);
      orderCache.set(orderId, order);
    }
    if (!order) {
      summary.skippedNoOrder += 1;
      continue;
    }

    const priced = recalculateOrderReturnItemPricing(req.items || [], order);
    const storedTotal = roundMoney2(toNum(req.totalRefundAmount));
    const correctTotal = priced.totalRefundAmount;
    const delta = roundMoney2(correctTotal - storedTotal);

    if (Math.abs(delta) < 0.02) continue;

    const canAutoFix = AUTO_FIX_STATUSES.includes(req.status);
    const candidate: OrderReturnPriceFixCandidate = {
      id: req.id,
      status: req.status,
      retailerName: req.retailerName || req.retailerEmail || req.retailerId || '—',
      orderId,
      invoiceNumber: req.invoiceNumber || '—',
      creditNoteNumber: req.creditNoteNumber,
      storedTotal,
      correctTotal,
      delta,
      canAutoFix,
      reason: canAutoFix
        ? undefined
        : req.status === 'paid'
          ? 'Already paid — review before changing'
          : 'Status not eligible for auto-fix',
    };

    summary.candidates.push(candidate);
    summary.mismatched += 1;
    if (canAutoFix) summary.canAutoFix += 1;
    else summary.needsReview += 1;
  }

  summary.candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return summary;
}

/** Load all return request ids quickly (for progress UI if needed later). */
export async function countOrderReturnRequests(): Promise<number> {
  const snap = await getDocs(collection(db, 'order_return_requests'));
  return snap.size;
}

export function formatOrderReturnPriceFixRows(
  candidates: OrderReturnPriceFixCandidate[]
): string {
  const lines = [
    'ReturnId\tStatus\tCanAutoFix\tRetailer\tOrderId\tInvoice\tCreditNote\tStored\tCorrect\tDelta',
    ...candidates.map((c) =>
      [
        c.id,
        c.status,
        c.canAutoFix ? 'yes' : 'no',
        c.retailerName,
        c.orderId,
        c.invoiceNumber,
        c.creditNoteNumber || '—',
        c.storedTotal.toFixed(2),
        c.correctTotal.toFixed(2),
        c.delta.toFixed(2),
      ].join('\t')
    ),
  ];
  return lines.join('\n');
}

export type { OrderReturnRequest };

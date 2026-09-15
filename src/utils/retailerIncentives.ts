import { Order, PurchaseInvoice, User } from '../types';
import { coerceToDate, getTodayDateStringIST } from './dateTime';
import {
  buildPurchaseBatchDiscountLookup,
  resolvePurchaseDiscountPct,
  type PurchaseBatchDiscountLookup,
} from './orderFulfillmentDiscount';
import { orderLineAmountAfterDiscount } from './orderLineInvoiceEconomics';
import { formatOrderInvoiceLabel } from './orderDisplay';

export const RETAILER_INCENTIVE_MONTH_THRESHOLD = 70_000;
export const RETAILER_INCENTIVE_PURCHASE_DISC_MIN = 5;
export const RETAILER_INCENTIVE_RATE = 1.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Current calendar month as yyyy-MM in IST. */
export function currentIstYearMonth(date: Date = new Date()): string {
  return getTodayDateStringIST(date).slice(0, 7);
}

/** Inclusive IST month bounds for `yyyy-MM`. */
export function istYearMonthBounds(yearMonth: string): {
  startMs: number;
  endMsExclusive: number;
  fromDate: string;
  toDate: string;
} {
  const m = yearMonth.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    return istYearMonthBounds(currentIstYearMonth());
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const fromDate = `${m[1]}-${m[2]}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextStart = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  const startMs = new Date(`${fromDate}T00:00:00+05:30`).getTime();
  const endMsExclusive = new Date(`${nextStart}T00:00:00+05:30`).getTime();
  const toDate = getTodayDateStringIST(new Date(endMsExclusive - 1));
  return { startMs, endMsExclusive, fromDate, toDate };
}

function toTime(v: unknown): number {
  const d = coerceToDate(v);
  return d ? d.getTime() : 0;
}

/** Vendor purchase (PI) discount % for an order line — max across batch allocations. */
export function resolveOrderLinePurchaseDiscountPct(
  item: Order['medicines'][number],
  purchaseLookup?: PurchaseBatchDiscountLookup
): number {
  const allocs = item.batchAllocations || [];
  if (allocs.length > 0) {
    let max = 0;
    for (const a of allocs) {
      max = Math.max(
        max,
        resolvePurchaseDiscountPct({
          medicineId: item.medicineId,
          batchNumber: a.batchNumber,
          purchaseLookup,
        })
      );
    }
    return max;
  }
  return resolvePurchaseDiscountPct({
    medicineId: item.medicineId,
    batchNumber: item.batchNumber,
    purchaseLookup,
  });
}

export type RetailerIncentiveLine = {
  orderId: string;
  invoiceLabel: string;
  orderDate: Date;
  medicineId: string;
  medicineName: string;
  batchNumber?: string;
  purchaseDiscountPct: number;
  lineAmount: number;
  incentiveAmount: number;
};

export type RetailerIncentiveSummary = {
  retailerId: string;
  store: User | null;
  displayName: string;
  storeCode: string;
  monthPurchaseTotal: number;
  eligibleAmount: number;
  incentiveAmount: number;
  qualified: boolean;
  orderCount: number;
  eligibleLineCount: number;
  lines: RetailerIncentiveLine[];
};

/**
 * Monthly retailer incentive:
 * - Delivered orders in month by orderDate
 * - Qualifies if month purchase (ex-GST after retailer disc) > ₹70,000
 * - Eligible lines: vendor purchase discount (PI) ≥ 5%
 * - Incentive = 1.5% of eligible line amounts
 */
export function buildRetailerIncentiveSummaries(
  orders: Order[],
  stores: User[],
  purchaseInvoices: PurchaseInvoice[],
  options?: {
    yearMonth?: string;
    threshold?: number;
    purchaseDiscMin?: number;
    incentiveRate?: number;
  }
): RetailerIncentiveSummary[] {
  const yearMonth = options?.yearMonth || currentIstYearMonth();
  const threshold = options?.threshold ?? RETAILER_INCENTIVE_MONTH_THRESHOLD;
  const purchaseDiscMin = options?.purchaseDiscMin ?? RETAILER_INCENTIVE_PURCHASE_DISC_MIN;
  const incentiveRate = options?.incentiveRate ?? RETAILER_INCENTIVE_RATE;
  const { startMs, endMsExclusive } = istYearMonthBounds(yearMonth);

  const sortedInvoices = [...purchaseInvoices].sort(
    (a, b) => toTime(b.invoiceDate) - toTime(a.invoiceDate)
  );
  const purchaseLookup = buildPurchaseBatchDiscountLookup(sortedInvoices);
  const storeById = new Map(stores.map((s) => [s.id, s]));

  type Acc = {
    retailerId: string;
    monthPurchaseTotal: number;
    orderIds: Set<string>;
    lines: RetailerIncentiveLine[];
  };
  const byRetailer = new Map<string, Acc>();

  for (const order of orders) {
    if (order.status !== 'Delivered') continue;
    const od = coerceToDate(order.orderDate);
    if (!od) continue;
    const t = od.getTime();
    if (t < startMs || t >= endMsExclusive) continue;

    const retailerId = (order.retailerId || '').trim();
    if (!retailerId) continue;

    let acc = byRetailer.get(retailerId);
    if (!acc) {
      acc = {
        retailerId,
        monthPurchaseTotal: 0,
        orderIds: new Set(),
        lines: [],
      };
      byRetailer.set(retailerId, acc);
    }
    acc.orderIds.add(order.id);

    for (const item of order.medicines || []) {
      const lineAmount = round2(
        orderLineAmountAfterDiscount(item, undefined, order.taxPercentage, purchaseLookup, {
          lockPersistedDiscount: true,
        })
      );
      if (lineAmount <= 0.01) continue;

      acc.monthPurchaseTotal = round2(acc.monthPurchaseTotal + lineAmount);

      const purchaseDiscountPct = resolveOrderLinePurchaseDiscountPct(item, purchaseLookup);
      if (purchaseDiscountPct < purchaseDiscMin) continue;

      const incentiveAmount = round2((lineAmount * incentiveRate) / 100);
      const allocBatch =
        item.batchAllocations?.[0]?.batchNumber || item.batchNumber || undefined;

      acc.lines.push({
        orderId: order.id,
        invoiceLabel: formatOrderInvoiceLabel(order),
        orderDate: od,
        medicineId: item.medicineId || '',
        medicineName: item.name || '—',
        batchNumber: allocBatch,
        purchaseDiscountPct,
        lineAmount,
        incentiveAmount,
      });
    }
  }

  const summaries: RetailerIncentiveSummary[] = [];
  for (const acc of byRetailer.values()) {
    const store = storeById.get(acc.retailerId) ?? null;
    const eligibleAmount = round2(acc.lines.reduce((s, l) => s + l.lineAmount, 0));
    const qualified = acc.monthPurchaseTotal > threshold;
    const incentiveAmount = qualified
      ? round2(acc.lines.reduce((s, l) => s + l.incentiveAmount, 0))
      : 0;

    summaries.push({
      retailerId: acc.retailerId,
      store,
      displayName:
        store?.shopName || store?.displayName || acc.retailerId,
      storeCode: store?.storeCode || '—',
      monthPurchaseTotal: acc.monthPurchaseTotal,
      eligibleAmount: qualified ? eligibleAmount : 0,
      incentiveAmount,
      qualified,
      orderCount: acc.orderIds.size,
      eligibleLineCount: qualified ? acc.lines.length : 0,
      lines: qualified
        ? [...acc.lines].sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime())
        : [],
    });
  }

  return summaries.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return b.incentiveAmount - a.incentiveAmount || b.monthPurchaseTotal - a.monthPurchaseTotal;
  });
}

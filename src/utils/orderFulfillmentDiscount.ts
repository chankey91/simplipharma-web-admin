import { PurchaseInvoice, PurchaseInvoiceItem } from '../types';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

/** Purchase invoice line "Discount %" field. */
export function purchaseInvoiceItemDiscountPct(
  item: Pick<PurchaseInvoiceItem, 'discountPercentage'>
): number {
  return toNum(item.discountPercentage);
}

/** Per-unit discount amount (₹): purchasePrice × discount% / 100 (fallback when PI line missing). */
export function purchaseInvoiceItemDiscountPricePerUnit(
  item: Pick<PurchaseInvoiceItem, 'purchasePrice' | 'discountPercentage'>
): number {
  const price = toNum(item.purchasePrice);
  const pct = toNum(item.discountPercentage);
  if (price <= 0 || pct <= 0) return 0;
  return (price * pct) / 100;
}

export function batchPurchaseDiscountPricePerUnit(batch?: {
  purchasePrice?: number;
  discountPercentage?: number;
}): number {
  if (!batch) return 0;
  return purchaseInvoiceItemDiscountPricePerUnit({
    purchasePrice: toNum(batch.purchasePrice),
    discountPercentage: batch.discountPercentage,
  });
}

/**
 * Order fulfillment default from purchase invoice:
 * - Discount % on PI > 5 → 1.5%
 * - Discount price (₹/unit) on PI > 5 → 1.5% (when % not set)
 * - Otherwise → 0%
 */
export function defaultOrderDiscountPctFromPurchase(
  purchaseDiscountPct: number,
  purchaseDiscountPricePerUnit: number
): number {
  if (purchaseDiscountPct > 5 || purchaseDiscountPricePerUnit > 5) {
    return 1.5;
  }
  return 0;
}

export type PurchaseBatchDiscountLookup = Map<
  string,
  { discountPct: number; discountPricePerUnit: number }
>;

export function purchaseBatchLookupKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}|${batchNumber}`;
}

/** Newest purchase invoice wins per medicine+batch (invoices should be newest-first). */
export function buildPurchaseBatchDiscountLookup(
  invoices: PurchaseInvoice[]
): PurchaseBatchDiscountLookup {
  const map = new Map<string, { discountPct: number; discountPricePerUnit: number }>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      if (!item.medicineId || !item.batchNumber) continue;
      const key = purchaseBatchLookupKey(item.medicineId, item.batchNumber);
      if (!map.has(key)) {
        map.set(key, {
          discountPct: purchaseInvoiceItemDiscountPct(item),
          discountPricePerUnit: purchaseInvoiceItemDiscountPricePerUnit(item),
        });
      }
    }
  }
  return map;
}

export function lookupPurchaseDiscount(
  lookup: PurchaseBatchDiscountLookup | undefined,
  medicineId: string | undefined,
  batchNumber: string | undefined
): { discountPct: number; discountPricePerUnit: number } | undefined {
  if (!lookup || !medicineId || !batchNumber) return undefined;
  const key = purchaseBatchLookupKey(medicineId, batchNumber);
  return lookup.get(key);
}

const parseDiscountPct = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n;
};

/**
 * Resolve order-line trade discount %.
 * When `discountManuallySet` is true, keep saved item/allocation values (including 0).
 */
export function resolveOrderLineDiscountPct(params: {
  itemDiscount?: unknown;
  allocationDiscount?: unknown;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
  batch?: { purchasePrice?: number; discountPercentage?: number };
  discountManuallySet?: boolean;
}): number {
  if (params.discountManuallySet) {
    const manual =
      parseDiscountPct(params.itemDiscount) ?? parseDiscountPct(params.allocationDiscount);
    if (manual !== undefined) return manual;
  }

  const pi = lookupPurchaseDiscount(
    params.purchaseLookup,
    params.medicineId,
    params.batchNumber
  );
  if (pi) {
    return defaultOrderDiscountPctFromPurchase(pi.discountPct, pi.discountPricePerUnit);
  }

  const batchDiscountPrice = batchPurchaseDiscountPricePerUnit(params.batch);
  return defaultOrderDiscountPctFromPurchase(0, batchDiscountPrice);
}

/** Apply default disc % to a fulfillment line (all allocations + line level). */
export function applyDefaultDiscountToFulfillmentLine(
  item: {
    medicineId?: string;
    batchNumber?: string;
    discountPercentage?: number;
    discountManuallySet?: boolean;
    batchAllocations?: Array<{ batchNumber: string; discountPercentage?: number }>;
  },
  purchaseLookup: PurchaseBatchDiscountLookup | undefined,
  getBatch?: (batchNumber: string) => { purchasePrice?: number; discountPercentage?: number } | undefined
): typeof item {
  if (item.discountManuallySet) return item;

  const applyForBatch = (batchNumber: string | undefined, batch?: { purchasePrice?: number; discountPercentage?: number }) => {
    if (!batchNumber) return undefined;
    const b = batch ?? getBatch?.(batchNumber);
    return resolveOrderLineDiscountPct({
      medicineId: item.medicineId,
      batchNumber,
      purchaseLookup,
      batch: b,
      discountManuallySet: false,
    });
  };

  if (item.batchAllocations && item.batchAllocations.length > 0) {
    const batchAllocations = item.batchAllocations.map((a) => ({
      ...a,
      discountPercentage: applyForBatch(a.batchNumber, getBatch?.(a.batchNumber)),
    }));
    return {
      ...item,
      batchAllocations,
      discountPercentage: batchAllocations[0]?.discountPercentage,
    };
  }

  if (item.batchNumber) {
    const pct = applyForBatch(item.batchNumber, getBatch?.(item.batchNumber));
    return { ...item, discountPercentage: pct };
  }

  return item;
}

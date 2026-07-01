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
 * @deprecated Legacy PI → order trade discount mapping (1.5% / 0%). Prefer {@link resolveSellDiscountPct}.
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

export type SellDiscountBatch = {
  mrp?: number;
  purchasePrice?: number;
  discountPercentage?: number;
  batchNumber?: string;
};

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
 * Standard margin off MRP from landed purchase cost (matches Medicine Details column).
 * Falls back to 20% when MRP or purchase price is missing.
 */
export function calculateStandardDiscountPct(
  mrp: number,
  purchasePrice: number,
  gstRate: number
): number {
  if (mrp > 0 && purchasePrice > 0) {
    const priceWithGst = purchasePrice * (1 + gstRate / 100);
    const pct = (1 - priceWithGst / mrp) * 100;
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct;
  }
  return 20;
}

/**
 * Sell-side discount % for unit price: batch `discountPercentage` when set, else PI line discount,
 * else standard discount from MRP + purchase price.
 */
export function resolveSellDiscountPct(params: {
  batch?: SellDiscountBatch;
  gstRate?: number;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
}): number {
  const batchPct = parseDiscountPct(params.batch?.discountPercentage);
  if (batchPct !== undefined && batchPct > 0) return batchPct;

  const pi = lookupPurchaseDiscount(
    params.purchaseLookup,
    params.medicineId,
    params.batchNumber ?? params.batch?.batchNumber
  );
  if (pi && pi.discountPct > 0) return pi.discountPct;

  const mrp = toNum(params.batch?.mrp);
  const purchasePrice = toNum(params.batch?.purchasePrice);
  const gstRate = params.gstRate !== undefined ? toNum(params.gstRate) : 5;
  return calculateStandardDiscountPct(mrp, purchasePrice, gstRate);
}

/** Ex-GST unit price from MRP after applying sell discount %. */
export function unitPriceFromMrp(mrp: number, gstRate: number, discountPct: number): number {
  if (mrp <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, discountPct));
  return (mrp * (1 - clamped / 100)) / (1 + gstRate / 100);
}

/** Unit sell price from batch MRP using batch → standard discount resolution. */
export function unitPriceFromBatch(
  batch: SellDiscountBatch,
  gstRate: number,
  ctx?: { medicineId?: string; purchaseLookup?: PurchaseBatchDiscountLookup }
): number {
  const mrp = toNum(batch.mrp);
  if (mrp <= 0) return toNum(batch.purchasePrice);
  const disc = resolveSellDiscountPct({
    batch,
    gstRate,
    medicineId: ctx?.medicineId,
    batchNumber: batch.batchNumber,
    purchaseLookup: ctx?.purchaseLookup,
  });
  return unitPriceFromMrp(mrp, gstRate, disc);
}

/**
 * Extra trade discount % applied on subtotal (manual override only).
 * Batch / standard sell discount is embedded in the unit price.
 */
export function resolveOrderLineDiscountPct(params: {
  itemDiscount?: unknown;
  allocationDiscount?: unknown;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
  batch?: SellDiscountBatch;
  gstRate?: number;
  discountManuallySet?: boolean;
}): number {
  if (params.discountManuallySet) {
    const manual =
      parseDiscountPct(params.itemDiscount) ?? parseDiscountPct(params.allocationDiscount);
    if (manual !== undefined) return manual;
  }
  return 0;
}

/** Discount % shown on invoice / fulfillment UI (manual override or sell discount). */
export function resolveOrderLineDisplayDiscountPct(params: {
  itemDiscount?: unknown;
  allocationDiscount?: unknown;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
  batch?: SellDiscountBatch;
  gstRate?: number;
  discountManuallySet?: boolean;
}): number {
  if (params.discountManuallySet) {
    const manual =
      parseDiscountPct(params.itemDiscount) ?? parseDiscountPct(params.allocationDiscount);
    if (manual !== undefined) return manual;
  }
  return resolveSellDiscountPct({
    batch: params.batch,
    gstRate: params.gstRate,
    medicineId: params.medicineId,
    batchNumber: params.batchNumber ?? params.batch?.batchNumber,
    purchaseLookup: params.purchaseLookup,
  });
}

/** Apply sell disc % to a fulfillment line (all allocations + line level). */
export function applyDefaultDiscountToFulfillmentLine(
  item: {
    medicineId?: string;
    batchNumber?: string;
    discountPercentage?: number;
    discountManuallySet?: boolean;
    batchAllocations?: Array<{ batchNumber: string; discountPercentage?: number }>;
  },
  purchaseLookup: PurchaseBatchDiscountLookup | undefined,
  getBatch?: (
    batchNumber: string
  ) => { mrp?: number; purchasePrice?: number; discountPercentage?: number } | undefined,
  gstRate?: number
): typeof item {
  if (item.discountManuallySet) return item;

  const applyForBatch = (
    batchNumber: string | undefined,
    batch?: { mrp?: number; purchasePrice?: number; discountPercentage?: number }
  ) => {
    if (!batchNumber) return undefined;
    const b = batch ?? getBatch?.(batchNumber);
    return resolveSellDiscountPct({
      medicineId: item.medicineId,
      batchNumber,
      purchaseLookup,
      batch: b ? { ...b, batchNumber } : { batchNumber },
      gstRate,
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

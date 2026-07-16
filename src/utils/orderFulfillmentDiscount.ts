import { PurchaseInvoice, PurchaseInvoiceItem } from '../types';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

/** Purchase invoice line "Discount %" field (trade/cash discount on purchase — not retail margin). */
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
 * Order invoice DISC column: 0% or 2% extra trade discount from purchase line discount %.
 * Standard margin stays in the unit rate only.
 */
export function orderTradeDiscountFromPurchasePct(purchaseDiscountPct: number): number {
  return purchaseDiscountPct > 4 ? 2 : 0;
}

/** @deprecated use {@link orderTradeDiscountFromPurchasePct} */
export function orderTradeDiscountFromStandardPct(standardDiscountPct: number): number {
  return orderTradeDiscountFromPurchasePct(standardDiscountPct);
}

/**
 * @deprecated Legacy PI trade-discount mapping. Prefer {@link orderTradeDiscountFromPurchasePct}.
 */
export function defaultOrderDiscountPctFromPurchase(
  purchaseDiscountPct: number,
  purchaseDiscountPricePerUnit: number
): number {
  if (purchaseDiscountPct > 4 || purchaseDiscountPricePerUnit > 4) {
    return 2;
  }
  return 0;
}

/** PI / batch purchase-side "Discount %" field (not standard margin). */
export function resolvePurchaseDiscountPct(params: {
  batch?: SellDiscountBatch;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
}): number {
  const batchNumber = params.batchNumber ?? params.batch?.batchNumber;
  if (
    params.batch &&
    params.batch.discountPercentage !== undefined &&
    params.batch.discountPercentage !== null
  ) {
    return toNum(params.batch.discountPercentage);
  }
  const pi = lookupPurchaseBatchMeta(params.purchaseLookup, params.medicineId, batchNumber);
  if (pi) return pi.discountPct;
  return 0;
}

/** DISC column value (0% or 2%) from purchase discount field. */
export function resolveOrderLineTradeDiscountPct(params: {
  batch?: SellDiscountBatch;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
}): number {
  return orderTradeDiscountFromPurchasePct(
    resolvePurchaseDiscountPct(params)
  );
}

export type PurchaseBatchLineMeta = {
  /** PI trade discount % (purchase-side). */
  discountPct: number;
  discountPricePerUnit: number;
  /** PI standard margin % off MRP (retail sell discount when batch has no trade %). */
  standardDiscountPct: number;
  mrp: number;
  purchasePrice: number;
  gstRate: number;
};

export type PurchaseBatchDiscountLookup = Map<string, PurchaseBatchLineMeta>;

export type SellDiscountBatch = {
  mrp?: number;
  purchasePrice?: number;
  discountPercentage?: number;
  standardDiscount?: number;
  batchNumber?: string;
};

export function purchaseBatchLookupKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}|${batchNumber}`;
}

export function normalizeBatchNumber(value: unknown): string {
  return String(value ?? '').trim();
}

/** Case-insensitive batch match (inventory trims batch numbers on load). */
export function findStockBatch(
  medicine: { stockBatches?: Array<{ batchNumber?: string }> } | undefined,
  batchNumber: string | undefined
): { batchNumber?: string; mrp?: number; purchasePrice?: number; discountPercentage?: number; standardDiscount?: number } | undefined {
  if (!medicine?.stockBatches?.length || !batchNumber) return undefined;
  const key = normalizeBatchNumber(batchNumber).toLowerCase();
  return medicine.stockBatches.find(
    (b) => normalizeBatchNumber(b.batchNumber).toLowerCase() === key
  ) as
    | {
        batchNumber?: string;
        mrp?: number;
        purchasePrice?: number;
        discountPercentage?: number;
        standardDiscount?: number;
      }
    | undefined;
}

export function toSellDiscountBatch(
  stockBatch:
    | {
        batchNumber?: string;
        mrp?: number;
        purchasePrice?: number;
        discountPercentage?: number;
        standardDiscount?: number;
      }
    | undefined,
  batchNumber: string,
  fallbackMrp?: number,
  gstRate = 5
): SellDiscountBatch {
  const mrp = toNum(stockBatch?.mrp) || toNum(fallbackMrp);
  const purchasePrice = stockBatch?.purchasePrice;
  const standardDiscount =
    stockBatch?.standardDiscount ??
    (stockBatch
      ? standardDiscountFromStockBatch(stockBatch, gstRate)
      : undefined);
  return {
    batchNumber: normalizeBatchNumber(stockBatch?.batchNumber ?? batchNumber),
    mrp: mrp > 0 ? mrp : undefined,
    purchasePrice,
    discountPercentage: stockBatch?.discountPercentage,
    standardDiscount,
  };
}

/** Newest purchase invoice wins per medicine+batch (invoices should be newest-first). */
export function buildPurchaseBatchDiscountLookup(
  invoices: PurchaseInvoice[]
): PurchaseBatchDiscountLookup {
  const map = new Map<string, PurchaseBatchLineMeta>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      if (!item.medicineId || !item.batchNumber) continue;
      const key = purchaseBatchLookupKey(item.medicineId, normalizeBatchNumber(item.batchNumber));
      if (!map.has(key)) {
        const stdRaw = toNum(item.standardDiscount);
        map.set(key, {
          discountPct: purchaseInvoiceItemDiscountPct(item),
          discountPricePerUnit: purchaseInvoiceItemDiscountPricePerUnit(item),
          standardDiscountPct: stdRaw > 0 ? stdRaw : 0,
          mrp: toNum(item.mrp),
          purchasePrice: toNum(item.purchasePrice),
          gstRate: toNum(item.gstRate) || 5,
        });
      }
    }
  }
  return map;
}

export function lookupPurchaseBatchMeta(
  lookup: PurchaseBatchDiscountLookup | undefined,
  medicineId: string | undefined,
  batchNumber: string | undefined
): PurchaseBatchLineMeta | undefined {
  if (!lookup || !medicineId || !batchNumber) return undefined;
  return lookup.get(purchaseBatchLookupKey(medicineId, normalizeBatchNumber(batchNumber)));
}

/** @deprecated use lookupPurchaseBatchMeta */
export function lookupPurchaseDiscount(
  lookup: PurchaseBatchDiscountLookup | undefined,
  medicineId: string | undefined,
  batchNumber: string | undefined
): { discountPct: number; discountPricePerUnit: number } | undefined {
  const meta = lookupPurchaseBatchMeta(lookup, medicineId, batchNumber);
  if (!meta) return undefined;
  return { discountPct: meta.discountPct, discountPricePerUnit: meta.discountPricePerUnit };
}

const parseDiscountPct = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n;
};

/** Order invoice Disc % — trade discount only (0% or 2%). */
export function isOrderTradeDiscountPct(n: number): boolean {
  return n === 0 || Math.abs(n - 2) < 0.001;
}

/**
 * Saved order-line Disc % (any 0–100 value the user/fulfillment stored).
 * Prefer this over re-deriving from PI so custom discounts stay stable on the order details screen.
 */
function readPersistedOrderDiscount(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = parseDiscountPct(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

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

function mergeBatchPricingContext(
  batch: SellDiscountBatch | undefined,
  pi: PurchaseBatchLineMeta | undefined,
  gstRate: number
): { mrp: number; purchasePrice: number; gstRate: number } {
  const mrp = toNum(batch?.mrp) || toNum(pi?.mrp);
  const purchasePrice = toNum(batch?.purchasePrice) || toNum(pi?.purchasePrice);
  const resolvedGst =
    gstRate > 0 ? gstRate : toNum(pi?.gstRate) > 0 ? toNum(pi?.gstRate) : 5;
  return { mrp, purchasePrice, gstRate: resolvedGst };
}

/**
 * Sell-side discount % for unit price (retail margin off MRP):
 * 1. Batch `standardDiscount` (stored on inventory from purchase invoice)
 * 2. PI `standardDiscount` when set on purchase invoice line
 * 3. Calculated standard margin from batch/PI MRP + landed purchase price (+ GST)
 * 4. Default 20%
 *
 * Inventory `discountPercentage` is PI trade/cash discount — not used for sell pricing.
 */
export function resolveSellDiscountPct(params: {
  batch?: SellDiscountBatch;
  gstRate?: number;
  medicineId?: string;
  batchNumber?: string;
  purchaseLookup?: PurchaseBatchDiscountLookup;
}): number {
  const batchNumber = params.batchNumber ?? params.batch?.batchNumber;
  const pi = lookupPurchaseBatchMeta(params.purchaseLookup, params.medicineId, batchNumber);
  const inputGst = params.gstRate !== undefined ? toNum(params.gstRate) : 0;
  const { mrp, purchasePrice, gstRate } = mergeBatchPricingContext(
    params.batch,
    pi,
    inputGst
  );

  const batchStd = parseDiscountPct(params.batch?.standardDiscount);
  if (batchStd !== undefined && batchStd > 0) return batchStd;

  if (pi && pi.standardDiscountPct > 0) return pi.standardDiscountPct;

  return calculateStandardDiscountPct(mrp, purchasePrice, gstRate);
}

/** Standard discount % to store on inventory batch from a purchase invoice line. */
export function resolveStandardDiscountForPurchaseItem(item: {
  standardDiscount?: unknown;
  mrp?: unknown;
  purchasePrice?: unknown;
  gstRate?: unknown;
}): number {
  const explicit = parseDiscountPct(item.standardDiscount);
  if (explicit !== undefined && explicit > 0) return explicit;
  const mrp = toNum(item.mrp);
  const pp = toNum(item.purchasePrice);
  const gst = toNum(item.gstRate) || 5;
  return calculateStandardDiscountPct(mrp, pp, gst);
}

export function attachStandardDiscountToBatchData(
  batchData: { mrp?: number; purchasePrice?: number; standardDiscount?: number },
  item: { standardDiscount?: unknown; mrp?: unknown; purchasePrice?: unknown; gstRate?: unknown }
): void {
  batchData.standardDiscount = resolveStandardDiscountForPurchaseItem({
    standardDiscount: item.standardDiscount,
    mrp: batchData.mrp ?? item.mrp,
    purchasePrice: batchData.purchasePrice ?? item.purchasePrice,
    gstRate: item.gstRate,
  });
}

/** Read stored batch standard discount, or derive from batch MRP + purchase price. */
export function standardDiscountFromStockBatch(
  batch: { standardDiscount?: unknown; mrp?: unknown; purchasePrice?: unknown },
  gstRate = 5
): number | undefined {
  const explicit = parseDiscountPct(batch.standardDiscount);
  if (explicit !== undefined && explicit > 0) return explicit;
  const mrp = toNum(batch.mrp);
  const pp = toNum(batch.purchasePrice);
  if (mrp > 0 && pp > 0) return calculateStandardDiscountPct(mrp, pp, gstRate);
  return undefined;
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
 * Extra trade discount % on line subtotal (applied after unit price).
 * Standard margin off MRP is in the rate — not returned here unless manually overridden.
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

  // Trust whatever Disc % is already saved on the order line (custom or default).
  // Re-deriving from PI here caused Disc % / totals to flicker between custom and default.
  const persisted = readPersistedOrderDiscount(
    params.allocationDiscount,
    params.itemDiscount
  );
  if (persisted !== undefined) return persisted;

  const purchaseDisc = resolvePurchaseDiscountPct({
    batch: params.batch,
    medicineId: params.medicineId,
    batchNumber: params.batchNumber ?? params.batch?.batchNumber,
    purchaseLookup: params.purchaseLookup,
  });
  return orderTradeDiscountFromPurchasePct(purchaseDisc);
}

/** DISC column / invoice display — 0% or 2% trade discount, never standard margin %. */
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
  return resolveOrderLineDiscountPct(params);
}

/** Apply sell disc % to a fulfillment line (all allocations + line level). */
export function applyDefaultDiscountToFulfillmentLine(
  item: {
    medicineId?: string;
    batchNumber?: string;
    mrp?: number;
    gstRate?: number;
    discountPercentage?: number;
    discountManuallySet?: boolean;
    batchAllocations?: Array<{
      batchNumber: string;
      discountPercentage?: number;
      mrp?: number;
      gstRate?: number;
      purchasePrice?: number;
    }>;
  },
  purchaseLookup: PurchaseBatchDiscountLookup | undefined,
  getBatch?: (
    batchNumber: string
  ) =>
    | { mrp?: number; purchasePrice?: number; discountPercentage?: number; standardDiscount?: number }
    | undefined,
  defaultGstRate?: number
): typeof item {
  if (item.discountManuallySet) return item;

  const lineGst = toNum(item.gstRate) || defaultGstRate || 5;

  const applyForBatch = (
    batchNumber: string | undefined,
    alloc?: { mrp?: number; gstRate?: number; purchasePrice?: number },
    stockBatch?: {
      mrp?: number;
      purchasePrice?: number;
      discountPercentage?: number;
      standardDiscount?: number;
    }
  ) => {
    if (!batchNumber) return undefined;
    const b = stockBatch ?? getBatch?.(batchNumber);
    const gstRate = toNum(alloc?.gstRate) || lineGst;
    const sellBatch = toSellDiscountBatch(
      b,
      batchNumber,
      toNum(alloc?.mrp) || toNum(item.mrp),
      gstRate
    );
    return resolveOrderLineTradeDiscountPct({
      medicineId: item.medicineId,
      batchNumber,
      purchaseLookup,
      batch: sellBatch,
    });
  };

  if (item.batchAllocations && item.batchAllocations.length > 0) {
    const batchAllocations = item.batchAllocations.map((a) => ({
      ...a,
      discountPercentage: applyForBatch(
        a.batchNumber,
        a,
        getBatch?.(a.batchNumber)
      ),
    }));
    return {
      ...item,
      batchAllocations,
      discountPercentage: batchAllocations[0]?.discountPercentage,
    };
  }

  if (item.batchNumber) {
    const pct = applyForBatch(item.batchNumber, { mrp: item.mrp, gstRate: lineGst });
    return { ...item, discountPercentage: pct };
  }

  return item;
}

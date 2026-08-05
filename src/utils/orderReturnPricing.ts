/**
 * Order-return unit refund pricing.
 *
 * Order line `price` is GST-inclusive (as billed). Correct order:
 * 1. Remove GST → taxable unit
 * 2. Apply trade discount %
 * 3. Apply GST on the discounted taxable
 */

function toNum(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney2(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * Tax-inclusive unit refund: strip GST → minus discount → apply GST.
 * Avoids adding GST on top of an already-inclusive unit price.
 */
export function unitRefundPriceFromOrderLine(params: {
  /** GST-inclusive unit rate from the order line. */
  price: number;
  discountPercentage?: number | null;
  gstRate?: number | null;
  orderTaxPercentage?: number | null;
}): number {
  const priceInclGst = toNum(params.price);
  if (priceInclGst <= 0) return 0;

  const disc = Math.min(100, Math.max(0, toNum(params.discountPercentage)));
  let gst = toNum(params.gstRate);
  if (gst <= 0) gst = toNum(params.orderTaxPercentage);
  if (gst <= 0) gst = 5;

  const gstFactor = 1 + gst / 100;
  const priceExGst = priceInclGst / gstFactor;
  const afterDiscount = priceExGst * (1 - disc / 100);
  return roundMoney2(afterDiscount * gstFactor);
}

export function unitRefundPriceForOrderMedicine(
  med: {
    price?: number;
    discountPercentage?: number;
    gstRate?: number;
  },
  alloc?: {
    purchasePrice?: number;
    discountPercentage?: number;
    gstRate?: number;
  } | null,
  orderTaxPercentage?: number | null
): number {
  const base =
    toNum(med.price) > 0
      ? toNum(med.price)
      : toNum(alloc?.purchasePrice) > 0
        ? toNum(alloc?.purchasePrice)
        : 0;
  const discount =
    alloc?.discountPercentage !== undefined && alloc?.discountPercentage !== null
      ? toNum(alloc.discountPercentage)
      : toNum(med.discountPercentage);
  const gst =
    toNum(alloc?.gstRate) > 0
      ? toNum(alloc?.gstRate)
      : toNum(med.gstRate) > 0
        ? toNum(med.gstRate)
        : undefined;

  // Allocation purchasePrice is typically ex-GST — discount then add GST (no strip).
  const priceLooksExGst = toNum(med.price) <= 0 && toNum(alloc?.purchasePrice) > 0;
  if (priceLooksExGst) {
    const disc = Math.min(100, Math.max(0, discount));
    let g = toNum(gst);
    if (g <= 0) g = toNum(orderTaxPercentage);
    if (g <= 0) g = 5;
    const afterDiscount = base * (1 - disc / 100);
    return roundMoney2(afterDiscount * (1 + g / 100));
  }

  return unitRefundPriceFromOrderLine({
    price: base,
    discountPercentage: discount,
    gstRate: gst,
    orderTaxPercentage,
  });
}

function normalizeBatch(batch: string | undefined | null): string {
  return String(batch || '')
    .trim()
    .toLowerCase();
}

/**
 * Recalculate return line unitRefundPrice / refundAmount from the original order.
 */
export function recalculateOrderReturnItemPricing<
  T extends {
    medicineId: string;
    batchNumber?: string;
    quantity: number;
    unitRefundPrice: number;
    refundAmount: number;
  },
>(
  items: T[],
  order:
    | {
        taxPercentage?: number;
        medicines?: Array<{
          medicineId?: string;
          price?: number;
          discountPercentage?: number;
          gstRate?: number;
          batchNumber?: string;
          batchAllocations?: Array<{
            batchNumber?: string;
            purchasePrice?: number;
            discountPercentage?: number;
            gstRate?: number;
          }>;
        }>;
      }
    | null
    | undefined
): { items: T[]; totalRefundAmount: number } {
  if (!order?.medicines?.length) {
    const total = items.reduce(
      (s, it) => s + (toNum(it.refundAmount) || toNum(it.unitRefundPrice) * toNum(it.quantity)),
      0
    );
    return { items, totalRefundAmount: roundMoney2(total) };
  }

  const next = items.map((item) => {
    const medicineId = String(item.medicineId || '').trim();
    const batchKey = normalizeBatch(item.batchNumber);
    const med = order.medicines!.find((m) => String(m.medicineId || '').trim() === medicineId);
    if (!med) return item;

    const allocs = med.batchAllocations || [];
    const alloc =
      batchKey && allocs.length > 0
        ? allocs.find((a) => normalizeBatch(a.batchNumber) === batchKey)
        : undefined;

    const unit = unitRefundPriceForOrderMedicine(med, alloc ?? null, order.taxPercentage);
    if (unit <= 0) return item;

    const qty = toNum(item.quantity);
    return {
      ...item,
      unitRefundPrice: unit,
      refundAmount: roundMoney2(qty * unit),
    };
  });

  const totalRefundAmount = roundMoney2(
    next.reduce((s, it) => s + toNum(it.refundAmount), 0)
  );
  return { items: next, totalRefundAmount };
}

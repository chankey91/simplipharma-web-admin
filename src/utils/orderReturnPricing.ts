/**
 * Order-return unit refund — same economics as the sales invoice:
 *
 * Order line `price` / allocation `purchasePrice` is the **ex-GST** unit rate.
 * 1. Apply trade discount % on that rate
 * 2. Then apply GST %
 *
 * unitRefund (incl. GST) = price × (1 − disc%/100) × (1 + gst%/100)
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

export function unitRefundPriceFromOrderLine(params: {
  /** Ex-GST unit rate (order line price / allocation sell rate). */
  price: number;
  discountPercentage?: number | null;
  gstRate?: number | null;
  orderTaxPercentage?: number | null;
}): number {
  const priceExGst = toNum(params.price);
  if (priceExGst <= 0) return 0;

  const disc = Math.min(100, Math.max(0, toNum(params.discountPercentage)));
  let gst = toNum(params.gstRate);
  if (gst <= 0) gst = toNum(params.orderTaxPercentage);
  if (gst <= 0) gst = 5;

  const afterDiscount = priceExGst * (1 - disc / 100);
  return roundMoney2(afterDiscount * (1 + gst / 100));
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
    toNum(alloc?.purchasePrice) > 0
      ? toNum(alloc?.purchasePrice)
      : toNum(med.price);

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

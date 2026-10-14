export function purchaseLineUnitPrice(item: { purchasePrice?: number }): number {
  const n = Number(item.purchasePrice);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Line economics from stored PTR — do not recompute from MRP. */
export function purchaseLineAmounts(item: {
  purchasePrice?: number;
  quantity?: number;
  discountPercentage?: number;
  gstRate?: number;
}): {
  unitPrice: number;
  base: number;
  discount: number;
  afterDisc: number;
  tax: number;
  total: number;
} {
  const unitPrice = purchaseLineUnitPrice(item);
  const qty = Number(item.quantity) || 0;
  const discPct = Number(item.discountPercentage) || 0;
  const gstRate = Number(item.gstRate) || 0;
  const base = unitPrice * qty;
  const discount = (base * discPct) / 100;
  const afterDisc = base - discount;
  const tax = (afterDisc * gstRate) / 100;
  return { unitPrice, base, discount, afterDisc, tax, total: afterDisc + tax };
}

export function sumPurchaseInvoiceFromItems(
  items: Array<{
    purchasePrice?: number;
    quantity?: number;
    discountPercentage?: number;
    gstRate?: number;
  }>,
  extraDiscount: unknown = 0
) {
  let subTotal = 0;
  let lineDiscount = 0;
  let tax = 0;
  for (const item of items) {
    const line = purchaseLineAmounts(item);
    subTotal += line.base;
    lineDiscount += line.discount;
    tax += line.tax;
  }
  const payable = roundPurchaseInvoicePayable({
    subTotal,
    lineDiscount,
    tax,
    additionalDiscount: extraDiscount,
  });
  return {
    subTotal,
    totalDiscount: lineDiscount,
    totalTax: tax,
    ...payable,
  };
}

/** Whole-invoice extra discount in rupees (settles payable; not line Disc %). */
export function normalizeAdditionalDiscount(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Payable after line discounts + GST − additional (bill-level) discount, rounded to rupees.
 * Additional discount does not change GST taxable; it only reduces what we owe the vendor.
 */
export function roundPurchaseInvoicePayable(params: {
  subTotal: number;
  lineDiscount: number;
  tax: number;
  additionalDiscount?: unknown;
}): {
  additionalDiscount: number;
  calculatedTotal: number;
  roundoff: number;
  grandTotal: number;
} {
  const additionalDiscount = normalizeAdditionalDiscount(params.additionalDiscount);
  const beforeExtra = (params.subTotal || 0) - (params.lineDiscount || 0) + (params.tax || 0);
  const applied = Math.min(additionalDiscount, Math.max(0, beforeExtra));
  const calculatedTotal = beforeExtra - applied;
  const clamped = Math.max(0, calculatedTotal);
  const grandTotal = Math.round(clamped);
  const roundoff = grandTotal - clamped;
  return { additionalDiscount: applied, calculatedTotal: clamped, roundoff, grandTotal };
}

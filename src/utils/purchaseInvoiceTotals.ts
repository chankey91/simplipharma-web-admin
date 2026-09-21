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

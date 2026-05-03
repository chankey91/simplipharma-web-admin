/**
 * Retailer scheme label — same wording as Purchase Invoice Management line items
 * (see `PurchaseInvoiceDetails` / invoice items "Scheme" column).
 */
export function formatPurchaseSchemeLabel(
  schemePaidQty?: number | null,
  schemeFreeQty?: number | null
): string {
  const p = Number(schemePaidQty);
  const f = Number(schemeFreeQty);
  if (
    schemePaidQty != null &&
    schemeFreeQty != null &&
    !Number.isNaN(p) &&
    !Number.isNaN(f) &&
    p > 0 &&
    f > 0
  ) {
    return `${f} free / ${p}`;
  }
  return '—';
}

export type PurchaseItemStatus = 'pending' | 'found' | 'partial' | 'not_found';

/** Cap found qty at need; derive status from found vs need. Untouched lines stay pending. */
export function derivePurchaseItemStatus(
  totalQty: number,
  foundQty: number | null | undefined,
  touched: boolean
): PurchaseItemStatus {
  if (!touched || foundQty === null || foundQty === undefined) return 'pending';
  const need = Math.max(0, Math.floor(totalQty));
  const found = Math.max(0, Math.min(need, Math.floor(foundQty)));
  if (found <= 0) return 'not_found';
  if (found >= need) return 'found';
  return 'partial';
}

export function clampFoundQty(totalQty: number, foundQty: number): number {
  const need = Math.max(0, Math.floor(totalQty));
  return Math.max(0, Math.min(need, Math.floor(foundQty)));
}

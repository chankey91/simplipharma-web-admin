import { PurchaseInvoice, PurchaseInvoiceItem } from '../types';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Landed unit cost ex-GST from purchase invoice line (matches PI total before GST):
 * (purchasePrice × paidQty − line discount) ÷ (paidQty + freeQty)
 */
export function landedUnitCostExGstFromPurchaseLine(
  item: Pick<PurchaseInvoiceItem, 'purchasePrice' | 'quantity' | 'freeQuantity' | 'discountPercentage'>
): number | undefined {
  const paidQty = toNum(item.quantity);
  const freeQty = toNum(item.freeQuantity);
  const physicalQty = paidQty + freeQty;
  if (physicalQty <= 0) return undefined;

  const purchasePrice = toNum(item.purchasePrice);
  if (purchasePrice <= 0) return undefined;

  const discountPct = toNum(item.discountPercentage);
  const baseAmount = purchasePrice * paidQty;
  const discountAmount = (baseAmount * discountPct) / 100;
  const amountAfterDiscount = baseAmount - discountAmount;

  if (amountAfterDiscount <= 0) return undefined;
  return amountAfterDiscount / physicalQty;
}

export type PurchaseLandedCostLookup = Map<string, number>;

export function purchaseLandedCostLookupKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}|${batchNumber}`;
}

/** Newest invoice wins per medicine+batch. */
export function buildPurchaseLandedCostLookup(invoices: PurchaseInvoice[]): PurchaseLandedCostLookup {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      if (!item.medicineId || !item.batchNumber) continue;
      const key = purchaseLandedCostLookupKey(item.medicineId, item.batchNumber);
      if (map.has(key)) continue;
      const landed = landedUnitCostExGstFromPurchaseLine(item);
      if (landed !== undefined && landed > 0) {
        map.set(key, landed);
      }
    }
  }
  return map;
}

export function lookupLandedUnitCostExGst(
  lookup: PurchaseLandedCostLookup | undefined,
  medicineId: string | undefined,
  batchNumber: string | undefined
): number | undefined {
  if (!lookup || !medicineId || !batchNumber) return undefined;
  const key = purchaseLandedCostLookupKey(medicineId, batchNumber);
  return lookup.get(key);
}

/** Set `landedUnitCostExGst` on batch payload when stock is updated from a PI line. */
export function attachLandedCostToBatchData(
  batchData: Record<string, unknown>,
  item: Pick<PurchaseInvoiceItem, 'purchasePrice' | 'quantity' | 'freeQuantity' | 'discountPercentage'>
): void {
  const landed = landedUnitCostExGstFromPurchaseLine(item);
  if (landed !== undefined && landed > 0) {
    batchData.landedUnitCostExGst = landed;
  }
}

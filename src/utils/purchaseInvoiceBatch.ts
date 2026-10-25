import type { PurchaseInvoiceItem } from '../types';

/** Batch id used in inventory for a PI line (physical packs win over invoice). */
export function purchaseItemStockBatchNumber(
  item: Pick<PurchaseInvoiceItem, 'batchNumber' | 'receivedBatchNumber'>
): string {
  const received = String(item.receivedBatchNumber ?? '').trim();
  if (received) return received;
  return String(item.batchNumber ?? '').trim();
}

/** Medicine+batch keys for a purchase bill, used to match a sale back to that bill. */
export function purchaseInvoiceLineBatchKeys(
  items: Array<Pick<PurchaseInvoiceItem, 'medicineId' | 'batchNumber' | 'receivedBatchNumber'>> | undefined
): string[] {
  const keys: string[] = [];
  for (const item of items ?? []) {
    if (!item.medicineId) continue;
    const stockBatch = purchaseItemStockBatchNumber(item);
    if (stockBatch) keys.push(`${item.medicineId}|${stockBatch.toLowerCase()}`);
    const printed = String(item.batchNumber ?? '').trim();
    if (printed) keys.push(`${item.medicineId}|${printed.toLowerCase()}`);
  }
  return keys;
}

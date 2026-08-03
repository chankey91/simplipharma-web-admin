import type { PurchaseInvoiceItem } from '../types';

/** Batch id used in inventory for a PI line (physical packs win over invoice). */
export function purchaseItemStockBatchNumber(
  item: Pick<PurchaseInvoiceItem, 'batchNumber' | 'receivedBatchNumber'>
): string {
  const received = String(item.receivedBatchNumber ?? '').trim();
  if (received) return received;
  return String(item.batchNumber ?? '').trim();
}

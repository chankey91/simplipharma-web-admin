import { PurchaseInvoice } from '../types';
import type { LastRetailerScheme } from './retailerLastScheme';

function toDate(v: unknown): Date {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    if (d instanceof Date && !isNaN(d.getTime())) return d;
  }
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function toNum(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Same shape as retailer last-line history — reused by the hint UI. */
export type LastVendorPurchaseLine = LastRetailerScheme;

/**
 * Most recent purchase line per medicineId across all vendors
 * (excludes current invoice). Includes scheme, discount, rate, MRP, GST, qty, batch.
 */
export function buildLastPurchaseByMedicineId(
  invoices: PurchaseInvoice[],
  excludeInvoiceId?: string
): Map<string, LastVendorPurchaseLine> {
  const sorted = [...invoices].sort(
    (a, b) => toDate(b.invoiceDate).getTime() - toDate(a.invoiceDate).getTime()
  );
  const map = new Map<string, LastVendorPurchaseLine>();

  for (const inv of sorted) {
    if (!inv?.id) continue;
    if (excludeInvoiceId && inv.id === excludeInvoiceId) continue;

    for (const item of inv.items || []) {
      const medicineId = (item.medicineId || '').trim();
      if (!medicineId || map.has(medicineId)) continue;

      const schemePaid = toNum(item.schemePaidQty);
      const schemeFree = toNum(item.schemeFreeQty);
      const hasScheme = schemePaid > 0 && schemeFree > 0;
      const discount = toNum(item.discountPercentage);
      const price = toNum(item.purchasePrice ?? item.unitPrice);
      const mrp = toNum(item.mrp);
      const gstRate = toNum(item.gstRate);
      const quantity = toNum(item.quantity);
      const freeQuantity = toNum(item.freeQuantity);
      const batchNumber = (item.batchNumber || '').trim() || undefined;

      if (!hasScheme && !(price > 0) && !(mrp > 0) && !(quantity > 0)) continue;

      const vendorLabel = (inv.vendorName || '').trim();
      map.set(medicineId, {
        medicineId,
        medicineName: item.medicineName,
        schemePaidQty: hasScheme ? schemePaid : undefined,
        schemeFreeQty: hasScheme ? schemeFree : undefined,
        discountPercentage:
          item.discountPercentage !== undefined && item.discountPercentage !== null
            ? discount
            : undefined,
        price: price > 0 ? price : undefined,
        mrp: mrp > 0 ? mrp : undefined,
        gstRate: gstRate > 0 ? gstRate : undefined,
        quantity: quantity > 0 ? quantity : undefined,
        freeQuantity: freeQuantity > 0 ? freeQuantity : undefined,
        batchNumber,
        orderId: inv.id,
        orderDate: toDate(inv.invoiceDate),
        invoiceNumber: vendorLabel
          ? `${inv.invoiceNumber || inv.id} (${vendorLabel})`
          : inv.invoiceNumber,
      });
    }
  }

  return map;
}

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
 *
 * Pricing comes from the newest line. If that line has no scheme, scheme is backfilled
 * from the most recent older purchase that did carry a scheme.
 */
export function buildLastPurchaseByMedicineId(
  invoices: PurchaseInvoice[],
  excludeInvoiceId?: string
): Map<string, LastVendorPurchaseLine> {
  const sorted = [...invoices].sort(
    (a, b) => toDate(b.invoiceDate).getTime() - toDate(a.invoiceDate).getTime()
  );
  const map = new Map<string, LastVendorPurchaseLine>();
  /** Medicine ids still missing scheme after their newest line was recorded. */
  const needsScheme = new Set<string>();

  for (const inv of sorted) {
    if (!inv?.id) continue;
    if (excludeInvoiceId && inv.id === excludeInvoiceId) continue;

    for (const item of inv.items || []) {
      const medicineId = (item.medicineId || '').trim();
      if (!medicineId) continue;

      const schemePaid = toNum(item.schemePaidQty);
      const schemeFree = toNum(item.schemeFreeQty);
      const hasScheme = schemePaid > 0 && schemeFree > 0;

      const existing = map.get(medicineId);
      if (existing) {
        if (needsScheme.has(medicineId) && hasScheme) {
          existing.schemePaidQty = schemePaid;
          existing.schemeFreeQty = schemeFree;
          needsScheme.delete(medicineId);
        }
        continue;
      }

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
      if (!hasScheme) needsScheme.add(medicineId);
    }
  }

  return map;
}

export type MedicineNrNrxFlags = {
  nonReturnable: boolean;
  nrxDrug: boolean;
};

/** If this medicine was ever bought as NR and/or NRX, remember those flags. */
export function buildMedicineNrNrxFlags(
  invoices: PurchaseInvoice[]
): Map<string, MedicineNrNrxFlags> {
  const map = new Map<string, MedicineNrNrxFlags>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const medicineId = (item.medicineId || '').trim();
      if (!medicineId) continue;
      if (item.nonReturnable !== true && item.nrxDrug !== true) continue;
      const existing = map.get(medicineId) || { nonReturnable: false, nrxDrug: false };
      if (item.nonReturnable === true) existing.nonReturnable = true;
      if (item.nrxDrug === true) existing.nrxDrug = true;
      map.set(medicineId, existing);
    }
  }
  return map;
}

export function flagsFromStockBatches(
  batches: Array<{ nonReturnable?: boolean; nrxDrug?: boolean }> | undefined
): MedicineNrNrxFlags {
  let nonReturnable = false;
  let nrxDrug = false;
  for (const b of batches || []) {
    if (b.nonReturnable === true) nonReturnable = true;
    if (b.nrxDrug === true) nrxDrug = true;
    if (nonReturnable && nrxDrug) break;
  }
  return { nonReturnable, nrxDrug };
}

/** Prior NR/NRX for a medicine: previous bills, lines on this bill, or existing stock batches. */
export function resolveMedicineNrNrxFlags(opts: {
  medicineId: string;
  fromInvoices?: Map<string, MedicineNrNrxFlags>;
  invoiceItems?: Array<{ medicineId?: string; nonReturnable?: boolean; nrxDrug?: boolean }>;
  stockBatches?: Array<{ nonReturnable?: boolean; nrxDrug?: boolean }>;
}): MedicineNrNrxFlags {
  const medicineId = (opts.medicineId || '').trim();
  const hist = medicineId ? opts.fromInvoices?.get(medicineId) : undefined;
  const fromItems = (opts.invoiceItems || []).filter(
    (i) => (i.medicineId || '').trim() === medicineId
  );
  const fromBatches = flagsFromStockBatches(opts.stockBatches);
  return {
    nonReturnable:
      hist?.nonReturnable === true ||
      fromItems.some((i) => i.nonReturnable === true) ||
      fromBatches.nonReturnable,
    nrxDrug:
      hist?.nrxDrug === true ||
      fromItems.some((i) => i.nrxDrug === true) ||
      fromBatches.nrxDrug,
  };
}

export type BestDiscountVendorPurchase = {
  medicineId: string;
  vendorName: string;
  discountPercentage: number;
  invoiceNumber?: string;
  invoiceDate: Date;
};

/**
 * Per medicineId: purchase line with the highest discountPercentage across all vendors.
 * Ties broken by more recent invoice date.
 */
export function buildBestDiscountVendorByMedicineId(
  invoices: PurchaseInvoice[]
): Map<string, BestDiscountVendorPurchase> {
  const map = new Map<string, BestDiscountVendorPurchase>();

  for (const inv of invoices) {
    if (!inv?.id) continue;
    const vendorName = (inv.vendorName || '').trim() || 'Unknown vendor';
    const invoiceDate = toDate(inv.invoiceDate);
    const invoiceNumber = (inv.invoiceNumber || '').trim() || undefined;

    for (const item of inv.items || []) {
      const medicineId = (item.medicineId || '').trim();
      if (!medicineId) continue;
      if (item.discountPercentage === undefined || item.discountPercentage === null) continue;

      const discountPercentage = toNum(item.discountPercentage);
      if (!(discountPercentage > 0)) continue;

      const existing = map.get(medicineId);
      if (
        !existing ||
        discountPercentage > existing.discountPercentage ||
        (discountPercentage === existing.discountPercentage &&
          invoiceDate.getTime() > existing.invoiceDate.getTime())
      ) {
        map.set(medicineId, {
          medicineId,
          vendorName,
          discountPercentage,
          invoiceNumber,
          invoiceDate,
        });
      }
    }
  }

  return map;
}

/** Excel / UI label: "Vendor — 12%" */
export function formatBestDiscountVendorLabel(
  row: BestDiscountVendorPurchase | undefined | null
): string {
  if (!row) return '—';
  const pct = Number.isInteger(row.discountPercentage)
    ? String(row.discountPercentage)
    : row.discountPercentage.toFixed(2).replace(/\.?0+$/, '');
  return `${row.vendorName} — ${pct}%`;
}


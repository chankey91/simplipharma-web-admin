import type { Order, PurchaseInvoice, PurchaseInvoiceItem, User } from '../types';
import { purchaseItemStockBatchNumber } from './purchaseInvoiceBatch';

export type NrxPurchaseRow = {
  id: string;
  date: Date;
  vendorId: string;
  vendorName: string;
  invoiceId: string;
  invoiceNumber: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  receivedBatchNumber?: string;
  quantity: number;
  freeQuantity: number;
};

export type NrxSaleRow = {
  id: string;
  date: Date;
  retailerId: string;
  retailerName: string;
  orderId: string;
  invoiceNumber?: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  freeQuantity: number;
};

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return new Date(v as string | number);
}

function batchKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}||${String(batchNumber || '').trim().toLowerCase()}`;
}

/** Build medicine+batch keys known as NRX from PI lines and current stock. */
export function buildNrxBatchKeySet(
  invoices: PurchaseInvoice[],
  medicines?: Array<{ id: string; stockBatches?: Array<{ batchNumber: string; nrxDrug?: boolean }> }>
): Set<string> {
  const keys = new Set<string>();
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      if (item.nrxDrug !== true || !item.medicineId) continue;
      const stockBatch = purchaseItemStockBatchNumber(item);
      if (stockBatch) keys.add(batchKey(item.medicineId, stockBatch));
      if (item.batchNumber) keys.add(batchKey(item.medicineId, item.batchNumber));
    }
  }
  if (medicines) {
    for (const m of medicines) {
      for (const b of m.stockBatches || []) {
        if (b.nrxDrug === true && b.batchNumber) {
          keys.add(batchKey(m.id, b.batchNumber));
        }
      }
    }
  }
  return keys;
}

export function extractNrxPurchases(
  invoices: PurchaseInvoice[],
  fromMs: number,
  toMsExclusive: number
): NrxPurchaseRow[] {
  const rows: NrxPurchaseRow[] = [];
  for (const inv of invoices) {
    const d = toDate(inv.invoiceDate);
    const t = d.getTime();
    if (t < fromMs || t >= toMsExclusive) continue;
    (inv.items || []).forEach((item: PurchaseInvoiceItem, idx: number) => {
      if (item.nrxDrug !== true || !item.medicineId) return;
      const qty = Number(item.quantity) || 0;
      const free = Number(item.freeQuantity) || 0;
      rows.push({
        id: `${inv.id}:${idx}`,
        date: d,
        vendorId: inv.vendorId || '',
        vendorName: inv.vendorName || '—',
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber || inv.id,
        medicineId: item.medicineId,
        medicineName: item.medicineName || item.medicineId,
        batchNumber: item.batchNumber || '',
        receivedBatchNumber: item.receivedBatchNumber?.trim() || undefined,
        quantity: qty,
        freeQuantity: free,
      });
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  return rows;
}

const SOLD_STATUSES = new Set([
  'Order Fulfillment',
  'In Transit',
  'Delivered',
]);

function lineIsNrx(
  medicineId: string | undefined,
  batchNumber: string | undefined,
  flagged: boolean | undefined,
  nrxKeys: Set<string>
): boolean {
  if (flagged === true) return true;
  if (!medicineId || !batchNumber) return false;
  return nrxKeys.has(batchKey(medicineId, batchNumber));
}

export function extractNrxSales(
  orders: Order[],
  fromMs: number,
  toMsExclusive: number,
  nrxKeys: Set<string>,
  storeNameById: Record<string, string>
): NrxSaleRow[] {
  const rows: NrxSaleRow[] = [];
  for (const order of orders) {
    if (!SOLD_STATUSES.has(String(order.status))) continue;
    const d = toDate(order.orderDate);
    const t = d.getTime();
    if (t < fromMs || t >= toMsExclusive) continue;
    const retailerName =
      storeNameById[order.retailerId] ||
      order.retailerName ||
      order.retailerEmail ||
      order.retailerId ||
      '—';

    (order.medicines || []).forEach((line, idx) => {
      if (!line.medicineId) return;
      const allocations =
        line.batchAllocations && line.batchAllocations.length > 0
          ? line.batchAllocations
          : line.batchNumber
            ? [{ batchNumber: line.batchNumber, quantity: line.quantity, allocationFreeQty: line.freeQuantity, nrxDrug: line.nrxDrug }]
            : [];

      if (allocations.length === 0) {
        if (!lineIsNrx(line.medicineId, undefined, line.nrxDrug, nrxKeys) && line.nrxDrug !== true) {
          return;
        }
        // No batch but line flagged NRX
        if (line.nrxDrug === true) {
          rows.push({
            id: `${order.id}:${idx}`,
            date: d,
            retailerId: order.retailerId || '',
            retailerName,
            orderId: order.id,
            invoiceNumber: order.invoiceNumber,
            medicineId: line.medicineId,
            medicineName: line.name || line.medicineId,
            batchNumber: '',
            quantity: Number(line.quantity) || 0,
            freeQuantity: Number(line.freeQuantity) || 0,
          });
        }
        return;
      }

      allocations.forEach((a, aIdx) => {
        const flagged = a.nrxDrug === true || line.nrxDrug === true;
        if (!lineIsNrx(line.medicineId, a.batchNumber, flagged, nrxKeys)) return;
        const qty = Number(a.quantity) || 0;
        const free =
          a.allocationFreeQty != null
            ? Number(a.allocationFreeQty) || 0
            : Number(line.freeQuantity) || 0;
        rows.push({
          id: `${order.id}:${idx}:${aIdx}`,
          date: d,
          retailerId: order.retailerId || '',
          retailerName,
          orderId: order.id,
          invoiceNumber: order.invoiceNumber,
          medicineId: line.medicineId!,
          medicineName: line.name || line.medicineId!,
          batchNumber: a.batchNumber || '',
          quantity: qty,
          freeQuantity: free,
        });
      });
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  return rows;
}

export function storeDisplayName(store: User | undefined, fallback: string): string {
  if (!store) return fallback;
  return store.shopName || store.displayName || store.email || fallback;
}

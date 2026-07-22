import { Order } from '../types';
import { formatOrderNumberForDisplay } from './orderDisplay';
import { formatPurchaseSchemeLabel } from './purchaseSchemeLabel';

export type LastRetailerScheme = {
  medicineId: string;
  medicineName?: string;
  schemePaidQty?: number;
  schemeFreeQty?: number;
  discountPercentage?: number;
  price?: number;
  mrp?: number;
  gstRate?: number;
  quantity?: number;
  freeQuantity?: number;
  batchNumber?: string;
  orderId: string;
  orderDate: Date;
  invoiceNumber?: string;
};

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

/** Pull scheme paid/free from a line or any of its batch allocations. */
export function extractLineScheme(
  line: {
    schemePaidQty?: number;
    schemeFreeQty?: number;
    purchaseSchemeDeal?: number;
    purchaseSchemeFree?: number;
    batchAllocations?: Array<{
      schemePaidQty?: number;
      schemeFreeQty?: number;
      purchaseSchemeDeal?: number;
      purchaseSchemeFree?: number;
    }>;
  }
): { schemePaidQty: number; schemeFreeQty: number } | null {
  const from = (s: {
    schemePaidQty?: number;
    schemeFreeQty?: number;
    purchaseSchemeDeal?: number;
    purchaseSchemeFree?: number;
  }) => {
    const p = toNum(s.schemePaidQty ?? s.purchaseSchemeDeal);
    const f = toNum(s.schemeFreeQty ?? s.purchaseSchemeFree);
    return p > 0 && f > 0 ? { schemePaidQty: p, schemeFreeQty: f } : null;
  };

  const onLine = from(line);
  if (onLine) return onLine;
  for (const a of line.batchAllocations || []) {
    const sch = from(a);
    if (sch) return sch;
  }
  return null;
}

function extractLinePricing(line: {
  name?: string;
  discountPercentage?: number;
  price?: number;
  mrp?: number;
  gstRate?: number;
  quantity?: number;
  freeQuantity?: number;
  batchNumber?: string;
  batchAllocations?: Array<{
    discountPercentage?: number;
    purchasePrice?: number;
    mrp?: number;
    gstRate?: number;
    batchNumber?: string;
    quantity?: number;
    allocationFreeQty?: number;
  }>;
}): {
  medicineName?: string;
  discountPercentage?: number;
  price?: number;
  mrp?: number;
  gstRate?: number;
  quantity?: number;
  freeQuantity?: number;
  batchNumber?: string;
} {
  const allocs = line.batchAllocations || [];
  const first = allocs[0];

  let discountPercentage = toNum(line.discountPercentage);
  if (!(discountPercentage > 0) && first) {
    discountPercentage = toNum(first.discountPercentage);
  }

  let price = toNum(line.price);
  if (!(price > 0) && first) {
    price = toNum(first.purchasePrice);
  }

  let mrp = toNum(line.mrp);
  if (!(mrp > 0) && first) {
    mrp = toNum(first.mrp);
  }

  let gstRate = toNum(line.gstRate);
  if (!(gstRate > 0) && first) {
    gstRate = toNum(first.gstRate);
  }

  const quantity = toNum(line.quantity);
  const freeQuantity = toNum(line.freeQuantity);
  const batchNumber =
    (line.batchNumber || '').trim() ||
    (first?.batchNumber || '').trim() ||
    undefined;

  return {
    medicineName: line.name,
    discountPercentage: discountPercentage > 0 ? discountPercentage : discountPercentage === 0 ? 0 : undefined,
    price: price > 0 ? price : undefined,
    mrp: mrp > 0 ? mrp : undefined,
    gstRate: gstRate > 0 ? gstRate : undefined,
    quantity: quantity > 0 ? quantity : undefined,
    freeQuantity: freeQuantity > 0 ? freeQuantity : undefined,
    batchNumber,
  };
}

/**
 * Most recent prior line per medicineId for this retailer
 * (excludes current order, Pending, Cancelled). Includes scheme + discount/pricing.
 */
export function buildLastSchemeByMedicineId(
  orders: Order[],
  excludeOrderId?: string
): Map<string, LastRetailerScheme> {
  const sorted = [...orders].sort(
    (a, b) => toDate(b.orderDate).getTime() - toDate(a.orderDate).getTime()
  );
  const map = new Map<string, LastRetailerScheme>();

  for (const order of sorted) {
    if (!order?.id) continue;
    if (excludeOrderId && order.id === excludeOrderId) continue;
    if (order.status === 'Pending' || order.status === 'Cancelled') continue;

    for (const line of order.medicines || []) {
      const medicineId = (line.medicineId || '').trim();
      if (!medicineId || map.has(medicineId)) continue;

      // Need at least a billable prior line (batch or priced)
      const hasBatch =
        !!(line.batchNumber || (line.batchAllocations && line.batchAllocations.length > 0));
      const hasPrice = toNum(line.price) > 0 || toNum(line.mrp) > 0;
      if (!hasBatch && !hasPrice) continue;

      const sch = extractLineScheme(line);
      const pricing = extractLinePricing(line);

      map.set(medicineId, {
        medicineId,
        medicineName: pricing.medicineName,
        schemePaidQty: sch?.schemePaidQty,
        schemeFreeQty: sch?.schemeFreeQty,
        discountPercentage: pricing.discountPercentage,
        price: pricing.price,
        mrp: pricing.mrp,
        gstRate: pricing.gstRate,
        quantity: pricing.quantity,
        freeQuantity: pricing.freeQuantity,
        batchNumber: pricing.batchNumber,
        orderId: order.id,
        orderDate: toDate(order.orderDate),
        invoiceNumber: order.invoiceNumber,
      });
    }
  }

  return map;
}

function money(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

export function formatLastRetailerSchemeHint(
  last: LastRetailerScheme | undefined,
  options?: { subject?: string; emptyHint?: string }
): string {
  const subject = options?.subject ?? 'this store';
  if (!last) {
    return options?.emptyHint ?? `No prior order for ${subject} on this item`;
  }
  const ref = last.invoiceNumber || formatOrderNumberForDisplay(last.orderId);
  const dateStr = last.orderDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const parts: string[] = [`Last (${subject}) · ${ref} · ${dateStr}`];

  if (last.schemePaidQty && last.schemeFreeQty) {
    parts.push(`Scheme ${formatPurchaseSchemeLabel(last.schemePaidQty, last.schemeFreeQty)}`);
  } else {
    parts.push('Scheme —');
  }
  parts.push(`Disc ${pct(last.discountPercentage)}`);
  if (last.price != null) parts.push(`Rate ${money(last.price)}`);
  if (last.mrp != null) parts.push(`MRP ${money(last.mrp)}`);
  if (last.gstRate != null) parts.push(`GST ${pct(last.gstRate)}`);

  return parts.join(' · ');
}

export type LastRetailerSchemeDetailRow = { label: string; value: string };

/** Structured rows for popover. */
export function getLastRetailerSchemeDetailRows(
  last: LastRetailerScheme | undefined
): LastRetailerSchemeDetailRow[] {
  if (!last) {
    return [{ label: 'History', value: 'No prior order for this store on this item' }];
  }
  const ref = last.invoiceNumber || formatOrderNumberForDisplay(last.orderId);
  const dateStr = last.orderDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const rows: LastRetailerSchemeDetailRow[] = [
    { label: 'Order', value: `${ref} · ${dateStr}` },
  ];
  if (last.schemePaidQty && last.schemeFreeQty) {
    rows.push({
      label: 'Scheme',
      value: formatPurchaseSchemeLabel(last.schemePaidQty, last.schemeFreeQty),
    });
  } else {
    rows.push({ label: 'Scheme', value: '—' });
  }
  rows.push({
    label: 'Discount',
    value: last.discountPercentage != null ? pct(last.discountPercentage) : '—',
  });
  rows.push({ label: 'Rate', value: money(last.price) });
  rows.push({ label: 'MRP', value: money(last.mrp) });
  rows.push({ label: 'GST', value: last.gstRate != null ? pct(last.gstRate) : '—' });
  if (last.quantity != null || last.freeQuantity != null) {
    const paid = last.quantity ?? 0;
    const free = last.freeQuantity ?? 0;
    rows.push({
      label: 'Qty',
      value: free > 0 ? `${paid} + ${free} free` : String(paid || '—'),
    });
  }
  if (last.batchNumber) {
    rows.push({ label: 'Batch', value: last.batchNumber });
  }
  return rows;
}

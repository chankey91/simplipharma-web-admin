/**
 * Pending-order need versus current stock.
 * Purchase bills are not added again: saving a bill already increases stock.
 */
import type { Order, OrderMedicine } from '../types';
import { formatOrderNumberForDisplay } from './orderDisplay';

const toNum = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

export type PurchaseShortRow = {
  key: string;
  name: string;
  medicineId?: string;
  orderedQty: number;
  stockQty: number;
  shortQty: number;
  orderNumbers: string[];
};

export type PurchaseShortList = {
  orderCount: number;
  shorts: PurchaseShortRow[];
  requests: PurchaseShortRow[];
};

function orderedQty(line: OrderMedicine): number {
  const original = toNum(line.originalQuantity);
  if (original > 0) return original;
  return toNum(line.quantity);
}

function isProductRequest(line: OrderMedicine): boolean {
  return line.lineType === 'product_demand' || !String(line.medicineId || '').trim();
}

export function stockOnHand(medicine: { stockBatches?: Array<{ quantity?: unknown }> } | undefined): number {
  const batches = medicine?.stockBatches ?? [];
  return batches.reduce((sum, batch) => sum + Math.max(0, toNum(batch.quantity)), 0);
}

export function buildPurchaseShortList(
  orders: Order[],
  medicines: Map<string, { stockBatches?: Array<{ quantity?: unknown }> }>
): PurchaseShortList {
  const pending = orders.filter((order) => order.status === 'Pending');
  const catalog = new Map<
    string,
    { name: string; medicineId: string; orderedQty: number; orders: Set<string> }
  >();
  const requests = new Map<string, { name: string; orderedQty: number; orders: Set<string> }>();

  for (const order of pending) {
    const orderNo = formatOrderNumberForDisplay(order.id);
    for (const line of order.medicines ?? []) {
      const qty = orderedQty(line);
      if (qty <= 0 && line.lineType !== 'product_demand') continue;
      const name = String(line.name || '').trim() || 'Unknown';
      if (isProductRequest(line)) {
        const key = `request:${name.toLowerCase()}`;
        const row = requests.get(key) ?? { name, orderedQty: 0, orders: new Set<string>() };
        row.orderedQty += qty > 0 ? qty : 1;
        row.orders.add(orderNo);
        requests.set(key, row);
        continue;
      }
      const medicineId = String(line.medicineId);
      const row = catalog.get(medicineId) ?? {
        name,
        medicineId,
        orderedQty: 0,
        orders: new Set<string>(),
      };
      if (name.length > row.name.length) row.name = name;
      row.orderedQty += qty;
      row.orders.add(orderNo);
      catalog.set(medicineId, row);
    }
  }

  const shorts: PurchaseShortRow[] = [];
  for (const row of catalog.values()) {
    const stockQty = stockOnHand(medicines.get(row.medicineId));
    const shortQty = row.orderedQty - stockQty;
    if (shortQty <= 0.001) continue;
    shorts.push({
      key: row.medicineId,
      name: row.name,
      medicineId: row.medicineId,
      orderedQty: row.orderedQty,
      stockQty,
      shortQty,
      orderNumbers: [...row.orders].sort(),
    });
  }
  shorts.sort((a, b) => b.shortQty - a.shortQty || a.name.localeCompare(b.name));

  const requestRows: PurchaseShortRow[] = [...requests.values()]
    .map((row) => ({
      key: `request:${row.name.toLowerCase()}`,
      name: row.name,
      orderedQty: row.orderedQty,
      stockQty: 0,
      shortQty: row.orderedQty,
      orderNumbers: [...row.orders].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { orderCount: pending.length, shorts, requests: requestRows };
}

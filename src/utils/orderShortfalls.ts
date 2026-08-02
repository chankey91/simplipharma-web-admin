import { Order, OrderMedicine, OrderStatus } from '../types';
import { hasBatchAssignment } from './orderTotals';
import { coerceToDate } from './dateTime';

export type OrderShortfallReason = 'partial' | 'product_demand' | 'no_batch';

export type OrderShortfallRow = {
  id: string;
  retailerId: string;
  retailerName: string;
  retailerEmail: string;
  orderId: string;
  orderDate: Date;
  orderStatus: OrderStatus;
  medicineName: string;
  medicineId?: string;
  manufacturerName?: string;
  orderedQty: number;
  fulfilledQty: number;
  shortfallQty: number;
  reason: OrderShortfallReason;
  productDemandId?: string;
  /** True when the parent order is still in progress (not Delivered/Cancelled). */
  isOpen: boolean;
};

const toNum = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

export const SHORTFALL_REASON_LABELS: Record<OrderShortfallReason, string> = {
  partial: 'Partial fulfill',
  product_demand: 'Product demand',
  no_batch: 'No batch / skipped',
};

function isOpenOrderStatus(status: OrderStatus): boolean {
  return status === 'Pending' || status === 'Order Fulfillment' || status === 'In Transit';
}

function resolveRetailerName(order: Order): string {
  return (
    String(order.retailerName || '').trim() ||
    String(order.retailerEmail || '').trim() ||
    order.retailerId ||
    'Unknown store'
  );
}

function lineOrderedQty(line: OrderMedicine): number {
  const orig = toNum(line.originalQuantity);
  const qty = toNum(line.quantity);
  return orig > 0 ? orig : qty;
}

function lineFulfilledQty(line: OrderMedicine): number {
  if (line.lineType === 'product_demand') return 0;
  if (!hasBatchAssignment(line)) return 0;
  return toNum(line.quantity);
}

/**
 * Extract shortfall lines from an order:
 * - product_demand never converted
 * - medicine line past Pending with no batch (skipped from invoice)
 * - partial ship (originalQuantity > fulfilled quantity)
 */
export function extractOrderShortfalls(order: Order): OrderShortfallRow[] {
  if (!order || order.status === 'Cancelled') return [];

  const orderDate = coerceToDate(order.orderDate) || new Date(0);
  const retailerName = resolveRetailerName(order);
  const retailerEmail = String(order.retailerEmail || '').trim();
  const isOpen = isOpenOrderStatus(order.status);
  const rows: OrderShortfallRow[] = [];
  const lines = order.medicines || [];

  lines.forEach((line, index) => {
    const medicineName = String(line.name || '').trim() || 'Unknown medicine';
    const medicineId = line.medicineId ? String(line.medicineId) : undefined;
    const manufacturerName = line.manufacturerName
      ? String(line.manufacturerName).trim()
      : undefined;

    if (line.lineType === 'product_demand') {
      const orderedQty = Math.max(1, toNum(line.quantity) || toNum(line.originalQuantity) || 1);
      rows.push({
        id: `${order.id}:demand:${index}`,
        retailerId: order.retailerId || '',
        retailerName,
        retailerEmail,
        orderId: order.id,
        orderDate,
        orderStatus: order.status,
        medicineName,
        medicineId,
        manufacturerName,
        orderedQty,
        fulfilledQty: 0,
        shortfallQty: orderedQty,
        reason: 'product_demand',
        productDemandId: line.productDemandId,
        isOpen,
      });
      return;
    }

    // Pending medicine lines are still being worked — not a shortfall yet.
    if (order.status === 'Pending') return;

    if (!hasBatchAssignment(line)) {
      const orderedQty = lineOrderedQty(line);
      if (orderedQty <= 0) return;
      rows.push({
        id: `${order.id}:nobatch:${index}`,
        retailerId: order.retailerId || '',
        retailerName,
        retailerEmail,
        orderId: order.id,
        orderDate,
        orderStatus: order.status,
        medicineName,
        medicineId,
        manufacturerName,
        orderedQty,
        fulfilledQty: 0,
        shortfallQty: orderedQty,
        reason: 'no_batch',
        isOpen,
      });
      return;
    }

    const orderedQty = lineOrderedQty(line);
    const fulfilledQty = lineFulfilledQty(line);
    if (orderedQty > fulfilledQty + 0.001) {
      rows.push({
        id: `${order.id}:partial:${index}`,
        retailerId: order.retailerId || '',
        retailerName,
        retailerEmail,
        orderId: order.id,
        orderDate,
        orderStatus: order.status,
        medicineName,
        medicineId,
        manufacturerName,
        orderedQty,
        fulfilledQty,
        shortfallQty: orderedQty - fulfilledQty,
        reason: 'partial',
        isOpen,
      });
    }
  });

  return rows;
}

export function extractOrderShortfallsFromOrders(orders: Order[]): OrderShortfallRow[] {
  const rows: OrderShortfallRow[] = [];
  for (const order of orders) {
    rows.push(...extractOrderShortfalls(order));
  }
  return rows;
}

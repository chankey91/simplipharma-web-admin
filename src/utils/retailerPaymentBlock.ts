import { Order } from '../types';
import { formatOrderNumberForDisplay } from './orderDisplay';

/** Grace period after delivery to record full payment before new orders are blocked. */
export const PAYMENT_GRACE_AFTER_DELIVERY_MS = 2 * 24 * 60 * 60 * 1000;

/** Admin can temporarily unlock a blocked retailer for this duration. */
export const ORDER_BLOCK_OVERRIDE_MS = 6 * 60 * 60 * 1000;

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof (v as { toDate?: () => Date })?.toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  const raw = v as { seconds?: number; _seconds?: number };
  if (typeof raw?.seconds === 'number') {
    const d = new Date(raw.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw?._seconds === 'number') {
    const d = new Date(raw._seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
}

export function getOrderDeliveredAt(order: Order): Date | null {
  const fromConfirm = toDate(order.deliveryConfirmation?.deliveredAt);
  if (fromConfirm) return fromConfirm;
  const timeline = order.timeline || [];
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].status === 'Delivered') {
      const t = toDate(timeline[i].timestamp);
      if (t) return t;
    }
  }
  return null;
}

/** Total payment recorded on the order (payments array, then paidAmount, then Paid status). */
export function getTotalPaidRecorded(order: Order): number {
  const payments = order.payments || [];
  if (payments.length > 0) {
    return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }
  if (order.paidAmount != null && order.paidAmount > 0) {
    return Number(order.paidAmount) || 0;
  }
  if (order.paymentStatus === 'Paid') {
    return Number(order.totalAmount) || 0;
  }
  return 0;
}

export function isOrderPaymentFullyRecorded(order: Order): boolean {
  const total = Number(order.totalAmount) || 0;
  if (total <= 0) return true;
  const paid = getTotalPaidRecorded(order);
  if (paid >= total - 0.01) return true;
  if (order.dueAmount != null && Number(order.dueAmount) <= 0.01) return true;
  return false;
}

/**
 * True when this delivered order blocks new retailer orders (unpaid past grace).
 * Same rule as the retailer app checkout block.
 */
export function isOrderPlacementBlockingOrder(order: Order, nowMs = Date.now()): boolean {
  if (order.status === 'Cancelled') return false;
  if (order.status !== 'Delivered') return false;
  if (isOrderPaymentFullyRecorded(order)) return false;
  const deliveredAt = getOrderDeliveredAt(order);
  if (!deliveredAt) return false;
  return nowMs > deliveredAt.getTime() + PAYMENT_GRACE_AFTER_DELIVERY_MS;
}

/** True while an admin temporary unlock is still valid. */
export function isOrderBlockOverrideActive(until: unknown, nowMs = Date.now()): boolean {
  const d = toDate(until);
  return !!d && d.getTime() > nowMs;
}

/**
 * If non-null, retailer must not place new orders (delivered order unpaid past grace).
 */
export function getRetailerOrderPlacementBlockMessage(orders: Order[]): string | null {
  for (const order of orders) {
    if (!isOrderPlacementBlockingOrder(order)) continue;
    const ref = `Order ${formatOrderNumberForDisplay(order.id)}`;
    return (
      `${ref} was delivered more than 2 days ago and full payment is not recorded. ` +
      'Please complete payment or contact your Sales Officer before placing a new order.'
    );
  }
  return null;
}

/** Retailer IDs with overdue delivered unpaid (ignores admin unlock). */
export function buildPaymentOverdueRetailerIds(
  orders: Order[],
  nowMs = Date.now()
): Set<string> {
  const overdue = new Set<string>();
  for (const order of orders) {
    if (!order.retailerId) continue;
    if (!isOrderPlacementBlockingOrder(order, nowMs)) continue;
    overdue.add(order.retailerId);
  }
  return overdue;
}

/** Retailer IDs currently blocked from placing new orders (after admin unlock filter). */
export function buildOrderPlacementBlockedRetailerIds(
  orders: Order[],
  options?: {
    overrideUntilByRetailerId?: Map<string, unknown> | Record<string, unknown>;
    nowMs?: number;
  }
): Set<string> {
  const nowMs = options?.nowMs ?? Date.now();
  const overrides = options?.overrideUntilByRetailerId;
  const getUntil = (retailerId: string): unknown => {
    if (!overrides) return undefined;
    if (overrides instanceof Map) return overrides.get(retailerId);
    return overrides[retailerId];
  };
  const blocked = new Set<string>();
  for (const order of orders) {
    if (!order.retailerId) continue;
    if (!isOrderPlacementBlockingOrder(order, nowMs)) continue;
    if (isOrderBlockOverrideActive(getUntil(order.retailerId), nowMs)) continue;
    blocked.add(order.retailerId);
  }
  return blocked;
}

import { Order, User } from '../types';

export type ReceivableOrder = Order & {
  outstanding: number;
};

export type StoreReceivableSummary = {
  retailerId: string;
  store: User | null;
  displayName: string;
  storeCode: string;
  retailerEmail: string;
  orderCount: number;
  totalOutstanding: number;
  oldestOrderDate: Date | null;
  orders: ReceivableOrder[];
};

/** Billable = fulfilled, not cancelled, money still owed */
export function isReceivableOrder(o: Order): boolean {
  if (o.status === 'Cancelled' || o.status === 'Pending') return false;
  const ps = o.paymentStatus;
  return ps === 'Unpaid' || ps === 'Partial' || !ps;
}

export function orderOutstanding(o: Order): number {
  if (o.paymentStatus === 'Partial') {
    if (o.dueAmount != null && o.dueAmount > 0) return o.dueAmount;
    return Math.max(0, (o.totalAmount ?? 0) - (o.paidAmount ?? 0));
  }
  // Unpaid or unset paymentStatus — prefer dueAmount when present
  if (o.dueAmount != null && o.dueAmount > 0) return o.dueAmount;
  return Math.max(0, (o.totalAmount ?? 0) - (o.paidAmount ?? 0));
}

export function buildStoreReceivableSummaries(
  orders: Order[],
  stores: User[]
): StoreReceivableSummary[] {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const byRetailer = new Map<string, ReceivableOrder[]>();

  for (const o of orders) {
    if (!isReceivableOrder(o)) continue;
    const outstanding = orderOutstanding(o);
    if (outstanding <= 0) continue;
    const list = byRetailer.get(o.retailerId) ?? [];
    list.push({ ...o, outstanding });
    byRetailer.set(o.retailerId, list);
  }

  const summaries: StoreReceivableSummary[] = [];
  for (const [retailerId, recOrders] of byRetailer) {
    const store = storeById.get(retailerId) ?? null;
    recOrders.sort(
      (a, b) =>
        new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    );
    const dates = recOrders
      .map((o) => new Date(o.orderDate))
      .filter((d) => !isNaN(d.getTime()));
    summaries.push({
      retailerId,
      store,
      displayName:
        store?.shopName ||
        store?.displayName ||
        recOrders[0]?.retailerName ||
        'Unknown store',
      storeCode: store?.storeCode || '—',
      retailerEmail:
        store?.email || recOrders[0]?.retailerEmail || '—',
      orderCount: recOrders.length,
      totalOutstanding: recOrders.reduce((s, o) => s + o.outstanding, 0),
      oldestOrderDate: dates.length
        ? new Date(Math.min(...dates.map((d) => d.getTime())))
        : null,
      orders: recOrders,
    });
  }

  return summaries.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}

export { formatOrderInvoiceLabel } from './orderDisplay';

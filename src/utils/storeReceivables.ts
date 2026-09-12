import { Order, User } from '../types';
import { resolveOrderInvoiceGrandTotal } from './orderTotals';
import { formatOrderInvoiceLabel } from './orderDisplay';

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
  const invoiceTotal = resolveOrderInvoiceGrandTotal(o);
  const paid = o.paidAmount ?? 0;
  return Math.max(0, invoiceTotal - paid);
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

const formatInr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** WhatsApp bold (mobile/web): *text* */
const boldWa = (text: string) => `*${text}*`;

/** WhatsApp body for one medical store: total due + open bills. */
export function formatRetailerDuesWhatsAppMessage(summary: StoreReceivableSummary): string {
  const lines: string[] = [
    `SimpliPharma — Outstanding dues reminder`,
    `Store: ${summary.displayName}${summary.storeCode && summary.storeCode !== '—' ? ` (${summary.storeCode})` : ''}`,
    `Total due: ${boldWa(formatInr(summary.totalOutstanding))}`,
    `Open bills: ${summary.orderCount}`,
    '',
  ];

  for (const bill of summary.orders) {
    const inv = formatOrderInvoiceLabel(bill);
    const date =
      bill.orderDate instanceof Date
        ? bill.orderDate
        : bill.orderDate
          ? new Date(bill.orderDate as string)
          : null;
    const dateLabel =
      date && !isNaN(date.getTime())
        ? date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '';
    lines.push(
      `• ${inv}${dateLabel ? ` (${dateLabel})` : ''}: ${boldWa(formatInr(bill.outstanding))}`
    );
  }

  lines.push('', 'Please arrange payment at the earliest. Thank you.');
  return lines.join('\n');
}

export { formatOrderInvoiceLabel };

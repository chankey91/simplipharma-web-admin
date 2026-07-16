import {
  collection,
  query,
  where,
  sum,
  count,
  getAggregateFromServer,
  Timestamp,
} from 'firebase/firestore';
import { isBefore } from 'date-fns';
import { db } from './firebase';
import { getAllOrders } from './orders';
import { OrderStatus } from '../types';

/**
 * Server-side aggregation of the order KPIs the Dashboard needs. This replaces a
 * full `orders` collection download with a handful of aggregation reads
 * (Firestore bills ~1 read per 1000 matched index entries), which is the single
 * biggest read saver as the orders collection grows.
 */
const ORDER_STATUSES: OrderStatus[] = [
  'Pending',
  'Order Fulfillment',
  'In Transit',
  'Delivered',
  'Cancelled',
];

export interface OrderDashboardStats {
  statusCounts: Record<OrderStatus, number>;
  totalOrders: number;
  unpaidCount: number;
  /** Gross revenue of non-cancelled orders (lifetime). */
  lifetimeGross: number;
  /** Gross revenue of non-cancelled orders in the current month. */
  thisMonthGross: number;
}

/** Client-side fallback when server aggregation is unavailable or fails. */
async function getOrderDashboardStatsFromDocs(monthStart: Date): Promise<OrderDashboardStats> {
  const list = await getAllOrders();

  const statusCounts = ORDER_STATUSES.reduce((acc, status) => {
    acc[status] = list.filter((o) => o.status === status).length;
    return acc;
  }, {} as Record<OrderStatus, number>);

  const activeOrders = list.filter((o) => o.status !== 'Cancelled');
  const lifetimeGross = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const thisMonthGross = activeOrders
    .filter((o) => {
      const d = o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate);
      return !isNaN(d.getTime()) && !isBefore(d, monthStart);
    })
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const totalOrders = list.length;
  const unpaidCount = list.filter(
    (o) => o.status !== 'Cancelled' && (o.paymentStatus === 'Unpaid' || !o.paymentStatus)
  ).length;

  return { statusCounts, totalOrders, unpaidCount, lifetimeGross, thisMonthGross };
}

export const getOrderDashboardStats = async (monthStart: Date): Promise<OrderDashboardStats> => {
  const col = collection(db, 'orders');
  const monthTs = Timestamp.fromDate(monthStart);

  try {
    const [
      statusCountSnaps,
      paidSnap,
      partialSnap,
      lifetimeSnap,
      lifetimeCancelledSnap,
      monthSnap,
      monthCancelledSum,
    ] = await Promise.all([
      // Per-status counts (single-field equality, auto-indexed).
      Promise.all(
        ORDER_STATUSES.map((s) =>
          getAggregateFromServer(query(col, where('status', '==', s)), { c: count() })
        )
      ),
      getAggregateFromServer(query(col, where('paymentStatus', '==', 'Paid')), { c: count() }),
      getAggregateFromServer(query(col, where('paymentStatus', '==', 'Partial')), { c: count() }),
      // Lifetime gross = all minus cancelled (avoids a multi-inequality query).
      getAggregateFromServer(query(col), { s: sum('totalAmount') }),
      getAggregateFromServer(query(col, where('status', '==', 'Cancelled')), { s: sum('totalAmount') }),
      // This-month gross = month total minus month cancelled.
      getAggregateFromServer(query(col, where('orderDate', '>=', monthTs)), { s: sum('totalAmount') }),
      // Needs a (status, orderDate) composite index. If it's not deployed yet, fall
      // back to 0 (month gross then includes any cancelled-this-month) rather than
      // failing the whole dashboard.
      getAggregateFromServer(
        query(col, where('status', '==', 'Cancelled'), where('orderDate', '>=', monthTs)),
        { s: sum('totalAmount') }
      )
        .then((snap) => snap.data().s ?? 0)
        .catch((err) => {
          console.warn('month-cancelled aggregation failed (deploy firestore indexes):', err);
          return 0;
        }),
    ]);

    const statusCounts = ORDER_STATUSES.reduce((acc, s, i) => {
      acc[s] = statusCountSnaps[i].data().c ?? 0;
      return acc;
    }, {} as Record<OrderStatus, number>);

    const totalOrders = ORDER_STATUSES.reduce((total, s) => total + statusCounts[s], 0);
    const cancelled = statusCounts['Cancelled'] ?? 0;
    const paid = paidSnap.data().c ?? 0;
    const partial = partialSnap.data().c ?? 0;
    // Non-cancelled orders that are neither Paid nor Partial. Deriving it this way
    // treats a missing `paymentStatus` as unpaid, matching the previous in-memory
    // logic, without needing a query for a missing field.
    const unpaidCount = Math.max(0, totalOrders - paid - partial - cancelled);

    const lifetimeGross = (lifetimeSnap.data().s ?? 0) - (lifetimeCancelledSnap.data().s ?? 0);
    const thisMonthGross = (monthSnap.data().s ?? 0) - monthCancelledSum;

    const aggregated = { statusCounts, totalOrders, unpaidCount, lifetimeGross, thisMonthGross };
    const aggregationLooksEmpty =
      totalOrders === 0 &&
      lifetimeGross === 0 &&
      ORDER_STATUSES.every((s) => (statusCounts[s] ?? 0) === 0);

    if (aggregationLooksEmpty) {
      const fromDocs = await getOrderDashboardStatsFromDocs(monthStart);
      if (fromDocs.totalOrders > 0 || fromDocs.lifetimeGross > 0) {
        console.warn(
          'Order dashboard aggregation returned all zeros but documents exist; using client-side stats.'
        );
        return fromDocs;
      }
    }

    return aggregated;
  } catch (err) {
    console.warn('Order dashboard aggregation failed; falling back to client-side stats:', err);
    return getOrderDashboardStatsFromDocs(monthStart);
  }
};

/**
 * Server-side sum of totalAmount for invoiced orders (those with a generated
 * invoice: everything except Pending and Cancelled). Used by the Invoices page
 * "Total Amount" KPI without downloading the collection.
 */
export const getOrderInvoicedAmountTotal = async (): Promise<number> => {
  const col = collection(db, 'orders');
  const snap = await getAggregateFromServer(
    query(col, where('status', 'in', ['Order Fulfillment', 'In Transit', 'Delivered'])),
    { s: sum('totalAmount') }
  );
  return snap.data().s ?? 0;
};

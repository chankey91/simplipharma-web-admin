import type { Order, PurchaseInvoice } from '../types';
import type { CreditNote } from '../types';
import { getTodayDateStringIST, coerceToDate } from './dateTime';

export type DailyBusinessRow = {
  date: string;
  salesCount: number;
  salesAmount: number;
  cancelledCount: number;
  purchaseCount: number;
  purchaseAmount: number;
  creditNoteCount: number;
  creditNoteAmount: number;
};

function emptyBucket() {
  return {
    salesCount: 0,
    salesAmount: 0,
    cancelledCount: 0,
    purchaseCount: 0,
    purchaseAmount: 0,
    creditNoteCount: 0,
    creditNoteAmount: 0,
  };
}

export function fillIstDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  if (!fromDate || !toDate || fromDate > toDate) return dates;
  let ms = new Date(`${fromDate}T12:00:00+05:30`).getTime();
  const end = new Date(`${toDate}T12:00:00+05:30`).getTime();
  while (ms <= end) {
    dates.push(getTodayDateStringIST(new Date(ms)));
    ms += 24 * 60 * 60 * 1000;
  }
  return dates;
}

function inRange(key: string, fromDate: string, toDate: string): boolean {
  if (fromDate && key < fromDate) return false;
  if (toDate && key > toDate) return false;
  return true;
}

export function buildDailyBusiness(opts: {
  orders: Order[];
  purchases: PurchaseInvoice[];
  creditNotes: CreditNote[];
  fromDate: string;
  toDate: string;
}): DailyBusinessRow[] {
  const byDate = new Map<string, ReturnType<typeof emptyBucket>>();
  for (const date of fillIstDateRange(opts.fromDate, opts.toDate)) {
    byDate.set(date, emptyBucket());
  }

  const bucket = (date: string) => {
    let row = byDate.get(date);
    if (!row) {
      row = emptyBucket();
      byDate.set(date, row);
    }
    return row;
  };

  for (const order of opts.orders) {
    const d = coerceToDate(order.orderDate);
    if (!d) continue;
    const key = getTodayDateStringIST(d);
    if (!inRange(key, opts.fromDate, opts.toDate)) continue;
    const row = bucket(key);
    if (order.status === 'Cancelled') {
      row.cancelledCount += 1;
      continue;
    }
    row.salesCount += 1;
    row.salesAmount += Number(order.totalAmount) || 0;
  }

  for (const inv of opts.purchases) {
    const d = coerceToDate(inv.invoiceDate);
    if (!d) continue;
    const key = getTodayDateStringIST(d);
    if (!inRange(key, opts.fromDate, opts.toDate)) continue;
    const row = bucket(key);
    row.purchaseCount += 1;
    row.purchaseAmount += Number(inv.totalAmount) || 0;
  }

  for (const note of opts.creditNotes) {
    const d = coerceToDate(note.creditNoteDate ?? note.createdAt);
    if (!d) continue;
    const key = getTodayDateStringIST(d);
    if (!inRange(key, opts.fromDate, opts.toDate)) continue;
    const row = bucket(key);
    row.creditNoteCount += 1;
    row.creditNoteAmount += Number(note.totalAmount) || 0;
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, row]) => ({ date, ...row }));
}

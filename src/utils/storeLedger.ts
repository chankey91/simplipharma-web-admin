import { endOfDay, startOfDay } from 'date-fns';
import { CreditNote, DebitNote, Order, Payment, User } from '../types';
import { formatOrderInvoiceLabel } from './orderDisplay';
import { resolveOrderInvoiceGrandTotal } from './orderTotals';
import {
  defaultVendorLedgerDateRange,
  formatLedgerAmount,
  toLedgerDate,
} from './vendorLedger';

export type StoreLedgerVchType =
  | 'Sales'
  | 'Payment'
  | 'Credit Note'
  | 'Debit Note'
  | 'Opening';

export type StoreLedgerEntry = {
  date: Date;
  particulars: string;
  particularsBold?: string;
  vchType: StoreLedgerVchType;
  vchNo: string;
  debit: number;
  credit: number;
  balance: number;
  isSummary?: boolean;
};

export type StoreLedgerResult = {
  store: User | null;
  storeName: string;
  storeAddress: string;
  storeGstNumber: string;
  storeCode: string;
  fromDate: Date;
  toDate: Date;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  entries: StoreLedgerEntry[];
};

export type LedgerOrder = Order & {
  ledgerPayments?: Payment[];
};

export const defaultStoreLedgerDateRange = defaultVendorLedgerDateRange;

export { formatLedgerAmount };

function isCashPayment(method?: string): boolean {
  const m = (method || 'Cash').toUpperCase();
  return m === 'CASH';
}

/** Payment ledger Vch No.: online → transaction id; cash → — */
export function resolvePaymentVchNo(
  pay: Payment,
  order?: Pick<Order, 'transactionId' | 'invoiceNumber' | 'id'>
): string {
  if (isCashPayment(pay.paymentMethod)) return '-';
  return pay.transactionId || order?.transactionId || '-';
}

/** Billable sales orders (fulfilled / in pipeline, not cancelled or pending). */
export function isLedgerBillableOrder(o: Order): boolean {
  return o.status !== 'Cancelled' && o.status !== 'Pending';
}

/** Resolve credit lines from payment subcollection, payments array, or legacy paidAmount. */
export function extractStorePaymentCredits(order: LedgerOrder): Payment[] {
  const fromSub = order.ledgerPayments?.filter((p) => (p.amount ?? 0) > 0);
  if (fromSub && fromSub.length > 0) return fromSub;

  if (Array.isArray(order.payments) && order.payments.length > 0) {
    return order.payments.filter((p) => (p.amount ?? 0) > 0);
  }

  const paid = order.paidAmount ?? 0;
  if (paid <= 0 || order.paymentStatus === 'Unpaid') return [];

  return [
    {
      id: `legacy-${order.id}`,
      orderId: order.id,
      amount: paid,
      paymentDate: toLedgerDate(order.orderDate),
      paymentMethod: order.paymentMethod || 'Cash',
      transactionId: order.transactionId,
    },
  ];
}

function receiptParticulars(method?: string): { text: string; bold: string } {
  const m = (method || 'Cash').toUpperCase();
  if (m.includes('ONLINE') || m.includes('UPI') || m.includes('BANK')) {
    return { text: 'By ', bold: 'BANK / ONLINE' };
  }
  return { text: 'By ', bold: 'CASH' };
}

function inRange(d: Date, from: Date, to: Date): boolean {
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function beforeRange(d: Date, from: Date): boolean {
  return d.getTime() < from.getTime();
}

const vchTypeSortOrder: Record<StoreLedgerVchType, number> = {
  Opening: 0,
  Sales: 1,
  'Debit Note': 2,
  Payment: 3,
  'Credit Note': 4,
};

export function buildStoreLedger(
  store: User | null,
  orders: LedgerOrder[],
  creditNotes: CreditNote[],
  debitNotes: DebitNote[],
  fromDate: Date,
  toDate: Date
): StoreLedgerResult {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  let openingDebits = 0;
  let openingCredits = 0;

  const periodLines: Array<Omit<StoreLedgerEntry, 'balance'>> = [];

  for (const order of orders) {
    if (!isLedgerBillableOrder(order)) continue;

    const orderDate = toLedgerDate(order.orderDate);
    const total = resolveOrderInvoiceGrandTotal(order);
    const credits = extractStorePaymentCredits(order);
    const invoiceRef = formatOrderInvoiceLabel(order);

    if (beforeRange(orderDate, from)) {
      openingDebits += total;
    } else if (inRange(orderDate, from, to)) {
      periodLines.push({
        date: orderDate,
        particulars: 'To ',
        particularsBold: 'SALES',
        vchType: 'Sales',
        vchNo: invoiceRef,
        debit: total,
        credit: 0,
      });
    }

    for (const pay of credits) {
      const payDate = toLedgerDate(pay.paymentDate);
      const amt = pay.amount ?? 0;
      if (amt <= 0) continue;

      if (beforeRange(payDate, from)) {
        openingCredits += amt;
      } else if (inRange(payDate, from, to)) {
        const { text, bold } = receiptParticulars(pay.paymentMethod);
        periodLines.push({
          date: payDate,
          particulars: text,
          particularsBold: `${bold} (${invoiceRef})`,
          vchType: 'Payment',
          vchNo: resolvePaymentVchNo(pay, order),
          debit: 0,
          credit: amt,
        });
      }
    }
  }

  for (const note of debitNotes) {
    const noteDate = toLedgerDate(note.debitNoteDate);
    const total = note.totalAmount ?? 0;
    if (total <= 0) continue;
    const ref = note.debitNoteNumber || note.id;

    if (beforeRange(noteDate, from)) {
      openingDebits += total;
    } else if (inRange(noteDate, from, to)) {
      periodLines.push({
        date: noteDate,
        particulars: 'To ',
        particularsBold: 'DEBIT NOTE',
        vchType: 'Debit Note',
        vchNo: ref,
        debit: total,
        credit: 0,
      });
    }
  }

  for (const note of creditNotes) {
    const noteDate = toLedgerDate(note.creditNoteDate);
    const total = note.totalAmount ?? 0;
    if (total <= 0) continue;
    const ref = note.creditNoteNumber || note.id;
    const invoiceRef = note.originalInvoiceNumber || note.orderId || '';

    if (beforeRange(noteDate, from)) {
      openingCredits += total;
    } else if (inRange(noteDate, from, to)) {
      periodLines.push({
        date: noteDate,
        particulars: 'By ',
        particularsBold: invoiceRef ? `CREDIT NOTE (${invoiceRef})` : 'CREDIT NOTE',
        vchType: 'Credit Note',
        vchNo: ref,
        debit: 0,
        credit: total,
      });
    }
  }

  periodLines.sort((a, b) => {
    const cmp = a.date.getTime() - b.date.getTime();
    if (cmp !== 0) return cmp;
    const typeCmp = vchTypeSortOrder[a.vchType] - vchTypeSortOrder[b.vchType];
    if (typeCmp !== 0) return typeCmp;
    return a.vchNo.localeCompare(b.vchNo);
  });

  const openingBalance = openingDebits - openingCredits;
  let running = openingBalance;
  const entries: StoreLedgerEntry[] = [];

  if (openingBalance !== 0) {
    entries.push({
      date: from,
      particulars: 'Opening Balance',
      vchType: 'Opening',
      vchNo: '',
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance,
      isSummary: true,
    });
    running = openingBalance;
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of periodLines) {
    running += line.debit - line.credit;
    totalDebit += line.debit;
    totalCredit += line.credit;
    entries.push({ ...line, balance: running });
  }

  const storeName =
    store?.shopName ||
    store?.displayName ||
    orders[0]?.retailerName ||
    'Unknown store';

  return {
    store,
    storeName,
    storeAddress: store?.address?.trim() || '—',
    storeGstNumber: store?.gst?.trim() || '—',
    storeCode: store?.storeCode?.trim() || '—',
    fromDate: from,
    toDate: to,
    openingBalance,
    closingBalance: running,
    totalDebit,
    totalCredit,
    entries,
  };
}

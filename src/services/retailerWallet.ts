import { collection, getDocs, query, where, orderBy, db } from './firebase';
import { getCreditNotesByRetailer } from './creditNotes';
import { getDebitNotesByRetailer } from './debitNotes';
import { getOrdersByRetailer } from './orders';
import { getOrderReturnRequests } from './orderReturns';
import { getExpiryReturnRequests } from './expiryReturns';
import {
  buildWalletTransactions,
  computeWalletAvailable,
  mergeWalletCreditNotes,
  roundMoney2,
  type WalletCreditNote,
  type WalletDebitNote,
  type WalletOrderDebit,
  type WalletTxn,
} from '../utils/retailerWallet';

export type RetailerWalletSummary = {
  retailerId: string;
  available: number;
  notes: WalletCreditNote[];
  debitNotes: WalletDebitNote[];
  transactions: WalletTxn[];
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getOrderReturnsByRetailer(retailerId: string) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'order_return_requests'),
        where('retailerId', '==', retailerId),
        orderBy('createdAt', 'desc')
      )
    );
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        retailerId: String(data.retailerId || ''),
        status: String(data.status || ''),
        totalRefundAmount: Number(data.totalRefundAmount) || 0,
        creditNoteAmount:
          typeof data.creditNoteAmount === 'number' ? data.creditNoteAmount : undefined,
        creditAmountUsed:
          typeof data.creditAmountUsed === 'number' ? data.creditAmountUsed : undefined,
        creditNoteNumber: data.creditNoteNumber ? String(data.creditNoteNumber) : undefined,
        paymentReferenceNumber: data.paymentReferenceNumber
          ? String(data.paymentReferenceNumber)
          : undefined,
        creditNoteDate: data.creditNoteDate,
        approvedAt: data.approvedAt,
        createdAt: data.createdAt,
      };
    });
  } catch (error) {
    console.warn('getOrderReturnsByRetailer fallback:', error);
    const all = await getOrderReturnRequests('all');
    return all
      .filter((r) => r.retailerId === retailerId)
      .map((r) => ({
        id: r.id,
        retailerId: r.retailerId,
        status: r.status,
        totalRefundAmount: r.totalRefundAmount,
        creditNoteNumber: r.creditNoteNumber,
        paymentReferenceNumber: r.paymentReferenceNumber,
        approvedAt: r.approvedAt,
        createdAt: r.createdAt,
      }));
  }
}

async function getExpiryReturnsByRetailer(retailerId: string) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'expiry_return_requests'),
        where('retailerId', '==', retailerId),
        orderBy('createdAt', 'desc')
      )
    );
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        retailerId: String(data.retailerId || ''),
        status: String(data.status || ''),
        totalRefundAmount: Number(data.totalRefundAmount) || 0,
        creditNoteAmount:
          typeof data.creditNoteAmount === 'number' ? data.creditNoteAmount : undefined,
        creditAmountUsed:
          typeof data.creditAmountUsed === 'number' ? data.creditAmountUsed : undefined,
        creditNoteNumber: data.creditNoteNumber ? String(data.creditNoteNumber) : undefined,
        paymentReferenceNumber: data.paymentReferenceNumber
          ? String(data.paymentReferenceNumber)
          : undefined,
        creditNoteDate: data.creditNoteDate,
        approvedAt: data.approvedAt,
        createdAt: data.createdAt,
      };
    });
  } catch (error) {
    console.warn('getExpiryReturnsByRetailer fallback:', error);
    const all = await getExpiryReturnRequests();
    return all
      .filter((r) => r.retailerId === retailerId)
      .map((r) => ({
        id: r.id,
        retailerId: r.retailerId,
        status: r.status,
        totalRefundAmount: r.totalRefundAmount,
        paymentReferenceNumber: r.paymentReferenceNumber,
        approvedAt: r.approvedAt,
        createdAt: r.createdAt,
      }));
  }
}

function mapDedicatedCreditNote(note: {
  id: string;
  creditNoteNumber: string;
  amount?: number;
  totalAmount: number;
  amountUsed?: number;
  creditNoteDate?: unknown;
  ledgerOnly?: boolean;
  status?: string;
  reason?: string;
  type?: string;
  orderReturnRequestId?: string;
}): WalletCreditNote | null {
  if (note.ledgerOnly === true) return null;
  const amount = roundMoney2(Number(note.amount) || Number(note.totalAmount) || 0);
  if (amount <= 0.01) return null;
  const amountUsed = roundMoney2(Number(note.amountUsed) || 0);
  const remaining = roundMoney2(amount - amountUsed);
  const statusRaw = String(note.status || 'issued');
  if (statusRaw === 'cancelled') return null;
  let status: WalletCreditNote['status'] = 'available';
  if (remaining <= 0.01) status = 'fully_used';
  const returnRequestId = note.orderReturnRequestId;
  const returnType: WalletCreditNote['returnType'] = returnRequestId
    ? 'order_return'
    : 'credit_note';
  return {
    id: note.id,
    creditNoteNumber: note.creditNoteNumber || `CN-${note.id.slice(0, 8)}`,
    amount,
    amountUsed,
    creditNoteDate: toDate(note.creditNoteDate),
    status,
    returnType,
    returnRequestId,
    reason: note.reason,
  };
}

/**
 * Wallet balance + transaction history for one retailer (matches retailer app).
 */
export async function getRetailerWalletSummary(
  retailerId: string
): Promise<RetailerWalletSummary> {
  const rid = retailerId.trim();
  if (!rid) {
    return { retailerId: '', available: 0, notes: [], debitNotes: [], transactions: [] };
  }

  const [creditNotes, debitNotesRaw, orders, orderReturns, expiryReturns] = await Promise.all([
    getCreditNotesByRetailer(rid),
    getDebitNotesByRetailer(rid),
    getOrdersByRetailer(rid),
    getOrderReturnsByRetailer(rid),
    getExpiryReturnsByRetailer(rid),
  ]);

  const dedicated = creditNotes
    .map(mapDedicatedCreditNote)
    .filter((n): n is WalletCreditNote => n != null);

  const notes = mergeWalletCreditNotes(dedicated, expiryReturns, orderReturns);

  const debitNotes: WalletDebitNote[] = debitNotesRaw
    .filter((n) => n.ledgerOnly !== true)
    .map((n) => ({
      id: n.id,
      debitNoteNumber: n.debitNoteNumber || `DN-${n.id.slice(0, 8)}`,
      amount: roundMoney2(Number(n.totalAmount) || 0),
      debitNoteDate: toDate(n.debitNoteDate),
      reason: n.reason,
    }))
    .filter((n) => n.amount > 0.01);

  const orderDebits: WalletOrderDebit[] = orders
    .map((o) => {
      const creditApplied = roundMoney2(Number((o as { creditApplied?: number }).creditApplied) || 0);
      return {
        id: o.id,
        invoiceNumber: o.invoiceNumber,
        creditApplied,
        orderDate: toDate(o.orderDate),
      };
    })
    .filter((o) => o.creditApplied > 0.01);

  const available = computeWalletAvailable(notes, debitNotes);
  const transactions = buildWalletTransactions(notes, debitNotes, orderDebits, available);

  return {
    retailerId: rid,
    available,
    notes,
    debitNotes,
    transactions,
  };
}

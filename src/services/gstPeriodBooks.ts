import { getOrdersInRange } from './orders';
import { getCreditNotesInRange } from './creditNotes';
import { getDebitNotesInRange } from './debitNotes';
import { getPurchaseInvoicesInRange } from './purchaseInvoices';
import { getPurchaseReturnsInRange } from './purchaseReturns';
import { getCompanyGstSettings } from './gstSettings';
import { gstPeriodBounds, indianGstPeriod } from '../utils/gstPeriod';
import type { CompanyGstSettings } from '../types/gst';
import type { CreditNote, DebitNote, Order, PurchaseInvoice, PurchaseReturn } from '../types';

export interface GstPeriodBooks {
  date: Date;
  startMs: number;
  endMsExclusive: number;
  settings: CompanyGstSettings;
  orders: Order[];
  creditNotes: CreditNote[];
  debitNotes: DebitNote[];
  purchases: PurchaseInvoice[];
  purchaseReturns: PurchaseReturn[];
}

const booksMemo = new Map<string, { at: number; value: GstPeriodBooks }>();
const BOOKS_TTL_MS = 30_000;

export function invalidateGstPeriodBooksCache(date?: Date) {
  if (!date) {
    booksMemo.clear();
    return;
  }
  booksMemo.delete(indianGstPeriod(date).periodId);
}

export function gstDocTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const d = new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

export function gstDocDate(value: unknown): Date {
  const t = gstDocTime(value);
  return t ? new Date(t) : new Date();
}

export async function loadGstPeriodBooks(date = new Date()): Promise<GstPeriodBooks> {
  const key = indianGstPeriod(date).periodId;
  const hit = booksMemo.get(key);
  if (hit && Date.now() - hit.at < BOOKS_TTL_MS) return hit.value;

  const { startMs, endMsExclusive } = gstPeriodBounds(date);
  const [settings, orders, creditNotes, debitNotes, purchases, purchaseReturns] = await Promise.all([
    getCompanyGstSettings(),
    getOrdersInRange(startMs, endMsExclusive),
    getCreditNotesInRange(startMs, endMsExclusive),
    getDebitNotesInRange(startMs, endMsExclusive),
    getPurchaseInvoicesInRange(startMs, endMsExclusive),
    getPurchaseReturnsInRange(startMs, endMsExclusive),
  ]);

  const value: GstPeriodBooks = {
    date,
    startMs,
    endMsExclusive,
    settings,
    orders,
    creditNotes,
    debitNotes,
    purchases,
    purchaseReturns,
  };
  booksMemo.set(key, { at: Date.now(), value });
  return value;
}

export function taxableFrom(doc: { subTotal?: number; totalDiscount?: number; discount?: number }): number {
  return Math.max(0, (Number(doc.subTotal) || 0) - (Number(doc.totalDiscount ?? doc.discount) || 0));
}

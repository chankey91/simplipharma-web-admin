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
import { getAllCreditNotes } from './creditNotes';
import { getAllDebitNotes } from './debitNotes';

/**
 * Server-side aggregation totals for note-style collections that the Dashboard
 * displays purely as sums/counts (never as document lists). Using
 * `getAggregateFromServer` avoids downloading the entire collection just to add
 * up `totalAmount`, which is a major Firestore read saver as these collections
 * grow. Firestore bills one read per batch of up to 1000 matched index entries.
 */
export interface NoteTotals {
  lifetimeSum: number;
  lifetimeCount: number;
  thisMonthSum: number;
  thisMonthCount: number;
}

function isOnOrAfterMonthStart(date: unknown, monthStart: Date): boolean {
  const d = date instanceof Date ? date : new Date(date as string);
  if (isNaN(d.getTime())) return false;
  return !isBefore(d, monthStart);
}

function sumNoteTotals(
  notes: Array<{ totalAmount?: number; createdAt?: unknown; creditNoteDate?: unknown; debitNoteDate?: unknown }>,
  dateField: 'creditNoteDate' | 'debitNoteDate',
  monthStart: Date
): NoteTotals {
  const lifetimeSum = notes.reduce((sum, n) => sum + (n.totalAmount ?? 0), 0);
  const thisMonthNotes = notes.filter((n) =>
    isOnOrAfterMonthStart((n as Record<string, unknown>)[dateField] ?? n.createdAt, monthStart)
  );
  const thisMonthSum = thisMonthNotes.reduce((sum, n) => sum + (n.totalAmount ?? 0), 0);

  return {
    lifetimeSum,
    lifetimeCount: notes.length,
    thisMonthSum,
    thisMonthCount: thisMonthNotes.length,
  };
}

async function getNoteTotalsFromDocs(
  collectionName: string,
  dateField: 'creditNoteDate' | 'debitNoteDate',
  monthStart: Date
): Promise<NoteTotals> {
  const notes =
    collectionName === 'credit_notes' ? await getAllCreditNotes() : await getAllDebitNotes();
  return sumNoteTotals(notes, dateField, monthStart);
}

async function getNoteTotals(
  collectionName: string,
  dateField: 'creditNoteDate' | 'debitNoteDate',
  monthStart: Date
): Promise<NoteTotals> {
  const col = collection(db, collectionName);

  try {
    // Lifetime figures: no filter, so no composite index is required.
    const lifetimeSnap = await getAggregateFromServer(query(col), {
      lifetimeSum: sum('totalAmount'),
      lifetimeCount: count(),
    });

    // This-month figures: single-field range filter (auto-indexed). Legacy docs
    // missing the date field are excluded, but those are old records whose
    // creation date is not in the current month, so the result matches the
    // previous in-memory `date ?? createdAt` bucketing for current data.
    const monthSnap = await getAggregateFromServer(
      query(col, where(dateField, '>=', Timestamp.fromDate(monthStart))),
      {
        thisMonthSum: sum('totalAmount'),
        thisMonthCount: count(),
      }
    );

    const lifetime = lifetimeSnap.data();
    const month = monthSnap.data();

    return {
      lifetimeSum: lifetime.lifetimeSum ?? 0,
      lifetimeCount: lifetime.lifetimeCount ?? 0,
      thisMonthSum: month.thisMonthSum ?? 0,
      thisMonthCount: month.thisMonthCount ?? 0,
    };
  } catch (err) {
    console.warn(`${collectionName} aggregation failed; falling back to client-side totals:`, err);
    return getNoteTotalsFromDocs(collectionName, dateField, monthStart);
  }
}

async function getNoteTotalsWithEmptyCheck(
  collectionName: string,
  dateField: 'creditNoteDate' | 'debitNoteDate',
  monthStart: Date
): Promise<NoteTotals> {
  const totals = await getNoteTotals(collectionName, dateField, monthStart);
  if (totals.lifetimeCount === 0 && totals.lifetimeSum === 0) {
    const fromDocs = await getNoteTotalsFromDocs(collectionName, dateField, monthStart);
    if (fromDocs.lifetimeCount > 0 || fromDocs.lifetimeSum > 0) {
      console.warn(
        `${collectionName} aggregation returned all zeros but documents exist; using client-side totals.`
      );
      return fromDocs;
    }
  }
  return totals;
}

export const getCreditNoteTotals = (monthStart: Date): Promise<NoteTotals> =>
  getNoteTotalsWithEmptyCheck('credit_notes', 'creditNoteDate', monthStart);

export const getDebitNoteTotals = (monthStart: Date): Promise<NoteTotals> =>
  getNoteTotalsWithEmptyCheck('debit_notes', 'debitNoteDate', monthStart);

/**
 * Server-side sum of all purchase invoice amounts. Used for the "Total
 * Purchases" KPI so the page doesn't download the whole collection to add it up
 * (Typesense can't do sum aggregation, so this stays on Firestore aggregation).
 */
export const getPurchaseInvoiceAmountTotal = async (): Promise<number> => {
  const col = collection(db, 'purchaseInvoices');
  const snap = await getAggregateFromServer(query(col), { total: sum('totalAmount') });
  return snap.data().total ?? 0;
};

import {
  collection,
  query,
  where,
  sum,
  count,
  getAggregateFromServer,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

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

async function getNoteTotals(
  collectionName: string,
  dateField: string,
  monthStart: Date
): Promise<NoteTotals> {
  const col = collection(db, collectionName);

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
}

export const getCreditNoteTotals = (monthStart: Date): Promise<NoteTotals> =>
  getNoteTotals('credit_notes', 'creditNoteDate', monthStart);

export const getDebitNoteTotals = (monthStart: Date): Promise<NoteTotals> =>
  getNoteTotals('debit_notes', 'debitNoteDate', monthStart);

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

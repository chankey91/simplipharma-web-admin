import {
  makeTypesenseSearch,
  makeReindexCallable,
  rawStr,
  rawNum,
  TypesenseSearchParams,
} from './typesenseSearch';

/** Lightweight row rendered by the Credit Notes table (from the Typesense index). */
export interface CreditNoteRow {
  id: string;
  creditNoteNumber: string;
  /** Credit note date as epoch milliseconds. */
  creditNoteDate: number;
  retailerName: string;
  retailerEmail: string;
  retailerId: string;
  originalInvoiceNumber: string;
  orderId: string;
  totalAmount: number;
}

export interface DebitNoteRow {
  id: string;
  debitNoteNumber: string;
  /** Debit note date as epoch milliseconds. */
  debitNoteDate: number;
  retailerName: string;
  retailerEmail: string;
  retailerId: string;
  originalInvoiceNumber: string;
  orderId: string;
  reason: string;
  sourceType: string;
  totalAmount: number;
}

export const searchCreditNotesTypesense = makeTypesenseSearch<CreditNoteRow>(
  'searchCreditNotesTypesense',
  (raw) => ({
    id: rawStr(raw.id || raw.docId),
    creditNoteNumber: rawStr(raw.creditNoteNumber),
    creditNoteDate: rawNum(raw.creditNoteDate),
    retailerName: rawStr(raw.retailerName),
    retailerEmail: rawStr(raw.retailerEmail),
    retailerId: rawStr(raw.retailerId),
    originalInvoiceNumber: rawStr(raw.originalInvoiceNumber),
    orderId: rawStr(raw.orderId),
    totalAmount: rawNum(raw.totalAmount),
  })
);

export const searchDebitNotesTypesense = makeTypesenseSearch<DebitNoteRow>(
  'searchDebitNotesTypesense',
  (raw) => ({
    id: rawStr(raw.id || raw.docId),
    debitNoteNumber: rawStr(raw.debitNoteNumber),
    debitNoteDate: rawNum(raw.debitNoteDate),
    retailerName: rawStr(raw.retailerName),
    retailerEmail: rawStr(raw.retailerEmail),
    retailerId: rawStr(raw.retailerId),
    originalInvoiceNumber: rawStr(raw.originalInvoiceNumber),
    orderId: rawStr(raw.orderId),
    reason: rawStr(raw.reason),
    sourceType: rawStr(raw.sourceType),
    totalAmount: rawNum(raw.totalAmount),
  })
);

export const reindexCreditNotesTypesense = makeReindexCallable('adminReindexCreditNotesTypesense');
export const reindexDebitNotesTypesense = makeReindexCallable('adminReindexDebitNotesTypesense');

async function searchAllNoteIds(
  search: (params: TypesenseSearchParams) => Promise<{ rows: { id: string }[]; found: number }>,
  params: Omit<TypesenseSearchParams, 'page' | 'perPage'>
): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  const perPage = 100;
  while (page <= 50) {
    const res = await search({ ...params, page, perPage });
    ids.push(...res.rows.map((r) => r.id).filter(Boolean));
    if (ids.length >= res.found || res.rows.length === 0) break;
    page += 1;
  }
  return ids;
}

/** All credit-note ids matching the current Typesense query (every page). */
export function searchAllCreditNoteIds(params: Omit<TypesenseSearchParams, 'page' | 'perPage'>) {
  return searchAllNoteIds(searchCreditNotesTypesense, params);
}

/** All debit-note ids matching the current Typesense query (every page). */
export function searchAllDebitNoteIds(params: Omit<TypesenseSearchParams, 'page' | 'perPage'>) {
  return searchAllNoteIds(searchDebitNotesTypesense, params);
}

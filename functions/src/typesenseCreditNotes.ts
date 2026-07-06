/** Typesense sync + search for `credit_notes` and `debit_notes` (see typesenseSync.ts). */
import { createTypesenseSync, tsMillis, lower } from './typesenseSync';

const creditNoteSync = createTypesenseSync({
  collectionName: 'credit_notes',
  fields: [
    { name: 'docId', type: 'string', sort: true },
    { name: 'creditNoteNumber', type: 'string', sort: true },
    { name: 'creditNoteDate', type: 'int64', sort: true },
    { name: 'retailerName', type: 'string', optional: true },
    { name: 'retailerEmail', type: 'string', optional: true },
    { name: 'retailerId', type: 'string', optional: true },
    { name: 'retailerSort', type: 'string', optional: true, sort: true },
    { name: 'originalInvoiceNumber', type: 'string', optional: true, sort: true },
    { name: 'orderId', type: 'string', optional: true },
    { name: 'totalAmount', type: 'float', sort: true },
    { name: 'search_blob', type: 'string', optional: true },
  ],
  queryBy: 'search_blob,creditNoteNumber,retailerName,retailerEmail,originalInvoiceNumber,orderId',
  sortableFields: [
    'docId',
    'creditNoteNumber',
    'creditNoteDate',
    'retailerSort',
    'originalInvoiceNumber',
    'totalAmount',
  ],
  defaultSort: 'creditNoteDate',
  buildDoc: (id, data) => {
    if (!data) return null;
    const creditNoteNumber = String(data.creditNoteNumber || '');
    const retailerName = String(data.retailerName || '');
    const retailerEmail = String(data.retailerEmail || '');
    const originalInvoiceNumber = String(data.originalInvoiceNumber || '');
    const orderId = String(data.orderId || '');
    const totalAmount =
      typeof data.totalAmount === 'number'
        ? data.totalAmount
        : parseFloat(String(data.totalAmount ?? 0)) || 0;
    const searchBlob = [creditNoteNumber, retailerName, retailerEmail, originalInvoiceNumber, orderId]
      .filter((x) => x && String(x).trim() !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return {
      id,
      docId: id,
      creditNoteNumber,
      creditNoteDate: tsMillis(data.creditNoteDate ?? data.createdAt),
      retailerName,
      retailerEmail,
      retailerId: String(data.retailerId || ''),
      retailerSort: lower(retailerName || retailerEmail),
      originalInvoiceNumber,
      orderId,
      totalAmount,
      search_blob: searchBlob,
    };
  },
});

const debitNoteSync = createTypesenseSync({
  collectionName: 'debit_notes',
  fields: [
    { name: 'docId', type: 'string', sort: true },
    { name: 'debitNoteNumber', type: 'string', sort: true },
    { name: 'debitNoteDate', type: 'int64', sort: true },
    { name: 'retailerName', type: 'string', optional: true },
    { name: 'retailerEmail', type: 'string', optional: true },
    { name: 'retailerId', type: 'string', optional: true },
    { name: 'retailerSort', type: 'string', optional: true, sort: true },
    { name: 'originalInvoiceNumber', type: 'string', optional: true, sort: true },
    { name: 'orderId', type: 'string', optional: true },
    { name: 'reason', type: 'string', optional: true },
    { name: 'sourceType', type: 'string', optional: true },
    { name: 'totalAmount', type: 'float', sort: true },
    { name: 'search_blob', type: 'string', optional: true },
  ],
  queryBy:
    'search_blob,debitNoteNumber,retailerName,retailerEmail,originalInvoiceNumber,orderId,reason',
  sortableFields: [
    'docId',
    'debitNoteNumber',
    'debitNoteDate',
    'retailerSort',
    'originalInvoiceNumber',
    'totalAmount',
  ],
  defaultSort: 'debitNoteDate',
  buildDoc: (id, data) => {
    if (!data) return null;
    const debitNoteNumber = String(data.debitNoteNumber || '');
    const retailerName = String(data.retailerName || '');
    const retailerEmail = String(data.retailerEmail || '');
    const originalInvoiceNumber = String(data.originalInvoiceNumber || '');
    const orderId = String(data.orderId || '');
    const reason = String(data.reason || '');
    const sourceType = String(data.sourceType || '');
    const totalAmount =
      typeof data.totalAmount === 'number'
        ? data.totalAmount
        : parseFloat(String(data.totalAmount ?? 0)) || 0;
    const searchBlob = [
      debitNoteNumber,
      retailerName,
      retailerEmail,
      originalInvoiceNumber,
      orderId,
      reason,
    ]
      .filter((x) => x && String(x).trim() !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return {
      id,
      docId: id,
      debitNoteNumber,
      debitNoteDate: tsMillis(data.debitNoteDate ?? data.createdAt),
      retailerName,
      retailerEmail,
      retailerId: String(data.retailerId || ''),
      retailerSort: lower(retailerName || retailerEmail),
      originalInvoiceNumber,
      orderId,
      reason,
      sourceType,
      totalAmount,
      search_blob: searchBlob,
    };
  },
});

export const onCreditNoteWriteTypesense = creditNoteSync.onWrite;
export const searchCreditNotesTypesense = creditNoteSync.search;
export const adminReindexCreditNotesTypesense = creditNoteSync.reindex;

export const onDebitNoteWriteTypesense = debitNoteSync.onWrite;
export const searchDebitNotesTypesense = debitNoteSync.search;
export const adminReindexDebitNotesTypesense = debitNoteSync.reindex;

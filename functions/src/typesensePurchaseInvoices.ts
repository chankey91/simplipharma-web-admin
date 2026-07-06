/** Typesense sync + search for `purchaseInvoices` (see typesenseSync.ts). */
import { createTypesenseSync, tsMillis } from './typesenseSync';

const purchaseInvoiceSync = createTypesenseSync({
  collectionName: 'purchaseInvoices',
  fields: [
    { name: 'docId', type: 'string', sort: true },
    { name: 'invoiceNumber', type: 'string', sort: true },
    { name: 'vendorName', type: 'string', optional: true, sort: true },
    { name: 'medicineNames', type: 'string', optional: true },
    { name: 'search_blob', type: 'string', optional: true },
    { name: 'paymentStatus', type: 'string', facet: true, sort: true },
    { name: 'invoiceDate', type: 'int64', sort: true },
    { name: 'itemCount', type: 'int32', sort: true },
    { name: 'totalAmount', type: 'float', sort: true },
  ],
  queryBy: 'search_blob,invoiceNumber,vendorName,medicineNames',
  sortableFields: [
    'docId',
    'invoiceNumber',
    'vendorName',
    'invoiceDate',
    'itemCount',
    'totalAmount',
    'paymentStatus',
  ],
  defaultSort: 'invoiceDate',
  facetField: 'paymentStatus',
  buildDoc: (id, data) => {
    if (!data) return null;
    const items = Array.isArray(data.items) ? data.items : [];
    const medicineNames = items
      .map((i: { medicineName?: unknown }) => String(i?.medicineName ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const invoiceNumber = String(data.invoiceNumber || '');
    const vendorName = String(data.vendorName || '');
    const totalAmount =
      typeof data.totalAmount === 'number'
        ? data.totalAmount
        : parseFloat(String(data.totalAmount ?? 0)) || 0;
    const searchBlob = [invoiceNumber, vendorName, medicineNames]
      .filter((x) => x && String(x).trim() !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return {
      id,
      docId: id,
      invoiceNumber,
      vendorName,
      medicineNames,
      search_blob: searchBlob,
      paymentStatus: String(data.paymentStatus || ''),
      invoiceDate: tsMillis(data.invoiceDate),
      itemCount: items.length,
      totalAmount,
    };
  },
});

export const onPurchaseInvoiceWriteTypesense = purchaseInvoiceSync.onWrite;
export const searchPurchaseInvoicesTypesense = purchaseInvoiceSync.search;
export const adminReindexPurchaseInvoicesTypesense = purchaseInvoiceSync.reindex;

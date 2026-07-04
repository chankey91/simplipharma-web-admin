"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminReindexPurchaseInvoicesTypesense = exports.searchPurchaseInvoicesTypesense = exports.onPurchaseInvoiceWriteTypesense = void 0;
/** Typesense sync + search for `purchaseInvoices` (see typesenseSync.ts). */
const typesenseSync_1 = require("./typesenseSync");
const purchaseInvoiceSync = (0, typesenseSync_1.createTypesenseSync)({
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
        var _a;
        if (!data)
            return null;
        const items = Array.isArray(data.items) ? data.items : [];
        const medicineNames = items
            .map((i) => { var _a; return String((_a = i === null || i === void 0 ? void 0 : i.medicineName) !== null && _a !== void 0 ? _a : '').trim(); })
            .filter(Boolean)
            .join(' ');
        const invoiceNumber = String(data.invoiceNumber || '');
        const vendorName = String(data.vendorName || '');
        const totalAmount = typeof data.totalAmount === 'number'
            ? data.totalAmount
            : parseFloat(String((_a = data.totalAmount) !== null && _a !== void 0 ? _a : 0)) || 0;
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
            invoiceDate: (0, typesenseSync_1.tsMillis)(data.invoiceDate),
            itemCount: items.length,
            totalAmount,
        };
    },
});
exports.onPurchaseInvoiceWriteTypesense = purchaseInvoiceSync.onWrite;
exports.searchPurchaseInvoicesTypesense = purchaseInvoiceSync.search;
exports.adminReindexPurchaseInvoicesTypesense = purchaseInvoiceSync.reindex;
//# sourceMappingURL=typesensePurchaseInvoices.js.map
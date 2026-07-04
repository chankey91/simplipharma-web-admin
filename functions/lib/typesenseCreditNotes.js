"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminReindexDebitNotesTypesense = exports.searchDebitNotesTypesense = exports.onDebitNoteWriteTypesense = exports.adminReindexCreditNotesTypesense = exports.searchCreditNotesTypesense = exports.onCreditNoteWriteTypesense = void 0;
/** Typesense sync + search for `credit_notes` and `debit_notes` (see typesenseSync.ts). */
const typesenseSync_1 = require("./typesenseSync");
const creditNoteSync = (0, typesenseSync_1.createTypesenseSync)({
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
        var _a, _b;
        if (!data)
            return null;
        const creditNoteNumber = String(data.creditNoteNumber || '');
        const retailerName = String(data.retailerName || '');
        const retailerEmail = String(data.retailerEmail || '');
        const originalInvoiceNumber = String(data.originalInvoiceNumber || '');
        const orderId = String(data.orderId || '');
        const totalAmount = typeof data.totalAmount === 'number'
            ? data.totalAmount
            : parseFloat(String((_a = data.totalAmount) !== null && _a !== void 0 ? _a : 0)) || 0;
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
            creditNoteDate: (0, typesenseSync_1.tsMillis)((_b = data.creditNoteDate) !== null && _b !== void 0 ? _b : data.createdAt),
            retailerName,
            retailerEmail,
            retailerId: String(data.retailerId || ''),
            retailerSort: (0, typesenseSync_1.lower)(retailerName || retailerEmail),
            originalInvoiceNumber,
            orderId,
            totalAmount,
            search_blob: searchBlob,
        };
    },
});
const debitNoteSync = (0, typesenseSync_1.createTypesenseSync)({
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
    queryBy: 'search_blob,debitNoteNumber,retailerName,retailerEmail,originalInvoiceNumber,orderId,reason',
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
        var _a, _b;
        if (!data)
            return null;
        const debitNoteNumber = String(data.debitNoteNumber || '');
        const retailerName = String(data.retailerName || '');
        const retailerEmail = String(data.retailerEmail || '');
        const originalInvoiceNumber = String(data.originalInvoiceNumber || '');
        const orderId = String(data.orderId || '');
        const reason = String(data.reason || '');
        const sourceType = String(data.sourceType || '');
        const totalAmount = typeof data.totalAmount === 'number'
            ? data.totalAmount
            : parseFloat(String((_a = data.totalAmount) !== null && _a !== void 0 ? _a : 0)) || 0;
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
            debitNoteDate: (0, typesenseSync_1.tsMillis)((_b = data.debitNoteDate) !== null && _b !== void 0 ? _b : data.createdAt),
            retailerName,
            retailerEmail,
            retailerId: String(data.retailerId || ''),
            retailerSort: (0, typesenseSync_1.lower)(retailerName || retailerEmail),
            originalInvoiceNumber,
            orderId,
            reason,
            sourceType,
            totalAmount,
            search_blob: searchBlob,
        };
    },
});
exports.onCreditNoteWriteTypesense = creditNoteSync.onWrite;
exports.searchCreditNotesTypesense = creditNoteSync.search;
exports.adminReindexCreditNotesTypesense = creditNoteSync.reindex;
exports.onDebitNoteWriteTypesense = debitNoteSync.onWrite;
exports.searchDebitNotesTypesense = debitNoteSync.search;
exports.adminReindexDebitNotesTypesense = debitNoteSync.reindex;
//# sourceMappingURL=typesenseCreditNotes.js.map
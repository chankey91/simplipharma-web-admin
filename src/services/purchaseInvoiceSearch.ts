import { PaymentStatus } from '../types';
import { makeTypesenseSearch, makeReindexCallable, rawStr, rawNum } from './typesenseSearch';

/** Lightweight row rendered by the Purchase Invoices table (from the Typesense index). */
export interface PurchaseInvoiceRow {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  /** Invoice date as epoch milliseconds. */
  invoiceDate: number;
  itemCount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus | '';
}

export const searchPurchaseInvoicesTypesense = makeTypesenseSearch<PurchaseInvoiceRow>(
  'searchPurchaseInvoicesTypesense',
  (raw) => ({
    id: rawStr(raw.id || raw.docId),
    invoiceNumber: rawStr(raw.invoiceNumber),
    vendorName: rawStr(raw.vendorName),
    invoiceDate: rawNum(raw.invoiceDate),
    itemCount: rawNum(raw.itemCount),
    totalAmount: rawNum(raw.totalAmount),
    paymentStatus: rawStr(raw.paymentStatus) as PaymentStatus | '',
  })
);

export const reindexPurchaseInvoicesTypesense = makeReindexCallable(
  'adminReindexPurchaseInvoicesTypesense'
);

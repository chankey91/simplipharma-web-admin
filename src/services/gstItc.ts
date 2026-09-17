import { loadGstPeriodBooks, gstDocDate } from './gstPeriodBooks';
import { hasGstSnapshot } from '../utils/gstSnapshot';
import { isValidGstinFormat, normalizeGstin } from '../utils/gstin';
import {
  itcEligibleTotal,
  matchGstr2b,
  parseGstr2bJson,
  type Gst2bMatchRow,
  type GstItcBookRow,
} from '../utils/gstr2bMatch';

export async function loadGstItcBooks(date = new Date()): Promise<GstItcBookRow[]> {
  const books = await loadGstPeriodBooks(date);
  return books.purchases.map((invoice) => {
    const gst = hasGstSnapshot(invoice) ? invoice.gst : undefined;
    return {
      id: invoice.id,
      vendorName: invoice.vendorName,
      vendorGstin: normalizeGstin(gst?.sellerGstin || invoice.vendorGstin),
      invoiceNumber: invoice.invoiceNumber,
      vendorInvoiceNumber: invoice.vendorInvoiceNumber,
      date: gstDocDate(invoice.invoiceDate),
      taxableValue: gst?.taxableValue ?? Math.max(0, (invoice.subTotal || 0) - (invoice.discount || 0)),
      cgst: gst?.cgst ?? 0,
      sgst: gst?.sgst ?? 0,
      igst: gst?.igst ?? 0,
      cess: gst?.cess ?? 0,
      totalAmount: invoice.totalAmount || 0,
      hasSnapshot: Boolean(gst),
    };
  });
}

export async function reconcileGstr2b(
  date: Date,
  portalJson: unknown
): Promise<{
  rows: Gst2bMatchRow[];
  itc: ReturnType<typeof itcEligibleTotal>;
  portalCount: number;
}> {
  const books = await loadGstItcBooks(date);
  const portal = parseGstr2bJson(portalJson);
  return {
    rows: matchGstr2b(books, portal),
    itc: itcEligibleTotal(books),
    portalCount: portal.length,
  };
}

export { isValidGstinFormat };

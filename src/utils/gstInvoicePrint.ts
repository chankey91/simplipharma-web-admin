import type { GstDocumentSnapshot } from '../types/gst';
import { gstStateName } from './gstin';
import { DEFAULT_INVOICE_STATE, DEFAULT_INVOICE_STATE_CODE, resolveInvoiceState } from './invoicePartyDefaults';
import { hasGstSnapshot } from './gstSnapshot';

/** Use stored snapshot when present; otherwise the historical CGST/SGST half-split. */
export function printTaxFromDocument(doc: {
  gst?: GstDocumentSnapshot;
  taxAmount: number;
}): { cgst: number; sgst: number; igst: number } {
  if (hasGstSnapshot(doc)) {
    return { cgst: doc.gst!.cgst, sgst: doc.gst!.sgst, igst: doc.gst!.igst };
  }
  const half = (Number(doc.taxAmount) || 0) / 2;
  return { cgst: half, sgst: half, igst: 0 };
}

export function printBuyerStateFromDocument(
  doc: { gst?: GstDocumentSnapshot },
  fallbackGstin?: string
): { state: string; stateCode: string; gstin: string } {
  if (hasGstSnapshot(doc) && doc.gst) {
    return {
      state: gstStateName(doc.gst.placeOfSupplyStateCode) || DEFAULT_INVOICE_STATE,
      stateCode: doc.gst.placeOfSupplyStateCode || DEFAULT_INVOICE_STATE_CODE,
      gstin: doc.gst.buyerGstin || fallbackGstin || '',
    };
  }
  return {
    ...resolveInvoiceState(),
    gstin: fallbackGstin || '',
  };
}

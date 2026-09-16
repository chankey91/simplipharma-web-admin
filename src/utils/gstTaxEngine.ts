import type { GstInvoiceType, GstSupplyType, GstTaxBreakup } from '../types/gst';
import { isValidGstinFormat, normalizeStateCode } from './gstin';
import { getTodayDateStringIST } from './dateTime';

export function roundGst(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function resolveSupplyType(
  supplierStateCode?: string | null,
  placeOfSupplyStateCode?: string | null
): GstSupplyType {
  const supplier = normalizeStateCode(supplierStateCode);
  const pos = normalizeStateCode(placeOfSupplyStateCode);
  if (!supplier || !pos) return 'intra';
  return supplier === pos ? 'intra' : 'inter';
}

/**
 * Split an already-computed tax amount so document totals never change.
 * Intra-state → CGST + SGST; inter-state → IGST.
 */
export function splitExistingTaxAmount(
  taxAmount: number,
  supplierStateCode?: string | null,
  placeOfSupplyStateCode?: string | null,
  taxableValue = 0
): GstTaxBreakup {
  const tax = roundGst(taxAmount);
  const taxable = roundGst(taxableValue);
  const supplyType = resolveSupplyType(supplierStateCode, placeOfSupplyStateCode);
  if (supplyType === 'inter') {
    return { taxableValue: taxable, cgst: 0, sgst: 0, igst: tax, cess: 0, taxAmount: tax };
  }
  const cgst = roundGst(tax / 2);
  const sgst = roundGst(tax - cgst);
  return { taxableValue: taxable, cgst, sgst, igst: 0, cess: 0, taxAmount: tax };
}

export function computeSupplyTax(input: {
  taxableValue: number;
  gstRate: number;
  cessRate?: number;
  supplierStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
}): GstTaxBreakup {
  const taxableValue = roundGst(input.taxableValue);
  const taxAmount = roundGst(taxableValue * ((Number(input.gstRate) || 0) / 100));
  const cess = roundGst(taxableValue * ((Number(input.cessRate) || 0) / 100));
  const split = splitExistingTaxAmount(
    taxAmount,
    input.supplierStateCode,
    input.placeOfSupplyStateCode,
    taxableValue
  );
  return { ...split, cess, taxAmount: roundGst(split.taxAmount + cess) };
}

/** Inter-state unregistered: ₹2.5L until Jul 2024, ₹1L from Aug 2024 return period. */
export function b2clThreshold(invoiceDate?: Date | null): number {
  if (!invoiceDate || Number.isNaN(invoiceDate.getTime())) return 100000;
  const ym = getTodayDateStringIST(invoiceDate).slice(0, 7);
  return ym >= '2024-08' ? 100000 : 250000;
}

export function classifyOutwardInvoice(input: {
  buyerGstin?: string | null;
  supplyType: GstSupplyType;
  totalAmount: number;
  documentKind: 'invoice' | 'credit_note' | 'debit_note';
  invoiceDate?: Date | null;
}): GstInvoiceType {
  const registered = isValidGstinFormat(input.buyerGstin);
  if (input.documentKind === 'credit_note' || input.documentKind === 'debit_note') {
    return registered ? 'CDNR' : 'CDNUR';
  }
  if (registered) return 'B2B';
  if (input.supplyType === 'inter' && input.totalAmount >= b2clThreshold(input.invoiceDate)) {
    return 'B2CL';
  }
  return 'B2CS';
}

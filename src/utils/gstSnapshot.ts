import type { GstDocumentSnapshot, GstInvoiceType, GstLineSnapshot } from '../types/gst';
import { isValidGstinFormat, normalizeGstin, gstinStateCode, normalizeStateCode } from './gstin';
import { classifyOutwardInvoice, resolveSupplyType, splitExistingTaxAmount } from './gstTaxEngine';
import type { CompanyGstSettings } from '../types/gst';

export function hasGstSnapshot(doc: { gst?: GstDocumentSnapshot | null }): boolean {
  return Boolean(doc?.gst?.sellerGstin && doc.gst.capturedAt);
}

export function buildGstSnapshot(input: {
  settings: CompanyGstSettings;
  taxAmount: number;
  taxableValue: number;
  totalAmount: number;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
  documentKind: 'invoice' | 'credit_note' | 'debit_note' | 'inward';
  invoiceDate?: Date | null;
  lines?: GstLineSnapshot[];
}): GstDocumentSnapshot {
  const sellerGstin = normalizeGstin(input.settings.gstin);
  const buyerGstin = isValidGstinFormat(input.buyerGstin)
    ? normalizeGstin(input.buyerGstin)
    : undefined;
  const supplierStateCode =
    normalizeStateCode(input.settings.stateCode) ||
    gstinStateCode(sellerGstin) ||
    '23';
  const placeOfSupplyStateCode =
    gstinStateCode(buyerGstin) || supplierStateCode;
  const supplyType = resolveSupplyType(supplierStateCode, placeOfSupplyStateCode);
  const split = splitExistingTaxAmount(
    input.taxAmount,
    supplierStateCode,
    placeOfSupplyStateCode,
    input.taxableValue
  );

  let invoiceType: GstInvoiceType = 'INWARD';
  if (input.documentKind !== 'inward') {
    invoiceType = classifyOutwardInvoice({
      buyerGstin,
      supplyType,
      totalAmount: input.totalAmount,
      documentKind: input.documentKind,
      invoiceDate: input.invoiceDate,
    });
  }

  return {
    sellerGstin,
    ...(buyerGstin ? { buyerGstin } : {}),
    ...(input.buyerLegalName?.trim()
      ? { buyerLegalName: input.buyerLegalName.trim() }
      : {}),
    supplierStateCode,
    placeOfSupplyStateCode,
    supplyType,
    invoiceType,
    reverseCharge: false,
    taxableValue: split.taxableValue,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    cess: split.cess,
    capturedAt: new Date().toISOString(),
    source: 'live',
    ...(input.lines?.length ? { lines: input.lines } : {}),
  };
}

/** Inward supply: vendor is seller, company is buyer. Totals are not recalculated. */
export function buildInwardGstSnapshot(input: {
  settings: CompanyGstSettings;
  taxAmount: number;
  taxableValue: number;
  vendorGstin?: string | null;
  vendorName?: string | null;
  lines?: GstLineSnapshot[];
}): GstDocumentSnapshot {
  const buyerGstin = normalizeGstin(input.settings.gstin);
  const sellerGstin = isValidGstinFormat(input.vendorGstin)
    ? normalizeGstin(input.vendorGstin)
    : '';
  const supplierStateCode =
    gstinStateCode(sellerGstin) ||
    normalizeStateCode(input.settings.stateCode) ||
    '23';
  const placeOfSupplyStateCode =
    gstinStateCode(buyerGstin) ||
    normalizeStateCode(input.settings.stateCode) ||
    supplierStateCode;
  const supplyType = resolveSupplyType(supplierStateCode, placeOfSupplyStateCode);
  const split = splitExistingTaxAmount(
    input.taxAmount,
    supplierStateCode,
    placeOfSupplyStateCode,
    input.taxableValue
  );
  return {
    sellerGstin,
    buyerGstin,
    ...(input.vendorName?.trim() ? { buyerLegalName: input.settings.legalName } : {}),
    supplierStateCode,
    placeOfSupplyStateCode,
    supplyType,
    invoiceType: 'INWARD',
    reverseCharge: false,
    taxableValue: split.taxableValue,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    cess: split.cess,
    capturedAt: new Date().toISOString(),
    source: 'live',
    ...(input.lines?.length ? { lines: input.lines } : {}),
  };
}

/**
 * Snapshot matching how historical invoices were printed: intra-state split of the
 * existing taxAmount, place of supply = company state. Totals are never recalculated.
 */
export function buildFaithfulOutwardSnapshot(input: {
  settings: CompanyGstSettings;
  taxAmount: number;
  taxableValue: number;
  totalAmount: number;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
  documentKind: 'invoice' | 'credit_note' | 'debit_note';
}): GstDocumentSnapshot {
  const sellerGstin = normalizeGstin(input.settings.gstin);
  const supplierStateCode =
    normalizeStateCode(input.settings.stateCode) ||
    gstinStateCode(sellerGstin) ||
    '23';
  const buyerGstin = isValidGstinFormat(input.buyerGstin)
    ? normalizeGstin(input.buyerGstin)
    : undefined;
  const split = splitExistingTaxAmount(
    input.taxAmount,
    supplierStateCode,
    supplierStateCode,
    input.taxableValue
  );
  return {
    sellerGstin,
    ...(buyerGstin ? { buyerGstin } : {}),
    ...(input.buyerLegalName?.trim()
      ? { buyerLegalName: input.buyerLegalName.trim() }
      : {}),
    supplierStateCode,
    placeOfSupplyStateCode: supplierStateCode,
    supplyType: 'intra',
    invoiceType: classifyOutwardInvoice({
      buyerGstin,
      supplyType: 'intra',
      totalAmount: input.totalAmount,
      documentKind: input.documentKind,
    }),
    reverseCharge: false,
    taxableValue: split.taxableValue,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    cess: split.cess,
    capturedAt: new Date().toISOString(),
    source: 'backfill_faithful',
  };
}

export function buildFaithfulInwardSnapshot(input: {
  settings: CompanyGstSettings;
  taxAmount: number;
  taxableValue: number;
  vendorGstin?: string | null;
  vendorName?: string | null;
}): GstDocumentSnapshot {
  const live = buildInwardGstSnapshot(input);
  const supplierStateCode =
    normalizeStateCode(input.settings.stateCode) || live.placeOfSupplyStateCode;
  const split = splitExistingTaxAmount(
    input.taxAmount,
    supplierStateCode,
    supplierStateCode,
    input.taxableValue
  );
  return {
    ...live,
    supplierStateCode,
    placeOfSupplyStateCode: supplierStateCode,
    supplyType: 'intra',
    cgst: split.cgst,
    sgst: split.sgst,
    igst: 0,
    cess: split.cess,
    capturedAt: new Date().toISOString(),
    source: 'backfill_faithful',
  };
}

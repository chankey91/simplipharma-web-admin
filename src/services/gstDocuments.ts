import type { GstDocumentSnapshot, GstLineSnapshot } from '../types/gst';
import { buildGstSnapshot, buildInwardGstSnapshot } from '../utils/gstSnapshot';
import { getCompanyGstSettings } from './gstSettings';

export async function createOutwardGstSnapshot(input: {
  taxAmount: number;
  taxableValue: number;
  totalAmount: number;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
  documentKind: 'invoice' | 'credit_note' | 'debit_note';
  invoiceDate?: Date | null;
  lines?: GstLineSnapshot[];
}): Promise<GstDocumentSnapshot> {
  const settings = await getCompanyGstSettings();
  return buildGstSnapshot({ settings, ...input });
}

export async function createInwardGstSnapshot(input: {
  taxAmount: number;
  taxableValue: number;
  vendorGstin?: string | null;
  vendorName?: string | null;
  lines?: GstLineSnapshot[];
}): Promise<GstDocumentSnapshot> {
  const settings = await getCompanyGstSettings();
  return buildInwardGstSnapshot({ settings, ...input });
}

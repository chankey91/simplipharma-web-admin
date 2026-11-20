import type { GstDocumentSnapshot, GstLineSnapshot } from '../types/gst';
import {
  companySettingsForAlternateFirm,
  isAlternateSellingFirm,
} from '../constants/sellingFirms';
import { buildGstSnapshot, buildInwardGstSnapshot } from '../utils/gstSnapshot';
import { getCompanyGstSettings } from './gstSettings';

async function settingsForFirm(firmId?: string | null) {
  if (isAlternateSellingFirm(firmId)) return companySettingsForAlternateFirm(firmId as string);
  return getCompanyGstSettings();
}

export async function createOutwardGstSnapshot(input: {
  taxAmount: number;
  taxableValue: number;
  totalAmount: number;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
  documentKind: 'invoice' | 'credit_note' | 'debit_note';
  invoiceDate?: Date | null;
  lines?: GstLineSnapshot[];
  /** Omit or pass Sumukh to keep the current GST settings. */
  firmId?: string | null;
}): Promise<GstDocumentSnapshot> {
  const { firmId, ...snapshotInput } = input;
  const settings = await settingsForFirm(firmId);
  return buildGstSnapshot({ settings, ...snapshotInput });
}

export async function createInwardGstSnapshot(input: {
  taxAmount: number;
  taxableValue: number;
  vendorGstin?: string | null;
  vendorName?: string | null;
  lines?: GstLineSnapshot[];
  /** Omit or pass Sumukh to keep the current GST settings. */
  firmId?: string | null;
}): Promise<GstDocumentSnapshot> {
  const { firmId, ...snapshotInput } = input;
  const settings = await settingsForFirm(firmId);
  return buildInwardGstSnapshot({ settings, ...snapshotInput });
}

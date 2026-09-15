/** GST compliance types. Snapshots are additive and written only on new documents. */

export type GstSupplyType = 'intra' | 'inter';

export type GstInvoiceType = 'B2B' | 'B2CS' | 'B2CL' | 'CDNR' | 'CDNUR' | 'INWARD';

export type GstFilingFrequency = 'monthly' | 'qrmp';

export type GstPeriodStatus = 'open' | 'locked' | 'gstr1_ready' | 'gstr1_filed' | 'gstr3b_filed';

export interface GstTaxBreakup {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** cgst + sgst + igst + cess — must match the document's existing taxAmount. */
  taxAmount: number;
}

/** Per-line HSN / rate / taxable written on new documents (not backfilled). */
export interface GstLineSnapshot {
  hsn: string;
  gstRate: number;
  qty: number;
  taxableValue: number;
  taxAmount: number;
}

export interface GstDocumentSnapshot {
  sellerGstin: string;
  buyerGstin?: string;
  buyerLegalName?: string;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  supplyType: GstSupplyType;
  invoiceType: GstInvoiceType;
  reverseCharge: boolean;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  capturedAt: string;
  /** live = written at fulfill/create; backfill_faithful = later snapshot matching the issued bill. */
  source?: 'live' | 'backfill_faithful';
  /** Line grain for GSTR-1 itms / HSN. Omitted on faithful backfill of old bills. */
  lines?: GstLineSnapshot[];
  irn?: string;
  irnAckNo?: string;
  irnAckDate?: string;
}

export interface CompanyGstSettings {
  id: string;
  legalName: string;
  tradeName?: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  pincode?: string;
  phone?: string;
  email?: string;
  dl?: string;
  filingFrequency: GstFilingFrequency;
  einvoiceEnabled: boolean;
  fyStartMonth: number;
  updatedAt?: Date | any;
  updatedBy?: string;
}

export interface GstFiledFingerprint {
  collection: string;
  documentId: string;
  number: string;
  date: string;
  totalAmount: number;
  taxableValue: number;
  invoiceType: string;
  buyerGstin?: string;
  taxAmount: number;
}

export interface GstPeriod {
  id: string;
  fy: string;
  year: number;
  month: number;
  status: GstPeriodStatus;
  lockedAt?: Date | any;
  lockedBy?: string;
  gstr1ExportedAt?: Date | any;
  gstr1Filename?: string;
  gstr1PayloadHash?: string;
  gstr1ByteLength?: number;
  gstr1ExportedBy?: string;
  gstr1Arn?: string;
  gstr3bExportedAt?: Date | any;
  gstr3bArn?: string;
  einvoiceExportedAt?: Date | any;
  outwardFingerprints?: GstFiledFingerprint[];
}

export type GstExceptionSeverity = 'error' | 'warning' | 'info';

export interface GstException {
  id: string;
  severity: GstExceptionSeverity;
  kind: string;
  documentType: string;
  documentId: string;
  documentNumber?: string;
  message: string;
  actionLabel?: string;
  actionPath?: string;
  actionKind?: 'navigate' | 'backfill' | 'editGstin';
}

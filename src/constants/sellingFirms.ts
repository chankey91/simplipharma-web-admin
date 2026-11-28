import type { CompanyGstSettings } from '../types/gst';
import { COMPANY_INVOICE_DETAILS, DEFAULT_INVOICE_STATE, DEFAULT_INVOICE_STATE_CODE } from '../utils/invoicePartyDefaults';
import { normalizeGstin } from '../utils/gstin';

/** Current selling firm. Missing firm on a document means this one. */
export const SUMUKH_FIRM_ID = 'sumukh';

/** Second firm, used only when a document is explicitly issued under it. */
export const SANCHET_DAWA_FIRM_ID = 'sanchet-dawa';

export const DEFAULT_SELLING_FIRM_ID = SUMUKH_FIRM_ID;

export type SellingFirmId = typeof SUMUKH_FIRM_ID | typeof SANCHET_DAWA_FIRM_ID;

export type SellingDocumentKind = 'sales' | 'credit' | 'debit' | 'purchase' | 'purchaseReturn';

export type SellingFirm = {
  id: SellingFirmId;
  label: string;
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  dl: string;
  upiId?: string;
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
};

const yearMonth = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}${month}`;
};

export const SELLING_FIRMS: SellingFirm[] = [
  {
    id: SUMUKH_FIRM_ID,
    label: 'Sumukh Pharma Agency',
    legalName: COMPANY_INVOICE_DETAILS.name,
    tradeName: 'Sumukh Pharma Agency',
    gstin: COMPANY_INVOICE_DETAILS.gstin,
    address: COMPANY_INVOICE_DETAILS.address,
    state: DEFAULT_INVOICE_STATE,
    stateCode: DEFAULT_INVOICE_STATE_CODE,
    pincode: '452012',
    phone: COMPANY_INVOICE_DETAILS.phone,
    email: COMPANY_INVOICE_DETAILS.email,
    dl: COMPANY_INVOICE_DETAILS.dl,
  },
  {
    id: SANCHET_DAWA_FIRM_ID,
    label: 'Sanchet Pharmaceuticals and Solutions',
    legalName: 'Sanchet Pharmaceuticals and Solutions',
    tradeName: 'Sanchet Pharmaceuticals and Solutions',
    gstin: '23HMVPS8833M2ZT',
    address: '3rd Floor, Shop No.64, Dawa Bazar, 13-14, Rnt Marg, Tehsil: Indore, District: Indore 452001',
    state: 'Madhya Pradesh',
    stateCode: '23',
    pincode: '452001',
    phone: '+919179975530, +918319369626',
    email: 'simplipharma.2025@gmail.com',
    dl: '20B/1862/67/2026, 21B/1863/67/2026',
    upiId: 'sanchet@idfcbank',
    accountName: 'Sanchet Pharmaceuticals and Solutions',
    bankName: 'IDFC',
    accountNumber: '50804199260',
    ifsc: 'IDFB0041277',
  },
];

const PREFIX: Record<SellingFirmId, Record<SellingDocumentKind, string>> = {
  [SUMUKH_FIRM_ID]: {
    sales: 'SPS',
    credit: 'SPC',
    debit: 'SPD',
    purchase: 'SPP',
    purchaseReturn: 'SPR',
  },
  [SANCHET_DAWA_FIRM_ID]: {
    sales: 'SNS',
    credit: 'SNC',
    debit: 'SND',
    purchase: 'SNP',
    purchaseReturn: 'SNR',
  },
};

/** Blank or Sumukh matches every bill that was not issued under the second firm. */
export function matchesSellingFirmFilter(
  documentFirmId: string | null | undefined,
  filter: string
): boolean {
  if (!filter || filter === 'All') return true;
  if (filter === SUMUKH_FIRM_ID) return !isAlternateSellingFirm(documentFirmId);
  return documentFirmId === filter;
}

export function resolveSellingFirm(id?: string | null): SellingFirm {
  return SELLING_FIRMS.find((firm) => firm.id === id) || SELLING_FIRMS[0];
}

/** True only for the second firm. Sumukh and blank keep today's code path. */
export function isAlternateSellingFirm(id?: string | null): boolean {
  return id === SANCHET_DAWA_FIRM_ID;
}

export function sellingNumberPrefix(firmId: string | null | undefined, kind: SellingDocumentKind): string | undefined {
  if (!isAlternateSellingFirm(firmId)) return undefined;
  return `${PREFIX[SANCHET_DAWA_FIRM_ID][kind]}${yearMonth()}`;
}

export function companySettingsForAlternateFirm(firmId: string): CompanyGstSettings {
  const firm = resolveSellingFirm(firmId);
  return {
    id: firm.id,
    legalName: firm.legalName,
    tradeName: firm.tradeName,
    gstin: normalizeGstin(firm.gstin),
    address: firm.address,
    state: firm.state,
    stateCode: firm.stateCode,
    pincode: firm.pincode,
    phone: firm.phone,
    email: firm.email,
    dl: firm.dl,
    accountName: firm.accountName,
    bankName: firm.bankName,
    accountNumber: firm.accountNumber,
    ifsc: firm.ifsc,
    upiId: firm.upiId,
    filingFrequency: 'qrmp',
    einvoiceEnabled: false,
    fyStartMonth: 4,
  };
}

export function printedCompanyFromFirm(firmId?: string | null): {
  name: string;
  address: string;
  phone: string;
  email: string;
  dl: string;
  gstin: string;
} | null {
  if (!isAlternateSellingFirm(firmId)) return null;
  const firm = resolveSellingFirm(firmId);
  return {
    name: firm.legalName,
    address: firm.address,
    phone: firm.phone,
    email: firm.email,
    dl: firm.dl,
    gstin: firm.gstin,
  };
}

const alternateFirmGstin = () => normalizeGstin(resolveSellingFirm(SANCHET_DAWA_FIRM_ID).gstin);

/**
 * Default (Sumukh) returns keep every bill except ones stamped with the second firm's GSTIN.
 * That exclusion does nothing until a bill is actually issued under the second firm.
 * The second firm's return contains only its own GSTIN.
 */
export function documentBelongsToFirmReturn(
  partyGstin: string | undefined,
  firmId?: string | null
): boolean {
  const party = normalizeGstin(partyGstin || '');
  const alternate = alternateFirmGstin();
  if (isAlternateSellingFirm(firmId)) return party === alternate;
  if (!party) return true;
  return party !== alternate;
}

export function outwardBelongsToFirm(
  doc: { sellingFirmId?: string | null; gst?: { sellerGstin?: string } | null },
  firmId?: string | null
): boolean {
  if (isAlternateSellingFirm(firmId)) {
    return isAlternateSellingFirm(doc.sellingFirmId) || documentBelongsToFirmReturn(doc.gst?.sellerGstin, firmId);
  }
  if (isAlternateSellingFirm(doc.sellingFirmId)) return false;
  return documentBelongsToFirmReturn(doc.gst?.sellerGstin, firmId);
}

export function inwardBelongsToFirm(
  doc: { sellingFirmId?: string | null; gst?: { buyerGstin?: string } | null },
  firmId?: string | null
): boolean {
  if (isAlternateSellingFirm(firmId)) {
    return isAlternateSellingFirm(doc.sellingFirmId) || documentBelongsToFirmReturn(doc.gst?.buyerGstin, firmId);
  }
  if (isAlternateSellingFirm(doc.sellingFirmId)) return false;
  return documentBelongsToFirmReturn(doc.gst?.buyerGstin, firmId);
}

/** Auto internal purchase numbers. A typed vendor bill number is left alone. */
export function isGeneratedPurchaseNumber(value: string): boolean {
  return /^(SPP|SNP)\d{9}$/.test(value.trim());
}

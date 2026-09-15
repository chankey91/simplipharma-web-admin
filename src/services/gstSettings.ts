import { doc, getDoc, setDoc, serverTimestamp, db, auth } from './firebase';
import type { CompanyGstSettings, GstFilingFrequency } from '../types/gst';
import { COMPANY_INVOICE_DETAILS, DEFAULT_INVOICE_STATE, DEFAULT_INVOICE_STATE_CODE } from '../utils/invoicePartyDefaults';
import { gstinStateCode, gstStateName, isValidGstinFormat, normalizeGstin, normalizeStateCode } from '../utils/gstin';
import { stripUndefinedDeep } from '../utils/firestorePayload';

export const COMPANY_GST_SETTINGS_ID = 'default';
const COLLECTION = 'company_gst_settings';

export function defaultCompanyGstSettings(): CompanyGstSettings {
  const gstin = normalizeGstin(COMPANY_INVOICE_DETAILS.gstin);
  const stateCode = gstinStateCode(gstin) || DEFAULT_INVOICE_STATE_CODE;
  return {
    id: COMPANY_GST_SETTINGS_ID,
    legalName: COMPANY_INVOICE_DETAILS.name,
    tradeName: 'Sumukh Pharma Agency',
    gstin,
    address: COMPANY_INVOICE_DETAILS.address,
    state: gstStateName(stateCode) || DEFAULT_INVOICE_STATE,
    stateCode,
    phone: COMPANY_INVOICE_DETAILS.phone,
    email: COMPANY_INVOICE_DETAILS.email,
    dl: COMPANY_INVOICE_DETAILS.dl,
    filingFrequency: 'monthly',
    einvoiceEnabled: false,
    fyStartMonth: 4,
  };
}

function parseSettings(id: string, data: Record<string, unknown>): CompanyGstSettings {
  const defaults = defaultCompanyGstSettings();
  const gstin = normalizeGstin((data.gstin as string) || defaults.gstin);
  const stateCode =
    normalizeStateCode(data.stateCode as string) || gstinStateCode(gstin) || defaults.stateCode;
  return {
    ...defaults,
    id,
    legalName: String(data.legalName || defaults.legalName),
    tradeName: data.tradeName ? String(data.tradeName) : defaults.tradeName,
    gstin,
    address: String(data.address || defaults.address),
    state: String(data.state || gstStateName(stateCode) || defaults.state),
    stateCode,
    pincode: data.pincode ? String(data.pincode) : undefined,
    phone: data.phone ? String(data.phone) : defaults.phone,
    email: data.email ? String(data.email) : defaults.email,
    dl: data.dl ? String(data.dl) : defaults.dl,
    filingFrequency: (data.filingFrequency as GstFilingFrequency) || 'monthly',
    einvoiceEnabled: data.einvoiceEnabled === true,
    fyStartMonth: Number(data.fyStartMonth) || 4,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
  };
}

export async function getCompanyGstSettings(): Promise<CompanyGstSettings> {
  const snap = await getDoc(doc(db, COLLECTION, COMPANY_GST_SETTINGS_ID));
  if (!snap.exists()) return defaultCompanyGstSettings();
  return parseSettings(snap.id, snap.data() as Record<string, unknown>);
}

export async function saveCompanyGstSettings(
  input: Omit<CompanyGstSettings, 'id' | 'updatedAt' | 'updatedBy'>
): Promise<CompanyGstSettings> {
  const gstin = normalizeGstin(input.gstin);
  if (!isValidGstinFormat(gstin)) {
    throw new Error('Enter a valid 15-character company GSTIN');
  }
  const stateCode = normalizeStateCode(input.stateCode) || gstinStateCode(gstin) || '23';
  const payload = stripUndefinedDeep({
    legalName: input.legalName.trim(),
    tradeName: input.tradeName?.trim() || undefined,
    gstin,
    address: input.address.trim(),
    state: input.state.trim() || gstStateName(stateCode),
    stateCode,
    pincode: input.pincode?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    dl: input.dl?.trim() || undefined,
    filingFrequency: input.filingFrequency || 'monthly',
    einvoiceEnabled: input.einvoiceEnabled === true,
    fyStartMonth: input.fyStartMonth || 4,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || undefined,
  });
  await setDoc(doc(db, COLLECTION, COMPANY_GST_SETTINGS_ID), payload, { merge: true });
  return parseSettings(COMPANY_GST_SETTINGS_ID, payload as Record<string, unknown>);
}

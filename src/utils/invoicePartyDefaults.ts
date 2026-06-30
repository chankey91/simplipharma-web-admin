export const DEFAULT_INVOICE_STATE = 'Madhya Pradesh';
export const DEFAULT_INVOICE_STATE_CODE = '23';

/** Issuer details on sales/purchase GST invoices, credit notes, and debit notes. */
export const COMPANY_INVOICE_DETAILS = {
  name: 'Sanchet Pharmaceuticals and Solutions (Sumukh Pharma Agency)',
  address: 'E2-303, Treasure Vihar, Bijalpur, Indore, Madhya Pradesh. 452012',
  phone: '+918319369626',
  email: 'simplipharma.2025@gmail.com',
  dl: '20B/49/16/2014, 21B/50/16/2014',
  gstin: '23BYDPP3423L1ZF',
};

export function resolveInvoiceState(state?: string, stateCode?: string) {
  return {
    state: state?.trim() || DEFAULT_INVOICE_STATE,
    stateCode: stateCode?.trim() || DEFAULT_INVOICE_STATE_CODE,
  };
}

export function invoiceStateHtml(state?: string, stateCode?: string): string {
  const resolved = resolveInvoiceState(state, stateCode);
  return `State: ${resolved.state}<br>\n      State Code: ${resolved.stateCode}<br>`;
}

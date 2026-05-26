export const DEFAULT_INVOICE_STATE = 'Madhya Pradesh';
export const DEFAULT_INVOICE_STATE_CODE = '23';

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

/** Indian GSTIN helpers. Format only — does not call the GST portal. */

export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export function normalizeGstin(raw?: string | null): string {
  return String(raw || '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function isValidGstinFormat(raw?: string | null): boolean {
  const gstin = normalizeGstin(raw);
  return GSTIN_FORMAT.test(gstin);
}

export function gstinStateCode(raw?: string | null): string | undefined {
  const gstin = normalizeGstin(raw);
  if (gstin.length < 2) return undefined;
  const code = gstin.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : undefined;
}

export function gstStateName(stateCode?: string | null): string {
  const code = String(stateCode || '').padStart(2, '0');
  return GST_STATE_NAMES[code] || '';
}

export function normalizeStateCode(stateCode?: string | null): string {
  const digits = String(stateCode || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(2, '0').slice(-2);
}

export function gstinHelperText(raw?: string | null): string {
  const value = normalizeGstin(raw);
  if (!value) return '15-character GSTIN (optional for unregistered stores)';
  if (isValidGstinFormat(value)) {
    const name = gstStateName(gstinStateCode(value));
    return name ? `Valid format · ${name}` : 'Valid GSTIN format';
  }
  return 'Must be 15 characters: state + PAN + entity + Z + check digit';
}

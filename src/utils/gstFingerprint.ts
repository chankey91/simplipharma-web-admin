import type { GstFiledFingerprint } from '../types/gst';

/** Slim period-doc shape so outwardFingerprints stay under the 1MB Firestore limit. */
export interface GstFingerprintCompact {
  k: string;
  n: string;
  d: string;
  t: number;
  x: number;
  y: string;
  a: number;
  g?: string;
}

export function compactGstFingerprint(fp: GstFiledFingerprint): GstFingerprintCompact {
  const row: GstFingerprintCompact = {
    k: `${fp.collection}/${fp.documentId}`,
    n: fp.number,
    d: fp.date,
    t: fp.totalAmount,
    x: fp.taxableValue,
    y: fp.invoiceType,
    a: fp.taxAmount,
  };
  if (fp.buyerGstin) row.g = fp.buyerGstin;
  return row;
}

export function expandGstFingerprint(raw: unknown): GstFiledFingerprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.collection === 'string' && typeof row.documentId === 'string') {
    return {
      collection: row.collection,
      documentId: row.documentId,
      number: String(row.number || ''),
      date: String(row.date || ''),
      totalAmount: Number(row.totalAmount) || 0,
      taxableValue: Number(row.taxableValue) || 0,
      invoiceType: String(row.invoiceType || ''),
      buyerGstin: row.buyerGstin ? String(row.buyerGstin) : undefined,
      taxAmount: Number(row.taxAmount) || 0,
    };
  }
  if (typeof row.k !== 'string') return null;
  const slash = row.k.indexOf('/');
  const collection = slash >= 0 ? row.k.slice(0, slash) : row.k;
  const documentId = slash >= 0 ? row.k.slice(slash + 1) : '';
  return {
    collection,
    documentId,
    number: String(row.n || ''),
    date: String(row.d || ''),
    totalAmount: Number(row.t) || 0,
    taxableValue: Number(row.x) || 0,
    invoiceType: String(row.y || ''),
    buyerGstin: row.g ? String(row.g) : undefined,
    taxAmount: Number(row.a) || 0,
  };
}

export function expandGstFingerprints(raw: unknown): GstFiledFingerprint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(expandGstFingerprint).filter((row): row is GstFiledFingerprint => Boolean(row));
}

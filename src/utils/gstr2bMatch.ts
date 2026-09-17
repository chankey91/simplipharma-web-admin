import { isValidGstinFormat, normalizeGstin } from './gstin';
import { roundGst } from './gstTaxEngine';

export type Gst2bMatchStatus = 'matched' | 'amount_mismatch' | 'books_only' | 'portal_only';

export interface GstItcBookRow {
  id: string;
  vendorName: string;
  vendorGstin: string;
  invoiceNumber: string;
  vendorInvoiceNumber?: string;
  date: Date;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalAmount: number;
  hasSnapshot: boolean;
}

export interface Gst2bPortalRow {
  ctin: string;
  inum: string;
  idt: string;
  val: number;
  txval: number;
  camt: number;
  samt: number;
  iamt: number;
}

export interface Gst2bMatchRow {
  status: Gst2bMatchStatus;
  books?: GstItcBookRow;
  portal?: Gst2bPortalRow;
  message: string;
}

function sumItems(itms: unknown): { txval: number; camt: number; samt: number; iamt: number } {
  const list = Array.isArray(itms) ? itms : [];
  return list.reduce(
    (acc, raw) => {
      const det = ((raw as { itm_det?: Record<string, number> }).itm_det || raw) as Record<string, number>;
      acc.txval += Number(det.txval) || 0;
      acc.camt += Number(det.camt) || 0;
      acc.samt += Number(det.samt) || 0;
      acc.iamt += Number(det.iamt) || 0;
      return acc;
    },
    { txval: 0, camt: 0, samt: 0, iamt: 0 }
  );
}

export function parseGstr2bJson(raw: unknown): Gst2bPortalRow[] {
  const root = raw as Record<string, unknown>;
  const data = (root?.data as Record<string, unknown>) || root;
  const b2b = (data?.b2b as unknown[]) || (data?.B2B as unknown[]) || [];
  const rows: Gst2bPortalRow[] = [];
  for (const group of b2b) {
    const g = group as { ctin?: string; inv?: unknown[] };
    const ctin = normalizeGstin(g.ctin);
    for (const inv of g.inv || []) {
      const invoice = inv as {
        inum?: string;
        idt?: string;
        val?: number;
        itms?: unknown[];
      };
      const taxes = sumItems(invoice.itms);
      rows.push({
        ctin,
        inum: String(invoice.inum || '').trim(),
        idt: String(invoice.idt || ''),
        val: roundGst(Number(invoice.val) || 0),
        txval: roundGst(taxes.txval),
        camt: roundGst(taxes.camt),
        samt: roundGst(taxes.samt),
        iamt: roundGst(taxes.iamt),
      });
    }
  }
  return rows;
}

function bookKey(row: GstItcBookRow): string {
  const gstin = normalizeGstin(row.vendorGstin);
  const num = String(row.vendorInvoiceNumber || row.invoiceNumber || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return `${gstin}|${num}`;
}

function portalKey(row: Gst2bPortalRow): string {
  return `${normalizeGstin(row.ctin)}|${String(row.inum || '').replace(/\s+/g, '').toUpperCase()}`;
}

export function matchGstr2b(books: GstItcBookRow[], portal: Gst2bPortalRow[]): Gst2bMatchRow[] {
  const portalMap = new Map<string, Gst2bPortalRow>();
  for (const row of portal) {
    if (row.inum) portalMap.set(portalKey(row), row);
  }
  const used = new Set<string>();
  const out: Gst2bMatchRow[] = [];

  for (const book of books) {
    if (!isValidGstinFormat(book.vendorGstin)) {
      out.push({
        status: 'books_only',
        books: book,
        message: `${book.invoiceNumber}: no valid vendor GSTIN — cannot match GSTR-2B`,
      });
      continue;
    }
    const key = bookKey(book);
    const found = portalMap.get(key);
    if (!found) {
      out.push({
        status: 'books_only',
        books: book,
        message: `${book.vendorInvoiceNumber || book.invoiceNumber} is in books, not in uploaded GSTR-2B`,
      });
      continue;
    }
    used.add(key);
    const taxDiff =
      Math.abs(book.cgst - found.camt) +
      Math.abs(book.sgst - found.samt) +
      Math.abs(book.igst - found.iamt) +
      Math.abs(book.taxableValue - found.txval);
    if (taxDiff > 1) {
      out.push({
        status: 'amount_mismatch',
        books: book,
        portal: found,
        message: `${found.inum}: taxable/tax differs from GSTR-2B (books ${book.taxableValue.toFixed(2)} vs portal ${found.txval.toFixed(2)})`,
      });
    } else {
      out.push({
        status: 'matched',
        books: book,
        portal: found,
        message: `${found.inum} matches GSTR-2B`,
      });
    }
  }

  for (const [key, portalRow] of portalMap) {
    if (used.has(key)) continue;
    out.push({
      status: 'portal_only',
      portal: portalRow,
      message: `${portalRow.inum} is in GSTR-2B, not in purchase books for this period`,
    });
  }

  return out;
}

export function itcEligibleTotal(rows: GstItcBookRow[]): {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
} {
  return rows.reduce(
    (acc, row) => {
      if (!row.hasSnapshot || !isValidGstinFormat(row.vendorGstin)) return acc;
      acc.taxableValue = roundGst(acc.taxableValue + row.taxableValue);
      acc.cgst = roundGst(acc.cgst + row.cgst);
      acc.sgst = roundGst(acc.sgst + row.sgst);
      acc.igst = roundGst(acc.igst + row.igst);
      return acc;
    },
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
  );
}

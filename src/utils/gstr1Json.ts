import type { GstDocumentSnapshot, GstFiledFingerprint, GstInvoiceType } from '../types/gst';
import { isValidGstinFormat, normalizeGstin, normalizeStateCode } from './gstin';
import { b2clThreshold, roundGst } from './gstTaxEngine';
import { formatGstinDate, gstinFilingPeriod, indianGstPeriod } from './gstPeriod';

const GSTR1_JSON_VERSION = 'GST3.2.1';
const DEFAULT_HSN = '300490';
const RATE_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28];

export const GSTR1_MAX_BYTES = 5 * 1024 * 1024;

export interface Gstr1HsnPart {
  hsn: string;
  qty: number;
  net: number;
  gstRate?: number;
}

export interface Gstr1SourceDocument {
  collection: string;
  documentId: string;
  kind: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  date: Date;
  totalAmount: number;
  gst: GstDocumentSnapshot;
  hsnParts: Gstr1HsnPart[];
  originalInvoiceNumber?: string;
}

export interface Gstr1IssuedDoc {
  number: string;
  cancelled?: boolean;
}

export interface Gstr1ExportSummary {
  periodLabel: string;
  fp: string;
  gstin: string;
  mode: 'original' | 'amendment';
  b2b: number;
  b2cl: number;
  b2cs: number;
  cdnr: number;
  cdnur: number;
  b2ba: number;
  cdnra: number;
  hsn: number;
  documentCount: number;
  skippedNoSnapshot: number;
  warnings: string[];
  errors: string[];
}

export interface Gstr1RegisterRow {
  number: string;
  date: string;
  kind: string;
  invoiceType: string;
  party: string;
  taxable: number;
  tax: number;
  total: number;
  rates: string;
}

export interface Gstr1ExportResult {
  filename: string;
  payload: Record<string, unknown>;
  summary: Gstr1ExportSummary;
  fingerprints: GstFiledFingerprint[];
  register: Gstr1RegisterRow[];
  payloadHash?: string;
  byteLength?: number;
}

export interface GstnItemDet {
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

function posCode(raw?: string | null): string {
  return normalizeStateCode(raw) || '23';
}

export function snapGstRate(taxAmount: number, taxableValue: number): number {
  const tax = roundGst(taxAmount);
  const taxable = roundGst(taxableValue);
  if (taxable <= 0 || tax <= 0) return 0;
  const raw = (tax / taxable) * 100;
  let best = RATE_SLABS[0];
  let bestDiff = Math.abs(raw - best);
  for (const slab of RATE_SLABS) {
    const diff = Math.abs(raw - slab);
    if (diff < bestDiff) {
      best = slab;
      bestDiff = diff;
    }
  }
  return best;
}

function itemDet(gst: GstDocumentSnapshot): GstnItemDet {
  return {
    rt: snapGstRate(gst.cgst + gst.sgst + gst.igst + (gst.cess || 0), gst.taxableValue),
    txval: roundGst(gst.taxableValue),
    iamt: roundGst(gst.igst),
    camt: roundGst(gst.cgst),
    samt: roundGst(gst.sgst),
    csamt: roundGst(gst.cess || 0),
  };
}

function splitLineTax(
  tax: number,
  gst: GstDocumentSnapshot
): Pick<GstnItemDet, 'iamt' | 'camt' | 'samt' | 'csamt'> {
  const headerTax = (gst.cgst || 0) + (gst.sgst || 0) + (gst.igst || 0) + (gst.cess || 0);
  if (headerTax > 0) {
    return {
      iamt: roundGst(tax * (gst.igst || 0) / headerTax),
      camt: roundGst(tax * (gst.cgst || 0) / headerTax),
      samt: roundGst(tax * (gst.sgst || 0) / headerTax),
      csamt: roundGst(tax * (gst.cess || 0) / headerTax),
    };
  }
  if (gst.supplyType === 'inter') {
    return { iamt: roundGst(tax), camt: 0, samt: 0, csamt: 0 };
  }
  const camt = roundGst(tax / 2);
  return { iamt: 0, camt, samt: roundGst(tax - camt), csamt: 0 };
}

function scaleItemDets(items: GstnItemDet[], gst: GstDocumentSnapshot): GstnItemDet[] {
  if (!items.length) return [itemDet(gst)];
  const targetTx = roundGst(gst.taxableValue);
  const targetTax = roundGst((gst.cgst || 0) + (gst.sgst || 0) + (gst.igst || 0) + (gst.cess || 0));
  const txSum = items.reduce((sum, row) => sum + row.txval, 0) || 1;
  const taxSum =
    items.reduce((sum, row) => sum + row.iamt + row.camt + row.samt + row.csamt, 0) || 1;
  const scaled = items.map((row) => {
    const tax = row.iamt + row.camt + row.samt + row.csamt;
    const nextTax = roundGst(tax * (targetTax / taxSum));
    const split = splitLineTax(nextTax, gst);
    return {
      rt: row.rt,
      txval: roundGst(row.txval * (targetTx / txSum)),
      ...split,
    };
  });
  const last = scaled[scaled.length - 1];
  const txAdj = targetTx - scaled.reduce((sum, row) => sum + row.txval, 0);
  const taxAdj =
    targetTax -
    scaled.reduce((sum, row) => sum + row.iamt + row.camt + row.samt + row.csamt, 0);
  last.txval = roundGst(last.txval + txAdj);
  const adj = splitLineTax(roundGst(last.iamt + last.camt + last.samt + last.csamt + taxAdj), gst);
  last.iamt = adj.iamt;
  last.camt = adj.camt;
  last.samt = adj.samt;
  last.csamt = adj.csamt;
  return scaled;
}

/** One GSTR-1 itm per GST rate. Legacy snapshots without lines stay a single header itm. */
export function gstr1ItemDets(gst: GstDocumentSnapshot): GstnItemDet[] {
  const lines = gst.lines;
  if (!lines?.length) return [itemDet(gst)];
  const groups = new Map<number, { txval: number; tax: number }>();
  for (const line of lines) {
    const rt =
      line.gstRate > 0
        ? snapGstRate(line.gstRate, 100)
        : snapGstRate(line.taxAmount, line.taxableValue);
    const existing = groups.get(rt) || { txval: 0, tax: 0 };
    existing.txval += Number(line.taxableValue) || 0;
    existing.tax += Number(line.taxAmount) || 0;
    groups.set(rt, existing);
  }
  const dets = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rt, row]) => ({
      rt,
      txval: roundGst(row.txval),
      ...splitLineTax(row.tax, gst),
    }));
  return scaleItemDets(dets, gst);
}

export function gstr1PayloadSize(payload: unknown): { json: string; byteLength: number } {
  const json = JSON.stringify(payload);
  return { json, byteLength: new TextEncoder().encode(json).length };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function attachGstr1Integrity(result: Gstr1ExportResult): Promise<Gstr1ExportResult> {
  const { json, byteLength } = gstr1PayloadSize(result.payload);
  if (byteLength > GSTR1_MAX_BYTES) {
    result.summary.errors.push(
      `GSTR-1 JSON is ${(byteLength / (1024 * 1024)).toFixed(2)} MB; GSTN rejects files over 5 MB.`
    );
  }
  result.byteLength = byteLength;
  result.payloadHash = await sha256Hex(json);
  return result;
}

function sanitizeDocNumber(raw: string, warnings: string[], label: string): string {
  const trimmed = String(raw || '').trim();
  const cleaned = trimmed.replace(/[^A-Za-z0-9/-]/g, '');
  const sliced = cleaned.slice(0, 16);
  if (!sliced) {
    warnings.push(`${label} has no GSTN-safe document number.`);
    return trimmed.slice(0, 16) || 'NA';
  }
  if (sliced !== trimmed) {
    warnings.push(`${label} number "${trimmed}" was shortened/cleaned to "${sliced}" for GSTN.`);
  }
  return sliced;
}

function invoiceTypeOf(doc: Gstr1SourceDocument): GstInvoiceType {
  return doc.gst.invoiceType;
}

function cdnurTyp(doc: Gstr1SourceDocument): 'B2CL' | 'B2CS' {
  if (doc.gst.supplyType === 'inter' && roundGst(doc.totalAmount) >= b2clThreshold(doc.date)) {
    return 'B2CL';
  }
  return 'B2CS';
}

function fingerprintOf(doc: Gstr1SourceDocument): GstFiledFingerprint {
  return {
    collection: doc.collection,
    documentId: doc.documentId,
    number: doc.number,
    date: formatGstinDate(doc.date),
    totalAmount: roundGst(doc.totalAmount),
    taxableValue: roundGst(doc.gst.taxableValue),
    invoiceType: doc.gst.invoiceType,
    buyerGstin: doc.gst.buyerGstin,
    taxAmount: roundGst(doc.gst.cgst + doc.gst.sgst + doc.gst.igst + (doc.gst.cess || 0)),
  };
}

function fingerprintChanged(a: GstFiledFingerprint, b: GstFiledFingerprint): boolean {
  return (
    a.number !== b.number ||
    a.date !== b.date ||
    a.totalAmount !== b.totalAmount ||
    a.taxableValue !== b.taxableValue ||
    a.invoiceType !== b.invoiceType ||
    (a.buyerGstin || '') !== (b.buyerGstin || '') ||
    a.taxAmount !== b.taxAmount
  );
}

function pushGrouped(
  buckets: Map<string, { ctin?: string; pos?: string; inv?: Record<string, unknown>[]; nt?: Record<string, unknown>[] }>,
  key: string,
  seed: { ctin?: string; pos?: string },
  field: 'inv' | 'nt',
  row: Record<string, unknown>
) {
  const existing = buckets.get(key);
  if (existing) {
    (existing[field] as Record<string, unknown>[]).push(row);
    return;
  }
  buckets.set(key, { ...seed, [field]: [row] });
}

function hsnKey(hsn: string, rt: number, bucket: 'B2B' | 'B2C'): string {
  return `${bucket}|${hsn}|${rt}|NOS`;
}

function allocateHsn(
  doc: Gstr1SourceDocument,
  sign: 1 | -1,
  rows: Map<
    string,
    {
      hsn_sc: string;
      uqc: string;
      qty: number;
      rt: number;
      txval: number;
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }
  >
) {
  const lines = doc.gst.lines;
  const bucket: 'B2B' | 'B2C' =
    invoiceTypeOf(doc) === 'B2B' || invoiceTypeOf(doc) === 'CDNR' ? 'B2B' : 'B2C';

  if (lines?.length) {
    for (const line of lines) {
      const hsn = String(line.hsn || DEFAULT_HSN).replace(/\D/g, '').slice(0, 8) || DEFAULT_HSN;
      const rt =
        line.gstRate > 0
          ? snapGstRate(line.gstRate, 100)
          : snapGstRate(line.taxAmount, line.taxableValue);
      const split = splitLineTax(Number(line.taxAmount) || 0, doc.gst);
      const key = hsnKey(hsn, rt, bucket);
      const existing = rows.get(key) || {
        hsn_sc: hsn,
        uqc: 'NOS',
        qty: 0,
        rt,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      };
      existing.qty = roundGst(existing.qty + sign * (Number(line.qty) || 0));
      existing.txval = roundGst(existing.txval + sign * (Number(line.taxableValue) || 0));
      existing.iamt = roundGst(existing.iamt + sign * split.iamt);
      existing.camt = roundGst(existing.camt + sign * split.camt);
      existing.samt = roundGst(existing.samt + sign * split.samt);
      existing.csamt = roundGst(existing.csamt + sign * split.csamt);
      rows.set(key, existing);
    }
    return;
  }

  const det = itemDet(doc.gst);
  const parts = doc.hsnParts.length
    ? doc.hsnParts
    : [{ hsn: DEFAULT_HSN, qty: 1, net: det.txval || 1 }];
  const netTotal = parts.reduce((sum, part) => sum + Math.max(0, part.net), 0);

  parts.forEach((part, index) => {
    const hsn = String(part.hsn || DEFAULT_HSN).replace(/\D/g, '').slice(0, 8) || DEFAULT_HSN;
    const share = netTotal > 0 ? Math.max(0, part.net) / netTotal : index === 0 ? 1 : 0;
    const rt = part.gstRate && part.gstRate > 0 ? snapGstRate(part.gstRate, 100) : det.rt;
    const key = hsnKey(hsn, rt, bucket);
    const existing = rows.get(key) || {
      hsn_sc: hsn,
      uqc: 'NOS',
      qty: 0,
      rt,
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0,
    };
    existing.qty = roundGst(existing.qty + sign * (Number(part.qty) || 0));
    existing.txval = roundGst(existing.txval + sign * det.txval * share);
    existing.iamt = roundGst(existing.iamt + sign * det.iamt * share);
    existing.camt = roundGst(existing.camt + sign * det.camt * share);
    existing.samt = roundGst(existing.samt + sign * det.samt * share);
    existing.csamt = roundGst(existing.csamt + sign * det.csamt * share);
    rows.set(key, existing);
  });
}

function seriesEntries(numbers: Gstr1IssuedDoc[], docNum: number): Record<string, unknown> | null {
  const cleaned = numbers
    .map((row) => ({
      ...row,
      number: String(row.number || '').replace(/[^A-Za-z0-9/-]/g, '').slice(0, 16),
    }))
    .filter((row) => row.number);
  if (!cleaned.length) return null;
  const sorted = [...cleaned].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const totnum = sorted.length;
  const cancel = sorted.filter((row) => row.cancelled).length;
  return {
    doc_num: docNum,
    docs: [
      {
        num: 1,
        from: sorted[0].number,
        to: sorted[sorted.length - 1].number,
        totnum,
        cancel,
        net_issue: totnum - cancel,
      },
    ],
  };
}

export function validateGstr1Payload(
  payload: Record<string, unknown>,
  fp: string
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const gstin = String(payload.gstin || '');
  if (!isValidGstinFormat(gstin)) errors.push('Company GSTIN in the file is not a valid 15-character GSTIN.');
  if (!/^\d{6}$/.test(fp)) errors.push(`Filing period fp "${fp}" must be MMYYYY.`);

  const seen = new Set<string>();
  const scanInvoices = (rows: unknown, label: string) => {
    if (!Array.isArray(rows)) return;
    for (const group of rows) {
      const inv = (group as { inv?: unknown[] }).inv || [];
      for (const raw of inv) {
        const invoice = raw as { inum?: string; idt?: string; val?: number };
        const inum = String(invoice.inum || '');
        if (!inum) errors.push(`${label} is missing invoice number.`);
        if (inum.length > 16) errors.push(`${label} ${inum} is longer than 16 characters.`);
        if (invoice.idt && !/^\d{2}-\d{2}-\d{4}$/.test(invoice.idt)) {
          errors.push(`${label} ${inum} has a date that is not DD-MM-YYYY.`);
        }
        const key = `${label}:${inum}`;
        if (inum && seen.has(key)) warnings.push(`Duplicate ${label} number ${inum}.`);
        if (inum) seen.add(key);
      }
    }
  };
  scanInvoices(payload.b2b, 'B2B');
  scanInvoices(payload.b2cl, 'B2CL');
  scanInvoices(payload.b2ba, 'B2BA');
  return { errors, warnings };
}

export function buildGstr1Payload(input: {
  gstin: string;
  filingFrequency: 'monthly' | 'qrmp';
  documents: Gstr1SourceDocument[];
  skippedNoSnapshot: number;
  date?: Date;
  mode?: 'original' | 'amendment';
  previousFingerprints?: GstFiledFingerprint[];
  issuedInvoices?: Gstr1IssuedDoc[];
  issuedCreditNotes?: Gstr1IssuedDoc[];
  issuedDebitNotes?: Gstr1IssuedDoc[];
}): Gstr1ExportResult {
  const date = input.date || new Date();
  const gstin = normalizeGstin(input.gstin);
  const warnings: string[] = [];
  if (!isValidGstinFormat(gstin)) {
    throw new Error('Company GSTIN is not a valid 15-character GSTIN. Save GST settings first.');
  }

  const fp = gstinFilingPeriod(date);
  const period = indianGstPeriod(date);
  const mode = input.mode || 'original';
  const previous = new Map(
    (input.previousFingerprints || []).map((row) => [`${row.collection}:${row.documentId}`, row])
  );

  const b2b = new Map<string, { ctin?: string; inv?: Record<string, unknown>[] }>();
  const b2cl = new Map<string, { pos?: string; inv?: Record<string, unknown>[] }>();
  const b2cs = new Map<string, Record<string, unknown>>();
  const cdnr = new Map<string, { ctin?: string; nt?: Record<string, unknown>[] }>();
  const b2ba = new Map<string, { ctin?: string; inv?: Record<string, unknown>[] }>();
  const cdnra = new Map<string, { ctin?: string; nt?: Record<string, unknown>[] }>();
  const cdnur: Record<string, unknown>[] = [];
  const hsnRows = new Map<
    string,
    {
      hsn_sc: string;
      uqc: string;
      qty: number;
      rt: number;
      txval: number;
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }
  >();

  const docs = [...input.documents].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number)
  );
  const fingerprints = docs.map(fingerprintOf);
  const register: Gstr1RegisterRow[] = docs.map((doc) => {
    const dets = gstr1ItemDets(doc.gst);
    return {
      number: doc.number,
      date: formatGstinDate(doc.date),
      kind: doc.kind,
      invoiceType: doc.gst.invoiceType,
      party: doc.gst.buyerLegalName || doc.gst.buyerGstin || '—',
      taxable: roundGst(doc.gst.taxableValue),
      tax: roundGst(doc.gst.cgst + doc.gst.sgst + doc.gst.igst + (doc.gst.cess || 0)),
      total: roundGst(doc.totalAmount),
      rates: dets.map((row) => `${row.rt}%`).join(', ') || '—',
    };
  });
  let amendmentCount = 0;

  const shouldInclude = (doc: Gstr1SourceDocument): 'original' | 'amendment' | false => {
    if (mode === 'original') return 'original';
    const prev = previous.get(`${doc.collection}:${doc.documentId}`);
    if (!prev) return 'amendment';
    if (fingerprintChanged(prev, fingerprintOf(doc))) return 'amendment';
    return false;
  };

  for (const doc of docs) {
    const include = shouldInclude(doc);
    if (!include) continue;
    const type = invoiceTypeOf(doc);
    const dets = gstr1ItemDets(doc.gst);
    const pos = posCode(doc.gst.placeOfSupplyStateCode);
    const val = roundGst(doc.totalAmount);
    const itms = dets.map((itm_det, index) => ({ num: index + 1, itm_det }));
    const isAmendment = include === 'amendment';
    if (isAmendment) amendmentCount += 1;

    if (doc.kind === 'invoice') {
      const inum = sanitizeDocNumber(doc.number, warnings, 'Invoice');
      const idt = formatGstinDate(doc.date);
      const invoice: Record<string, unknown> = {
        inum,
        idt,
        val,
        pos,
        rchrg: doc.gst.reverseCharge ? 'Y' : 'N',
        inv_typ: 'R',
        itms,
      };
      if (isAmendment) {
        invoice.oinum = inum;
        invoice.oidt = idt;
      }
      if (type === 'B2B') {
        const ctin = normalizeGstin(doc.gst.buyerGstin);
        if (!isValidGstinFormat(ctin)) {
          warnings.push(`Invoice ${inum} is classified B2B but has no valid buyer GSTIN — skipped.`);
          continue;
        }
        pushGrouped(isAmendment ? b2ba : b2b, ctin, { ctin }, 'inv', invoice);
        if (!isAmendment) allocateHsn(doc, 1, hsnRows);
        continue;
      }
      if (type === 'B2CL') {
        const b2clInv: Record<string, unknown> = { inum, idt, val, itms };
        if (isAmendment) {
          b2clInv.oinum = inum;
          b2clInv.oidt = idt;
        }
        pushGrouped(isAmendment ? b2ba : b2cl, pos, { pos }, 'inv', b2clInv);
        if (!isAmendment) allocateHsn(doc, 1, hsnRows);
        continue;
      }
      if (isAmendment) {
        warnings.push(`B2CS invoice ${inum} cannot go in amendment tables; include it in the original GSTR-1.`);
        continue;
      }
      const sply_ty = doc.gst.supplyType === 'inter' ? 'INTER' : 'INTRA';
      for (const det of dets) {
        const key = `${pos}|${det.rt}|${sply_ty}`;
        const existing = b2cs.get(key) as
          | {
              txval: number;
              iamt: number;
              camt: number;
              samt: number;
              csamt: number;
            }
          | undefined;
        if (existing) {
          existing.txval = roundGst(existing.txval + det.txval);
          existing.iamt = roundGst(existing.iamt + det.iamt);
          existing.camt = roundGst(existing.camt + det.camt);
          existing.samt = roundGst(existing.samt + det.samt);
          existing.csamt = roundGst(existing.csamt + det.csamt);
        } else {
          b2cs.set(key, {
            sply_ty,
            rt: det.rt,
            typ: 'OE',
            pos,
            txval: det.txval,
            iamt: det.iamt,
            camt: det.camt,
            samt: det.samt,
            csamt: det.csamt,
          });
        }
      }
      allocateHsn(doc, 1, hsnRows);
      continue;
    }

    const ntty = doc.kind === 'debit_note' ? 'D' : 'C';
    const nt_num = sanitizeDocNumber(
      doc.number,
      warnings,
      ntty === 'D' ? 'Debit note' : 'Credit note'
    );
    const nt_dt = formatGstinDate(doc.date);
    const note: Record<string, unknown> = {
      ntty,
      nt_num,
      nt_dt,
      val,
      pos,
      rchrg: doc.gst.reverseCharge ? 'Y' : 'N',
      inv_typ: 'R',
      itms,
    };
    if (doc.originalInvoiceNumber) {
      note.inum = sanitizeDocNumber(doc.originalInvoiceNumber, warnings, 'Original invoice');
    }
    if (isAmendment) {
      note.ont_num = nt_num;
      note.ont_dt = nt_dt;
    }

    if (type === 'CDNR') {
      const ctin = normalizeGstin(doc.gst.buyerGstin);
      if (!isValidGstinFormat(ctin)) {
        warnings.push(`${nt_num} is CDNR but has no valid buyer GSTIN — skipped.`);
        continue;
      }
      pushGrouped(isAmendment ? cdnra : cdnr, ctin, { ctin }, 'nt', note);
      if (!isAmendment) allocateHsn(doc, ntty === 'C' ? -1 : 1, hsnRows);
      continue;
    }

    if (isAmendment) {
      warnings.push(`${nt_num} is CDNUR — amendment JSON does not include unregistered notes.`);
      continue;
    }
    cdnur.push({
      typ: cdnurTyp(doc),
      ntty,
      nt_num,
      nt_dt,
      pos,
      val,
      itms,
    });
    allocateHsn(doc, ntty === 'C' ? -1 : 1, hsnRows);
  }

  if (input.skippedNoSnapshot) {
    warnings.unshift(
      `${input.skippedNoSnapshot} document(s) have no GST snapshot and were left out. Backfill this period first.`
    );
  }
  if (mode === 'amendment' && amendmentCount === 0) {
    warnings.unshift('No invoices changed since the locked GSTR-1 export.');
  }

  const hsnData = [...hsnRows.values()]
    .filter((row) => row.txval !== 0 || row.iamt !== 0 || row.camt !== 0 || row.samt !== 0)
    .map((row, index) => {
      const out: Record<string, unknown> = {
        num: index + 1,
        hsn_sc: row.hsn_sc,
        uqc: row.uqc,
        qty: row.qty,
        rt: row.rt,
        txval: row.txval,
        iamt: row.iamt,
        camt: row.camt,
        samt: row.samt,
        csamt: row.csamt,
      };
      if (row.hsn_sc.startsWith('3004')) out.desc = 'Medicaments';
      return out;
    });

  const payload: Record<string, unknown> = {
    gstin,
    fp,
    version: GSTR1_JSON_VERSION,
    hash: 'hash',
    filing_typ: input.filingFrequency === 'qrmp' ? 'Q' : 'M',
  };

  const b2bArr = [...b2b.values()].map(({ ctin, inv }) => ({ ctin, inv }));
  const b2clArr = [...b2cl.values()].map(({ pos, inv }) => ({ pos, inv }));
  const b2csArr = [...b2cs.values()];
  const cdnrArr = [...cdnr.values()].map(({ ctin, nt }) => ({ ctin, nt }));
  const b2baArr = [...b2ba.values()].map(({ ctin, inv }) => ({ ctin, inv }));
  const cdnraArr = [...cdnra.values()].map(({ ctin, nt }) => ({ ctin, nt }));

  if (b2bArr.length) payload.b2b = b2bArr;
  if (b2clArr.length) payload.b2cl = b2clArr;
  if (b2csArr.length) payload.b2cs = b2csArr;
  if (cdnrArr.length) payload.cdnr = cdnrArr;
  if (cdnur.length) payload.cdnur = cdnur;
  if (b2baArr.length) payload.b2ba = b2baArr;
  if (cdnraArr.length) payload.cdnra = cdnraArr;
  if (hsnData.length) payload.hsn = { data: hsnData };

  if (mode === 'original') {
    const docDet = [
      seriesEntries(input.issuedInvoices || [], 1),
      seriesEntries(input.issuedCreditNotes || [], 5),
      seriesEntries(input.issuedDebitNotes || [], 4),
    ].filter(Boolean);
    if (docDet.length) payload.doc_issue = { doc_det: docDet };
  }

  const validation = validateGstr1Payload(payload, fp);
  warnings.push(...validation.warnings);
  const { byteLength } = gstr1PayloadSize(payload);
  if (byteLength > GSTR1_MAX_BYTES) {
    validation.errors.push(
      `GSTR-1 JSON is ${(byteLength / (1024 * 1024)).toFixed(2)} MB; GSTN rejects files over 5 MB.`
    );
  }

  const suffix = mode === 'amendment' ? '_A' : '';
  return {
    filename: `returns_${fp}_GSTR1${suffix}_${gstin}.json`,
    payload,
    fingerprints,
    register,
    byteLength,
    summary: {
      periodLabel: period.label,
      fp,
      gstin,
      mode,
      b2b: b2bArr.reduce((n, row) => n + (row.inv?.length || 0), 0),
      b2cl: b2clArr.reduce((n, row) => n + (row.inv?.length || 0), 0),
      b2cs: b2csArr.length,
      cdnr: cdnrArr.reduce((n, row) => n + (row.nt?.length || 0), 0),
      cdnur: cdnur.length,
      b2ba: b2baArr.reduce((n, row) => n + (row.inv?.length || 0), 0),
      cdnra: cdnraArr.reduce((n, row) => n + (row.nt?.length || 0), 0),
      hsn: hsnData.length,
      documentCount: docs.length,
      skippedNoSnapshot: input.skippedNoSnapshot,
      warnings,
      errors: validation.errors,
    },
  };
}

export function downloadGstr1Json(result: Gstr1ExportResult): void {
  const pretty = JSON.stringify(result.payload, null, 2);
  const compact = JSON.stringify(result.payload);
  const body =
    new TextEncoder().encode(pretty).length > GSTR1_MAX_BYTES ? compact : pretty;
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

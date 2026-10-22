import * as XLSX from 'xlsx';
import { istDateStampCompact } from './dateTime';
import { formatGstinDate } from './gstPeriod';
import { roundGst } from './gstTaxEngine';
import { gstr1ItemDets, snapGstRate, type Gstr1SourceDocument } from './gstr1Json';

export interface GstSlabRow {
  rt: number;
  invoices: number;
  creditNotes: number;
  debitNotes: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
  total: number;
  b2bTaxable: number;
  b2cTaxable: number;
}

export interface GstSlabLineDetail {
  rt: number;
  kind: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  date: string;
  party: string;
  invoiceType: string;
  productName: string;
  hsn: string;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

export interface GstSlabReport {
  periodLabel: string;
  fp: string;
  gstin: string;
  skippedNoSnapshot: number;
  documentCount: number;
  invoiceCount: number;
  rows: GstSlabRow[];
  lines: GstSlabLineDetail[];
  totals: GstSlabRow;
}

function emptyRow(rt: number): GstSlabRow {
  return {
    rt,
    invoices: 0,
    creditNotes: 0,
    debitNotes: 0,
    taxable: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    tax: 0,
    total: 0,
    b2bTaxable: 0,
    b2cTaxable: 0,
  };
}

function finishRow(row: GstSlabRow): GstSlabRow {
  row.taxable = roundGst(row.taxable);
  row.cgst = roundGst(row.cgst);
  row.sgst = roundGst(row.sgst);
  row.igst = roundGst(row.igst);
  row.cess = roundGst(row.cess);
  row.b2bTaxable = roundGst(row.b2bTaxable);
  row.b2cTaxable = roundGst(row.b2cTaxable);
  row.tax = roundGst(row.cgst + row.sgst + row.igst + row.cess);
  row.total = roundGst(row.taxable + row.tax);
  return row;
}

function isB2b(doc: Gstr1SourceDocument): boolean {
  return doc.gst.invoiceType === 'B2B' || doc.gst.invoiceType === 'CDNR';
}

function kindLabel(kind: GstSlabLineDetail['kind']): string {
  if (kind === 'credit_note') return 'Credit note';
  if (kind === 'debit_note') return 'Debit note';
  return 'Invoice';
}

function splitLineTax(tax: number, inter: boolean): { iamt: number; camt: number; samt: number } {
  const amount = roundGst(tax);
  if (inter) return { iamt: amount, camt: 0, samt: 0 };
  const camt = roundGst(amount / 2);
  return { iamt: 0, camt, samt: roundGst(amount - camt) };
}

function rateOfLine(gstRate: number | undefined, taxAmount: number, taxableValue: number): number {
  return gstRate && gstRate > 0 ? snapGstRate(gstRate, 100) : snapGstRate(taxAmount, taxableValue);
}

function nearestSlab(rt: number, rates: number[]): number {
  if (!rates.length) return rt;
  if (rates.includes(rt)) return rt;
  return rates.reduce((best, rate) => (Math.abs(rate - rt) < Math.abs(best - rt) ? rate : best));
}

export function buildGstSlabRows(documents: Gstr1SourceDocument[]): GstSlabRow[] {
  const map = new Map<number, GstSlabRow>();
  for (const doc of documents) {
    const dets = gstr1ItemDets(doc.gst);
    const sign = doc.kind === 'credit_note' ? -1 : 1;
    const b2b = isB2b(doc);
    const seen = new Set<number>();
    for (const det of dets) {
      const row = map.get(det.rt) || emptyRow(det.rt);
      row.taxable += sign * det.txval;
      row.cgst += sign * det.camt;
      row.sgst += sign * det.samt;
      row.igst += sign * det.iamt;
      row.cess += sign * det.csamt;
      if (b2b) row.b2bTaxable += sign * det.txval;
      else row.b2cTaxable += sign * det.txval;
      if (!seen.has(det.rt)) {
        seen.add(det.rt);
        if (doc.kind === 'invoice') row.invoices += 1;
        else if (doc.kind === 'credit_note') row.creditNotes += 1;
        else row.debitNotes += 1;
      }
      map.set(det.rt, row);
    }
  }
  return [...map.values()]
    .map(finishRow)
    .filter((row) => row.taxable !== 0 || row.tax !== 0 || row.invoices || row.creditNotes || row.debitNotes)
    .sort((a, b) => a.rt - b.rt);
}

export function buildGstSlabLines(documents: Gstr1SourceDocument[]): GstSlabLineDetail[] {
  const lines: GstSlabLineDetail[] = [];
  for (const doc of documents) {
    const dets = gstr1ItemDets(doc.gst);
    const slabRates = dets.map((det) => det.rt);
    const sign = doc.kind === 'credit_note' ? -1 : 1;
    const inter = doc.gst.supplyType === 'inter';
    const party = doc.gst.buyerLegalName || doc.gst.buyerGstin || '—';
    const date = formatGstinDate(doc.date);
    const products = doc.productLines || [];

    const pushLine = (
      rt: number,
      productName: string,
      hsn: string,
      qty: number,
      taxableValue: number,
      taxAmount: number
    ) => {
      const taxable = roundGst(sign * taxableValue);
      const split = splitLineTax(sign * taxAmount, inter);
      const tax = roundGst(split.iamt + split.camt + split.samt);
      lines.push({
        rt,
        kind: doc.kind,
        number: doc.number,
        date,
        party,
        invoiceType: doc.gst.invoiceType,
        productName,
        hsn,
        qty: roundGst(sign * qty),
        taxable,
        cgst: split.camt,
        sgst: split.samt,
        igst: split.iamt,
        tax,
        total: roundGst(taxable + tax),
      });
    };

    if (products.length) {
      for (const product of products) {
        const productRt = rateOfLine(product.gstRate, product.taxAmount, product.taxableValue);
        const rt = nearestSlab(productRt, slabRates);
        pushLine(rt, product.productName, product.hsn, product.qty, product.taxableValue, product.taxAmount);
      }
    } else {
      for (const det of dets) {
        pushLine(
          det.rt,
          '—',
          '',
          0,
          det.txval,
          det.iamt + det.camt + det.samt + det.csamt
        );
      }
    }
  }
  return lines.sort((a, b) => a.rt - b.rt || a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export function linesForSlab(lines: GstSlabLineDetail[], rt: number): GstSlabLineDetail[] {
  return lines.filter((line) => line.rt === rt);
}

export function totalGstSlabRow(rows: GstSlabRow[]): GstSlabRow {
  const total = emptyRow(-1);
  for (const row of rows) {
    total.invoices += row.invoices;
    total.creditNotes += row.creditNotes;
    total.debitNotes += row.debitNotes;
    total.taxable += row.taxable;
    total.cgst += row.cgst;
    total.sgst += row.sgst;
    total.igst += row.igst;
    total.cess += row.cess;
    total.b2bTaxable += row.b2bTaxable;
    total.b2cTaxable += row.b2cTaxable;
  }
  return finishRow(total);
}

const SUMMARY_COLS = [
  'GST %',
  'Invoices',
  'Credit notes',
  'Debit notes',
  'Taxable',
  'B2B taxable',
  'B2C taxable',
  'CGST',
  'SGST',
  'IGST',
  'Cess',
  'Tax',
  'Total',
];

const LINE_COLS = [
  'GST %',
  'Type',
  'Number',
  'Date',
  'Party',
  'Invoice type',
  'Product',
  'HSN',
  'Qty',
  'Taxable',
  'CGST',
  'SGST',
  'IGST',
  'Tax',
  'Total',
];

function summarySheet(report: GstSlabReport): XLSX.WorkSheet {
  const header: Array<Array<string | number>> = [
    ['GST slab sales', report.periodLabel],
    ['GSTIN', report.gstin],
    ['Filing period (fp)', report.fp],
    ['Documents', report.documentCount],
    [],
    SUMMARY_COLS,
  ];
  const body: Array<Array<string | number>> = report.rows.map((row) => [
    row.rt,
    row.invoices,
    row.creditNotes,
    row.debitNotes,
    row.taxable,
    row.b2bTaxable,
    row.b2cTaxable,
    row.cgst,
    row.sgst,
    row.igst,
    row.cess,
    row.tax,
    row.total,
  ]);
  const totals = report.totals;
  body.push([
    'Total',
    totals.invoices,
    totals.creditNotes,
    totals.debitNotes,
    totals.taxable,
    totals.b2bTaxable,
    totals.b2cTaxable,
    totals.cgst,
    totals.sgst,
    totals.igst,
    totals.cess,
    totals.tax,
    totals.total,
  ]);
  return XLSX.utils.aoa_to_sheet([...header, ...body]);
}

function lineRows(lines: GstSlabLineDetail[]): Array<Array<string | number>> {
  return lines.map((line) => [
    line.rt,
    kindLabel(line.kind),
    line.number,
    line.date,
    line.party,
    line.invoiceType,
    line.productName,
    line.hsn,
    line.qty,
    line.taxable,
    line.cgst,
    line.sgst,
    line.igst,
    line.tax,
    line.total,
  ]);
}

function detailsSheet(report: GstSlabReport, lines: GstSlabLineDetail[], title: string): XLSX.WorkSheet {
  const header: Array<Array<string | number>> = [
    [title, report.periodLabel],
    ['GSTIN', report.gstin],
    ['Filing period (fp)', report.fp],
    ['Rows', lines.length],
    [],
    LINE_COLS,
  ];
  return XLSX.utils.aoa_to_sheet([...header, ...lineRows(lines)]);
}

export function downloadGstSlabExcel(report: GstSlabReport, rt?: number): void {
  const wb = XLSX.utils.book_new();
  const lines = rt == null ? report.lines : linesForSlab(report.lines, rt);
  if (rt == null) {
    XLSX.utils.book_append_sheet(wb, summarySheet(report), 'GST slabs');
    XLSX.utils.book_append_sheet(wb, detailsSheet(report, lines, 'Invoice lines by GST slab'), 'Invoice lines');
    XLSX.writeFile(wb, `gst-slab-sales-${report.fp}-${istDateStampCompact()}.xlsx`);
    return;
  }
  XLSX.utils.book_append_sheet(
    wb,
    detailsSheet(report, lines, `GST ${rt}% invoice lines`),
    `GST ${rt}%`.slice(0, 31)
  );
  XLSX.writeFile(wb, `gst-slab-${rt}pct-${report.fp}-${istDateStampCompact()}.xlsx`);
}

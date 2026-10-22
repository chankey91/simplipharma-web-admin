import * as XLSX from 'xlsx';
import { istDateStampCompact } from './dateTime';
import { roundGst } from './gstTaxEngine';
import { gstr1ItemDets, type Gstr1SourceDocument } from './gstr1Json';

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

export interface GstSlabReport {
  periodLabel: string;
  fp: string;
  gstin: string;
  skippedNoSnapshot: number;
  documentCount: number;
  invoiceCount: number;
  rows: GstSlabRow[];
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

export function downloadGstSlabExcel(report: GstSlabReport): void {
  const header = [
    ['GST slab sales', report.periodLabel],
    ['GSTIN', report.gstin],
    ['Filing period (fp)', report.fp],
    ['Documents', report.documentCount],
    [],
    [
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
    ],
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
  const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'GST slabs');
  XLSX.writeFile(wb, `gst-slab-sales-${report.fp}-${istDateStampCompact()}.xlsx`);
}

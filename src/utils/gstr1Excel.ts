import * as XLSX from 'xlsx';
import { gstinStateCode, gstStateName, isValidGstinFormat, normalizeStateCode } from './gstin';
import { roundGst } from './gstTaxEngine';
import type { Gstr1ExportResult } from './gstr1Json';

/** GSTN Offline Tool V2.2 POS labels. Must match the template dropdown exactly. */
const GSTN_POS: Record<string, string> = {
  '01': '01-Jammu & Kashmir',
  '02': '02-Himachal Pradesh',
  '03': '03-Punjab',
  '04': '04-Chandigarh',
  '05': '05-Uttarakhand',
  '06': '06-Haryana',
  '07': '07-Delhi',
  '08': '08-Rajasthan',
  '09': '09-Uttar Pradesh',
  '10': '10-Bihar',
  '11': '11-Sikkim',
  '12': '12-Arunachal Pradesh',
  '13': '13-Nagaland',
  '14': '14-Manipur',
  '15': '15-Mizoram',
  '16': '16-Tripura',
  '17': '17-Meghalaya',
  '18': '18-Assam',
  '19': '19-West Bengal',
  '20': '20-Jharkhand',
  '21': '21-Odisha',
  '22': '22-Chhattisgarh',
  '23': '23-Madhya Pradesh',
  '24': '24-Gujarat',
  '25': '25-Daman & Diu',
  '26': '26-Dadra & Nagar Haveli & Daman & Diu',
  '27': '27-Maharashtra',
  '29': '29-Karnataka',
  '30': '30-Goa',
  '31': '31-Lakshdweep',
  '32': '32-Kerala',
  '33': '33-Tamil Nadu',
  '34': '34-Puducherry',
  '35': '35-Andaman & Nicobar Islands',
  '36': '36-Telangana',
  '37': '37-Andhra Pradesh',
  '38': '38-Ladakh',
  '96': '96-Foreign Country',
  '97': '97-Other Territory',
};

const INV_TYPE: Record<string, string> = {
  R: 'Regular B2B',
  SEWP: 'SEZ supplies with payment',
  SEWOP: 'SEZ supplies without payment',
  DE: 'Deemed Exp',
  CBW: 'Intra-State supplies attracting IGST',
};

const DOC_NATURE: Record<number, string> = {
  1: 'Invoices for outward supply',
  2: 'Invoices for inward supply from unregistered person',
  3: 'Revised Invoice',
  4: 'Debit Note',
  5: 'Credit Note',
  6: 'Receipt Voucher',
  7: 'Payment Voucher',
  8: 'Refund Voucher',
  9: 'Delivery Challan for job work',
  10: 'Delivery Challan for supply on approval',
  11: 'Delivery Challan in case of liquid gas',
  12: 'Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Cell = string | number;
type AoA = Cell[][];
type Sparse = Record<string, Cell>;

interface ItmDet {
  rt?: number;
  txval?: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt?: number;
}

interface InvRow {
  inum?: string;
  idt?: string;
  val?: number;
  pos?: string;
  rchrg?: string;
  inv_typ?: string;
  oinum?: string;
  oidt?: string;
  itms?: Array<{ itm_det?: ItmDet }>;
}

interface NoteRow {
  ntty?: string;
  nt_num?: string;
  nt_dt?: string;
  val?: number;
  pos?: string;
  rchrg?: string;
  inv_typ?: string;
  typ?: string;
  ont_num?: string;
  ont_dt?: string;
  itms?: Array<{ itm_det?: ItmDet }>;
}

interface HsnRow {
  hsn_sc?: string;
  desc?: string;
  user_desc?: string;
  uqc?: string;
  qty?: number;
  rt?: number;
  txval?: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt?: number;
}

function colIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sparseRow(cells: Sparse, lastCol: string): Cell[] {
  const out: Cell[] = Array(colIndex(lastCol) + 1).fill('');
  for (const [key, value] of Object.entries(cells)) out[colIndex(key)] = value;
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number {
  return roundGst(Number(value) || 0);
}

const EXCEL_DATE = /^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/;

/** GST Excel dates must be text DD-MMM-YYYY, e.g. 24-May-2017. */
export function gstr1ExcelDate(idt: string): string {
  const raw = String(idt || '').trim();
  if (!raw) return '';
  const mmm = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (mmm) {
    const mon = `${mmm[2][0].toUpperCase()}${mmm[2].slice(1).toLowerCase()}`;
    return `${mmm[1].padStart(2, '0')}-${mon}-${mmm[3]}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const month = MONTHS[Number(iso[2]) - 1];
    return month ? `${iso[3]}-${month}-${iso[1]}` : '';
  }
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!dmy) return '';
  const month = MONTHS[Number(dmy[2]) - 1];
  return month ? `${dmy[1].padStart(2, '0')}-${month}-${dmy[3]}` : '';
}

function isExcelDate(value: string): boolean {
  return EXCEL_DATE.test(value);
}

function isDocNumber(value: string): boolean {
  const raw = String(value || '').trim();
  return Boolean(raw) && raw !== '0' && raw.length <= 16 && /^[A-Za-z0-9/-]+$/.test(raw);
}

export function gstr1ExcelPos(code: string | undefined): string {
  const normalized = normalizeStateCode(code);
  if (GSTN_POS[normalized]) return GSTN_POS[normalized];
  const name = gstStateName(normalized);
  return name ? `${normalized}-${name}` : normalized;
}

function invType(code: string | undefined): string {
  return INV_TYPE[String(code || 'R')] || INV_TYPE.R;
}

function uqcLabel(raw: string | undefined): string {
  const value = String(raw || 'NOS').trim().toUpperCase();
  if (value.includes('-')) return value;
  if (value === 'NOS' || value === 'NUMBERS') return 'NOS-NUMBERS';
  return value || 'NOS-NUMBERS';
}

function normalizeHsn(raw: string | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length >= 6) return digits;
  if (digits === '3004') return '300490';
  return digits;
}

function partyMap(result: Gstr1ExportResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of result.register) {
    if (row.number) map.set(row.number, row.party === '—' ? '' : row.party);
  }
  return map;
}

function cdnurUrType(typ: string, posLabel: string, supplierState: string): 'B2CL' | 'B2CS' {
  const pos = normalizeStateCode(posLabel);
  if (pos && supplierState && pos === supplierState) return 'B2CS';
  return typ === 'B2CL' ? 'B2CL' : 'B2CS';
}

function keepImportLine(input: {
  number: string;
  date: string;
  value: number;
  pos: string;
  txval: number;
  gstin?: string;
  requireGstin?: boolean;
}): boolean {
  if (!isDocNumber(input.number) || !isExcelDate(input.date)) return false;
  if (input.value <= 0 || input.txval <= 0 || !input.pos) return false;
  if (input.requireGstin && !isValidGstinFormat(input.gstin)) return false;
  return true;
}

function invoiceRows(
  groups: unknown,
  parties: Map<string, string>,
  amended = false
): AoA {
  if (!Array.isArray(groups)) return [];
  const rows: AoA = [];
  for (const group of groups) {
    const g = asRecord(group);
    const ctin = String(g.ctin || '');
    const groupPos = String(g.pos || '');
    const invoices = Array.isArray(g.inv) ? (g.inv as InvRow[]) : [];
    for (const inv of invoices) {
      const inum = String(inv.inum || '');
      const idt = gstr1ExcelDate(String(inv.idt || ''));
      const val = num(inv.val);
      const pos = gstr1ExcelPos(String(inv.pos || groupPos));
      const rchrg = inv.rchrg === 'Y' ? 'Y' : 'N';
      const type = invType(inv.inv_typ);
      const name = parties.get(inum) || '';
      const itms = inv.itms?.length ? inv.itms : [{ itm_det: { rt: 0, txval: 0, csamt: 0 } }];
      for (const itm of itms) {
        const det = itm.itm_det || {};
        const txval = num(det.txval);
        if (
          !keepImportLine({
            number: inum,
            date: idt,
            value: val,
            pos,
            txval,
            gstin: ctin,
            requireGstin: true,
          })
        ) {
          continue;
        }
        if (amended) {
          const oinum = String(inv.oinum || inum);
          const oidt = gstr1ExcelDate(String(inv.oidt || inv.idt || ''));
          if (!isDocNumber(oinum) || !isExcelDate(oidt)) continue;
          rows.push([
            ctin,
            name,
            oinum,
            oidt,
            inum,
            idt,
            val,
            pos,
            rchrg,
            '',
            type,
            '',
            num(det.rt),
            txval,
            num(det.csamt),
          ]);
        } else {
          rows.push([
            ctin,
            name,
            inum,
            idt,
            val,
            pos,
            rchrg,
            '',
            type,
            '',
            num(det.rt),
            txval,
            num(det.csamt),
          ]);
        }
      }
    }
  }
  return rows;
}

function b2clRows(groups: unknown, supplierState: string, amended = false): AoA {
  if (!Array.isArray(groups)) return [];
  const rows: AoA = [];
  for (const group of groups) {
    const g = asRecord(group);
    const groupPos = String(g.pos || '');
    const invoices = Array.isArray(g.inv) ? (g.inv as InvRow[]) : [];
    for (const inv of invoices) {
      const inum = String(inv.inum || '');
      const idt = gstr1ExcelDate(String(inv.idt || ''));
      const val = num(inv.val);
      const pos = gstr1ExcelPos(String(inv.pos || groupPos));
      if (supplierState && normalizeStateCode(pos) === supplierState) continue;
      const itms = inv.itms?.length ? inv.itms : [{ itm_det: { rt: 0, txval: 0, csamt: 0 } }];
      for (const itm of itms) {
        const det = itm.itm_det || {};
        const txval = num(det.txval);
        if (!keepImportLine({ number: inum, date: idt, value: val, pos, txval })) continue;
        if (amended) {
          const oinum = String(inv.oinum || inum);
          const oidt = gstr1ExcelDate(String(inv.oidt || inv.idt || ''));
          if (!isDocNumber(oinum) || !isExcelDate(oidt)) continue;
          rows.push([
            oinum,
            oidt,
            pos,
            inum,
            idt,
            val,
            '',
            num(det.rt),
            txval,
            num(det.csamt),
            '',
          ]);
        } else {
          rows.push([inum, idt, val, pos, '', num(det.rt), txval, num(det.csamt), '']);
        }
      }
    }
  }
  return rows;
}

function b2csRows(rows: unknown): AoA {
  if (!Array.isArray(rows)) return [];
  const out: AoA = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const txval = num(row.txval);
    const pos = gstr1ExcelPos(String(row.pos || ''));
    if (txval <= 0 || !pos) continue;
    out.push([
      String(row.typ || 'OE'),
      pos,
      '',
      num(row.rt),
      txval,
      num(row.csamt),
      '',
    ]);
  }
  return out;
}

function cdnrRows(groups: unknown, parties: Map<string, string>, amended = false): AoA {
  if (!Array.isArray(groups)) return [];
  const rows: AoA = [];
  for (const group of groups) {
    const g = asRecord(group);
    const ctin = String(g.ctin || '');
    const notes = Array.isArray(g.nt) ? (g.nt as NoteRow[]) : [];
    for (const note of notes) {
      const ntNum = String(note.nt_num || '');
      const ntDt = gstr1ExcelDate(String(note.nt_dt || ''));
      const ntty = note.ntty === 'D' ? 'D' : 'C';
      const pos = gstr1ExcelPos(String(note.pos || ''));
      const rchrg = note.rchrg === 'Y' ? 'Y' : 'N';
      const supply = invType(note.inv_typ);
      const val = num(note.val);
      const name = parties.get(ntNum) || '';
      const itms = note.itms?.length ? note.itms : [{ itm_det: { rt: 0, txval: 0, csamt: 0 } }];
      for (const itm of itms) {
        const det = itm.itm_det || {};
        const txval = num(det.txval);
        if (
          !keepImportLine({
            number: ntNum,
            date: ntDt,
            value: val,
            pos,
            txval,
            gstin: ctin,
            requireGstin: true,
          })
        ) {
          continue;
        }
        if (amended) {
          const ontNum = String(note.ont_num || ntNum);
          const ontDt = gstr1ExcelDate(String(note.ont_dt || note.nt_dt || ''));
          if (!isDocNumber(ontNum) || !isExcelDate(ontDt)) continue;
          rows.push([
            ctin,
            name,
            ontNum,
            ontDt,
            ntNum,
            ntDt,
            ntty,
            pos,
            rchrg,
            supply,
            val,
            '',
            num(det.rt),
            txval,
            num(det.csamt),
          ]);
        } else {
          rows.push([
            ctin,
            name,
            ntNum,
            ntDt,
            ntty,
            pos,
            rchrg,
            supply,
            val,
            '',
            num(det.rt),
            txval,
            num(det.csamt),
          ]);
        }
      }
    }
  }
  return rows;
}

function cdnurRows(notes: unknown, supplierState: string, amended = false): AoA {
  if (!Array.isArray(notes)) return [];
  const rows: AoA = [];
  for (const raw of notes as NoteRow[]) {
    const ntNum = String(raw.nt_num || '');
    const ntDt = gstr1ExcelDate(String(raw.nt_dt || ''));
    const ntty = raw.ntty === 'D' ? 'D' : 'C';
    const pos = gstr1ExcelPos(String(raw.pos || ''));
    const val = num(raw.val);
    const ur = cdnurUrType(String(raw.typ || ''), pos, supplierState);
    // V2.2 Excel CDNUR only accepts B2CL / EXPWP / EXPWOP. B2CS fails import
    // and is then checked as B2CL ("POS cannot be same as Supplier State Code").
    if (ur !== 'B2CL') continue;
    if (supplierState && normalizeStateCode(pos) === supplierState) continue;
    const itms = raw.itms?.length ? raw.itms : [{ itm_det: { rt: 0, txval: 0, csamt: 0 } }];
    for (const itm of itms) {
      const det = itm.itm_det || {};
      const txval = num(det.txval);
      if (!keepImportLine({ number: ntNum, date: ntDt, value: val, pos, txval })) continue;
      if (amended) {
        const ontNum = String(raw.ont_num || ntNum);
        const ontDt = gstr1ExcelDate(String(raw.ont_dt || raw.nt_dt || ''));
        if (!isDocNumber(ontNum) || !isExcelDate(ontDt)) continue;
        rows.push([
          ur,
          ontNum,
          ontDt,
          ntNum,
          ntDt,
          ntty,
          pos,
          val,
          '',
          num(det.rt),
          txval,
          num(det.csamt),
        ]);
      } else {
        rows.push([ur, ntNum, ntDt, ntty, pos, val, '', num(det.rt), txval, num(det.csamt)]);
      }
    }
  }
  return rows;
}

function hsnRows(rows: unknown): AoA {
  if (!Array.isArray(rows)) return [];
  const merged = new Map<string, Cell[]>();
  for (const raw of rows as HsnRow[]) {
    const hsn = normalizeHsn(raw.hsn_sc);
    if (hsn.length < 6) continue;
    const txval = num(raw.txval);
    const iamt = num(raw.iamt);
    const camt = num(raw.camt);
    const samt = num(raw.samt);
    const csamt = num(raw.csamt);
    const qty = num(raw.qty);
    if (txval <= 0 || iamt < 0 || camt < 0 || samt < 0 || qty < 0) continue;
    const rt = num(raw.rt);
    if (rt === 0 && iamt + camt + samt + csamt > 0) continue;
    const uqc = uqcLabel(raw.uqc);
    const tax = roundGst(iamt + camt + samt + csamt);
    const key = `${hsn}|${uqc}|${rt}`;
    const existing = merged.get(key);
    if (existing) {
      existing[3] = num(existing[3]) + qty;
      existing[4] = num(existing[4]) + txval + tax;
      existing[6] = num(existing[6]) + txval;
      existing[7] = num(existing[7]) + iamt;
      existing[8] = num(existing[8]) + camt;
      existing[9] = num(existing[9]) + samt;
      existing[10] = num(existing[10]) + csamt;
      continue;
    }
    merged.set(key, [
      hsn,
      String(raw.user_desc || raw.desc || 'Goods').slice(0, 30),
      uqc,
      qty,
      roundGst(txval + tax),
      rt,
      txval,
      iamt,
      camt,
      samt,
      csamt,
    ]);
  }
  return [...merged.values()].map((row) => [
    row[0],
    row[1],
    row[2],
    num(row[3]),
    num(row[4]),
    num(row[5]),
    num(row[6]),
    num(row[7]),
    num(row[8]),
    num(row[9]),
    num(row[10]),
  ]);
}

function docsRows(docIssue: unknown): AoA {
  const det = asRecord(docIssue).doc_det;
  if (!Array.isArray(det)) return [];
  const rows: AoA = [];
  for (const raw of det) {
    const block = asRecord(raw);
    const nature = DOC_NATURE[Number(block.doc_num)] || '';
    const docs = Array.isArray(block.docs) ? block.docs : [];
    for (const doc of docs) {
      const row = asRecord(doc);
      rows.push([
        nature,
        String(row.from || ''),
        String(row.to || ''),
        num(row.totnum),
        num(row.cancel),
      ]);
    }
  }
  return rows;
}

type SheetDef = { name: string; last: string; header: Sparse[] };

/** Header rows 1–4 from GSTR1_Excel_Workbook_Template_V2.2.xlsx. Do not rename. */
const SHEETS: SheetDef[] = [
  {
    name: 'b2b,sez,de',
    last: 'M',
    header: [
      { A: 'Summary For B2B, SEZ, DE (4A, 4B, 6B, 6C)', M: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Invoices',
        E: 'Total Invoice Value',
        L: 'Total Taxable Value',
        M: 'Total Cess',
      },
      { A: 0, C: 0, E: 0, L: 0, M: 0 },
      {
        A: 'GSTIN/UIN of Recipient',
        B: 'Receiver Name',
        C: 'Invoice Number',
        D: 'Invoice date',
        E: 'Invoice Value',
        F: 'Place Of Supply',
        G: 'Reverse Charge',
        H: 'Applicable % of Tax Rate',
        I: 'Invoice Type',
        J: 'E-Commerce GSTIN',
        K: 'Rate',
        L: 'Taxable Value',
        M: 'Cess Amount',
      },
    ],
  },
  {
    name: 'b2ba',
    last: 'O',
    header: [
      { A: 'Summary For B2BA', B: 'Original details', E: 'Revised Details', O: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Invoices',
        G: 'Total Invoice Value',
        N: 'Total Taxable Value',
        O: 'Total Cess',
      },
      { A: 0, C: 0, G: 0, N: 0, O: 0 },
      {
        A: 'GSTIN/UIN of Recipient',
        B: 'Receiver Name',
        C: 'Original Invoice Number',
        D: 'Original Invoice date',
        E: 'Revised Invoice Number',
        F: 'Revised Invoice date',
        G: 'Invoice Value',
        H: 'Place Of Supply',
        I: 'Reverse Charge',
        J: 'Applicable % of Tax Rate',
        K: 'Invoice Type',
        L: 'E-Commerce GSTIN',
        M: 'Rate',
        N: 'Taxable Value',
        O: 'Cess Amount',
      },
    ],
  },
  {
    name: 'b2cl',
    last: 'I',
    header: [
      { A: 'Summary For B2CL(5)', I: 'HELP' },
      { A: 'No. of Invoices' },
      { A: 0, C: 0, G: 0, H: 0 },
      {
        A: 'Invoice Number',
        B: 'Invoice date',
        C: 'Invoice Value',
        D: 'Place Of Supply',
        E: 'Applicable % of Tax Rate',
        F: 'Rate',
        G: 'Taxable Value',
        H: 'Cess Amount',
        I: 'E-Commerce GSTIN',
      },
    ],
  },
  {
    name: 'b2cla',
    last: 'K',
    header: [
      { A: 'Summary For B2CLA', B: 'Original details', E: 'Revised Details', K: 'HELP' },
      { A: 'No. of Invoices', F: 'Total Inv Value', I: 'Total Taxable Value', J: 'Total Cess' },
      { A: 0, F: 0, I: 0, J: 0 },
      {
        A: 'Original Invoice Number',
        B: 'Original Invoice date',
        C: 'Original Place Of Supply',
        D: 'Revised Invoice Number',
        E: 'Revised Invoice date',
        F: 'Invoice Value',
        G: 'Applicable % of Tax Rate',
        H: 'Rate',
        I: 'Taxable Value',
        J: 'Cess Amount',
        K: 'E-Commerce GSTIN',
      },
    ],
  },
  {
    name: 'b2cs',
    last: 'G',
    header: [
      { A: 'Summary For B2CS(7)', G: 'HELP' },
      { E: 'Total Taxable  Value', F: 'Total Cess' },
      { E: 0, F: 0 },
      {
        A: 'Type',
        B: 'Place Of Supply',
        C: 'Applicable % of Tax Rate',
        D: 'Rate',
        E: 'Taxable Value',
        F: 'Cess Amount',
        G: 'E-Commerce GSTIN',
      },
    ],
  },
  {
    name: 'b2csa',
    last: 'I',
    header: [
      { A: 'Summary For B2CSA', B: 'Original details', C: 'Revised details', I: 'HELP' },
      { G: 'Total Taxable  Value', H: 'Total Cess' },
      { G: 0, H: 0 },
      {
        A: 'Financial Year',
        B: 'Original Month',
        C: 'Place Of Supply',
        D: 'Type',
        E: 'Applicable % of Tax Rate',
        F: 'Rate',
        G: 'Taxable Value',
        H: 'Cess Amount',
        I: 'E-Commerce GSTIN',
      },
    ],
  },
  {
    name: 'cdnr',
    last: 'M',
    header: [
      { A: 'Summary For CDNR(9B)', M: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Notes',
        I: 'Total Note Value',
        L: 'Total Taxable Value',
        M: 'Total Cess',
      },
      { A: 0, C: 0, I: 0, L: 0, M: 0 },
      {
        A: 'GSTIN/UIN of Recipient',
        B: 'Receiver Name',
        C: 'Note Number',
        D: 'Note Date',
        E: 'Note Type',
        F: 'Place Of Supply',
        G: 'Reverse Charge',
        H: 'Note Supply Type',
        I: 'Note Value',
        J: 'Applicable % of Tax Rate',
        K: 'Rate',
        L: 'Taxable Value',
        M: 'Cess Amount',
      },
    ],
  },
  {
    name: 'cdnra',
    last: 'O',
    header: [
      { A: 'Summary For CDNRA', B: 'Original details', E: 'Revised details', O: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Notes/Vouchers',
        K: 'Total Note Value',
        N: 'Total Taxable Value',
        O: 'Total Cess',
      },
      { A: 0, C: 0, K: 0, N: 0, O: 0 },
      {
        A: 'GSTIN/UIN of Recipient',
        B: 'Receiver Name',
        C: 'Original Note Number',
        D: 'Original Note Date',
        E: 'Revised Note Number',
        F: 'Revised Note Date',
        G: 'Note Type',
        H: 'Place Of Supply',
        I: 'Reverse Charge',
        J: 'Note Supply Type',
        K: 'Note Value',
        L: 'Applicable % of Tax Rate',
        M: 'Rate',
        N: 'Taxable Value',
        O: 'Cess Amount',
      },
    ],
  },
  {
    name: 'cdnur',
    last: 'J',
    header: [
      { A: 'Summary For CDNUR(9B)', J: 'HELP' },
      { B: 'No. of Notes/Vouchers', F: 'Total Note Value', I: 'Total Taxable Value', J: 'Total Cess' },
      { B: 0, F: 0, I: 0, J: 0 },
      {
        A: 'UR Type',
        B: 'Note Number',
        C: 'Note Date',
        D: 'Note Type',
        E: 'Place Of Supply',
        F: 'Note Value',
        G: 'Applicable % of Tax Rate',
        H: 'Rate',
        I: 'Taxable Value',
        J: 'Cess Amount',
      },
    ],
  },
  {
    name: 'cdnura',
    last: 'L',
    header: [
      { A: 'Summary For CDNURA', B: 'Original details', D: 'Revised details', L: 'HELP' },
      { B: 'No. of Notes/Vouchers', H: 'Total Note Value', K: 'Total Taxable Value', L: 'Total Cess' },
      { B: 0, H: 0, K: 0, L: 0 },
      {
        A: 'UR Type',
        B: 'Original Note Number',
        C: 'Original Note Date',
        D: 'Revised Note Number',
        E: 'Revised Note Date',
        F: 'Note Type',
        G: 'Place Of Supply',
        H: 'Note Value',
        I: 'Applicable % of Tax Rate',
        J: 'Rate',
        K: 'Taxable Value',
        L: 'Cess Amount',
      },
    ],
  },
  {
    name: 'exp',
    last: 'J',
    header: [
      { A: 'Summary For EXP(6)', J: 'HELP' },
      { B: 'No. of Invoices', D: 'Total Invoice Value', F: 'No. of Shipping Bill', J: 'Total Taxable Value' },
      { B: 0, D: 0, F: 0, J: 0 },
      {
        A: 'Export Type',
        B: 'Invoice Number',
        C: 'Invoice date',
        D: 'Invoice Value',
        E: 'Port Code',
        F: 'Shipping Bill Number',
        G: 'Shipping Bill Date',
        H: 'Rate',
        I: 'Taxable Value',
        J: 'Cess Amount',
      },
    ],
  },
  {
    name: 'expa',
    last: 'L',
    header: [
      { A: 'Summary For EXPA', B: 'Original details ', D: 'Revised details', L: 'HELP' },
      {
        B: 'No. of Invoices',
        F: 'Total Invoice Value',
        H: 'No. of Shipping Bill',
        K: 'Total Taxable Value',
        L: 'Total Cess',
      },
      { B: 0, F: 0, H: 0, K: 0, L: 0 },
      {
        A: 'Export Type',
        B: 'Original Invoice Number',
        C: 'Original Invoice date',
        D: 'Revised Invoice Number',
        E: 'Revised Invoice date',
        F: 'Invoice Value',
        G: 'Port Code',
        H: 'Shipping Bill Number',
        I: 'Shipping Bill Date',
        J: 'Rate',
        K: 'Taxable Value',
        L: 'Cess Amount',
      },
    ],
  },
  {
    name: 'at',
    last: 'E',
    header: [
      { A: 'Summary For Advance Received (11B)  ', E: 'HELP' },
      { D: 'Total Advance Received', E: 'Total Cess' },
      { D: 0, E: 0 },
      {
        A: 'Place Of Supply',
        B: 'Applicable % of Tax Rate',
        C: 'Rate',
        D: 'Gross Advance Received',
        E: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ata',
    last: 'G',
    header: [
      { A: 'Summary For Amended Tax Liability(Advance Received)  ', B: 'Original details ', D: 'Revised details', G: 'HELP' },
      { F: 'Total Advance Received', G: 'Total Cess' },
      { F: 0, G: 0 },
      {
        A: 'Financial Year',
        B: 'Original Month',
        C: 'Original Place Of Supply',
        D: 'Applicable % of Tax Rate',
        E: 'Rate',
        F: 'Gross Advance Received',
        G: 'Cess Amount',
      },
    ],
  },
  {
    name: 'atadj',
    last: 'E',
    header: [
      { A: 'Summary For Advance Adjusted (11B)  ', E: 'HELP' },
      { D: 'Total Advance Adjusted', E: 'Total Cess' },
      { D: 0, E: 0 },
      {
        A: 'Place Of Supply',
        B: 'Applicable % of Tax Rate',
        C: 'Rate',
        D: 'Gross Advance Adjusted',
        E: 'Cess Amount',
      },
    ],
  },
  {
    name: 'atadja',
    last: 'G',
    header: [
      { A: 'Summary For Amendement Of Adjustment Advances', B: 'Original details ', D: 'Revised details', G: 'HELP' },
      { F: 'Total Advance Adjusted', G: 'Total Cess' },
      { F: 0, G: 0 },
      {
        A: 'Financial Year',
        B: 'Original Month',
        C: 'Original Place Of Supply',
        D: 'Applicable % of Tax Rate',
        E: 'Rate',
        F: 'Gross Advance Adjusted',
        G: 'Cess Amount',
      },
    ],
  },
  {
    name: 'exemp',
    last: 'D',
    header: [
      { A: 'Summary For Nil rated, exempted and non GST outward supplies (8)', D: 'HELP' },
      { B: 'Total Nil Rated Supplies', C: 'Total Exempted Supplies', D: 'Total Non-GST Supplies' },
      { B: 0, C: 0, D: 0 },
      {
        A: 'Description',
        B: 'Nil Rated Supplies',
        C: 'Exempted(other than nil rated/non GST supply)',
        D: 'Non-GST Supplies',
      },
    ],
  },
  {
    name: 'hsn(b2b)',
    last: 'K',
    header: [
      { A: 'Summary For HSN(12)', K: 'HELP' },
      {
        A: 'No. of HSN',
        E: 'Total Value',
        G: 'Total Taxable Value',
        H: 'Total Integrated Tax',
        I: 'Total Central Tax',
        J: 'Total State/UT Tax',
        K: 'Total Cess',
      },
      { A: 0, E: 0, G: 0, H: 0, I: 0, J: 0, K: 0 },
      {
        A: 'HSN',
        B: 'Description',
        C: 'UQC',
        D: 'Total Quantity',
        E: 'Total Value',
        F: 'Rate',
        G: 'Taxable Value',
        H: 'Integrated Tax Amount',
        I: 'Central Tax Amount',
        J: 'State/UT Tax Amount',
        K: 'Cess Amount',
      },
    ],
  },
  {
    name: 'hsn(b2c)',
    last: 'K',
    header: [
      { A: 'Summary For HSN(12)', K: 'HELP' },
      {
        A: 'No. of HSN',
        E: 'Total Value',
        G: 'Total Taxable Value',
        H: 'Total Integrated Tax',
        I: 'Total Central Tax',
        J: 'Total State/UT Tax',
        K: 'Total Cess',
      },
      { A: 0, E: 0, G: 0, H: 0, I: 0, J: 0, K: 0 },
      {
        A: 'HSN',
        B: 'Description',
        C: 'UQC',
        D: 'Total Quantity',
        E: 'Total Value',
        F: 'Rate',
        G: 'Taxable Value',
        H: 'Integrated Tax Amount',
        I: 'Central Tax Amount',
        J: 'State/UT Tax Amount',
        K: 'Cess Amount',
      },
    ],
  },
  {
    name: 'docs',
    last: 'E',
    header: [
      { A: 'Summary of documents issued during the tax period (13)', E: 'HELP' },
      { D: 'Total Number', E: 'Total Cancelled' },
      { D: 0, E: 0 },
      {
        A: 'Nature of Document',
        B: 'Sr. No. From',
        C: 'Sr. No. To',
        D: 'Total Number',
        E: 'Cancelled',
      },
    ],
  },
  {
    name: 'eco',
    last: 'H',
    header: [
      { A: 'Summary For Supplies through ECO-14', H: 'HELP' },
      {
        B: 'No. of E-Commerce Operator',
        D: 'Total Net Value of Supplies',
        E: 'Total Integrated Tax',
        F: 'Total Central Tax ',
        G: 'Total State/UT Tax ',
        H: 'Total Cess',
      },
      { B: 0, D: 0, E: 0, F: 0, G: 0, H: 0 },
      {
        A: 'Nature of Supply',
        B: 'GSTIN of E-Commerce Operator',
        C: 'E-Commerce Operator Name',
        D: 'Net value of supplies',
        E: 'Integrated tax',
        F: 'Central tax',
        G: 'State/UT tax',
        H: 'Cess',
      },
    ],
  },
  {
    name: 'ecoa',
    last: 'K',
    header: [
      { A: 'Summary For Amended Supplies through ECO-14A', B: 'Original details ', D: 'Revised details', K: 'HELP' },
      {
        D: 'No. of E-Commerce Operator',
        G: 'Total Net Value of Supplies',
        H: 'Total Integrated Tax',
        I: 'Total Central Tax ',
        J: 'Total State/UT Tax ',
        K: 'Total Cess',
      },
      { D: 0, G: 0, H: 0, I: 0, J: 0, K: 0 },
      {
        A: 'Nature of Supply',
        B: 'Financial Year',
        C: 'Original Month/Quarter',
        D: 'Original GSTIN of E-Commerce Operator',
        E: 'Revised GSTIN of E-Commerce Operator',
        F: 'E-Commerce Operator Name',
        G: 'Revised Net value of supplies',
        H: 'Integrated tax',
        I: 'Central tax',
        J: 'State/UT tax',
        K: 'Cess',
      },
    ],
  },
  {
    name: 'ecob2b',
    last: 'L',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15-B2B', L: 'HELP' },
      {
        A: 'No. of Supplier',
        C: 'No. of Recipients',
        E: 'No. of Documents',
        G: 'Total value of supplies made',
        K: 'Total Taxable Value',
        L: 'Total Cess',
      },
      { A: 0, C: 0, E: 0, G: 0, K: 0, L: 0 },
      {
        A: 'Supplier GSTIN/UIN',
        B: 'Supplier Name',
        C: 'Recipient GSTIN/UIN',
        D: 'Recipient Name',
        E: 'Document Number',
        F: 'Document Date',
        G: 'Value of supplies made',
        H: 'Place Of Supply',
        I: 'Document type',
        J: 'Rate',
        K: 'Taxable Value',
        L: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecourp2b',
    last: 'J',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15-URP2B', J: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Documents',
        E: 'Total value of supplies made',
        I: 'Total Taxable Value',
        J: 'Total Cess',
      },
      { A: 0, C: 0, E: 0, I: 0, J: 0 },
      {
        A: 'Recipient GSTIN/UIN',
        B: 'Recipient Name',
        C: 'Document Number',
        D: 'Document Date',
        E: 'Value of supplies made',
        F: 'Place Of Supply',
        G: 'Document type',
        H: 'Rate',
        I: 'Taxable Value',
        J: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecob2c',
    last: 'F',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15-B2C', F: 'HELP' },
      { A: 'No. of Supplier', D: 'Total Taxable Value', F: 'Total Cess' },
      { A: 0, D: 0, F: 0 },
      {
        A: 'Supplier GSTIN/UIN',
        B: 'Supplier Name',
        C: 'Place Of Supply',
        D: 'Taxable Value',
        E: 'Rate',
        F: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecourp2c',
    last: 'D',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15-URP2C', D: 'HELP' },
      { B: 'Total Taxable Value', D: 'Total Cess' },
      { B: 0, D: 0 },
      { A: 'Place Of Supply', B: 'Taxable Value', C: 'Rate', D: 'Cess Amount' },
    ],
  },
  {
    name: 'ecoab2b',
    last: 'N',
    header: [
      { A: 'Summary For Supplies U/s 9(5) - 15A-B2B', B: 'Original details ', G: 'Revised details ', N: 'HELP' },
      {
        A: 'No. of Supplier',
        C: 'No. of Recipients',
        E: 'No. of Documents',
        I: 'Total value of supplies made',
        M: 'Total Taxable Value',
        N: 'Total Cess',
      },
      { A: 0, C: 0, E: 0, I: 0, M: 0, N: 0 },
      {
        A: 'Supplier GSTIN/UIN',
        B: 'Supplier Name',
        C: 'Recipient GSTIN/UIN',
        D: 'Recipient Name',
        E: 'Original Document Number',
        F: 'Original Document Date',
        G: 'Revised Document Number',
        H: 'Revised Document Date',
        I: 'Value of supplies made',
        J: 'Place Of Supply',
        K: 'Document type',
        L: 'Rate',
        M: 'Taxable Value',
        N: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecoab2c',
    last: 'H',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15A-B2C', B: 'Original details ', E: 'Revised details ', H: 'HELP' },
      { C: 'No. of Supplier', G: 'Total Taxable Value', H: 'Total Cess' },
      { C: 0, G: 0, H: 0 },
      {
        A: 'Financial Year',
        B: 'Original Month',
        C: 'Supplier GSTIN/UIN',
        D: 'Supplier Name',
        E: 'Place Of Supply',
        F: 'Rate',
        G: 'Taxable Value',
        H: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecoaurp2b',
    last: 'L',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15A-URP2B', B: 'Original details ', E: 'Revised details ', L: 'HELP' },
      {
        A: 'No. of Recipients',
        C: 'No. of Documents',
        G: 'Total value of supplies made',
        K: 'Total Taxable Value',
        L: 'Total Cess',
      },
      { A: 0, C: 0, G: 0, K: 0, L: 0 },
      {
        A: 'Recipient GSTIN/UIN',
        B: 'Recipient Name',
        C: 'Original Document Number',
        D: 'Original Document Date',
        E: 'Revised Document Number',
        F: 'Revised Document Date',
        G: 'Value of supplies made',
        H: 'Document type',
        I: 'Place Of Supply',
        J: 'Rate',
        K: 'Taxable Value',
        L: 'Cess Amount',
      },
    ],
  },
  {
    name: 'ecoaurp2c',
    last: 'F',
    header: [
      { A: 'Summary For Supplies U/s 9(5)-15A-URP2C', B: 'Original details ', C: 'Revised details ', F: 'HELP' },
      { E: 'Total Taxable Value', F: 'Total Cess' },
      { E: 0, F: 0 },
      {
        A: 'Financial Year',
        B: 'Original Month',
        C: 'Place Of Supply',
        D: 'Rate',
        E: 'Taxable Value',
        F: 'Cess Amount',
      },
    ],
  },
];

const COL_KINDS: Record<string, Array<'s' | 'n'>> = {
  'b2b,sez,de': ['s', 's', 's', 's', 'n', 's', 's', 's', 's', 's', 'n', 'n', 'n'],
  b2ba: ['s', 's', 's', 's', 's', 's', 'n', 's', 's', 's', 's', 's', 'n', 'n', 'n'],
  b2cl: ['s', 's', 'n', 's', 's', 'n', 'n', 'n', 's'],
  b2cla: ['s', 's', 's', 's', 's', 'n', 's', 'n', 'n', 'n', 's'],
  b2cs: ['s', 's', 's', 'n', 'n', 'n', 's'],
  cdnr: ['s', 's', 's', 's', 's', 's', 's', 's', 'n', 's', 'n', 'n', 'n'],
  cdnra: ['s', 's', 's', 's', 's', 's', 's', 's', 's', 's', 'n', 's', 'n', 'n', 'n'],
  cdnur: ['s', 's', 's', 's', 's', 'n', 's', 'n', 'n', 'n'],
  cdnura: ['s', 's', 's', 's', 's', 's', 's', 'n', 's', 'n', 'n', 'n'],
  'hsn(b2b)': ['s', 's', 's', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'],
  'hsn(b2c)': ['s', 's', 's', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'],
  docs: ['s', 's', 's', 'n', 'n'],
};

function makeSheet(def: SheetDef, data: AoA): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  def.header.forEach((sparse, r) => {
    for (const [col, value] of Object.entries(sparse)) {
      if (value === '' || value == null) continue;
      const addr = XLSX.utils.encode_cell({ r, c: colIndex(col) });
      ws[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
    }
  });
  const kinds = COL_KINDS[def.name];
  const lastCol = colIndex(def.last);
  data.forEach((row, index) => {
    const r = 4 + index;
    row.forEach((value, c) => {
      if (c > lastCol || value === '' || value == null) return;
      const addr = XLSX.utils.encode_cell({ r, c });
      const kind = kinds?.[c] || (typeof value === 'number' ? 'n' : 's');
      if (kind === 'n') {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        ws[addr] = { t: 'n', v: n };
        return;
      }
      ws[addr] = { t: 's', v: String(value) };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(3, 3 + data.length), c: lastCol },
  });
  ws['!cols'] = sparseRow({ A: 22 }, def.last).map(() => ({ wch: 18 }));
  return ws;
}

export function buildGstr1ExcelWorkbook(result: Gstr1ExportResult): XLSX.WorkBook {
  const payload = result.payload;
  const parties = partyMap(result);
  const supplierState = gstinStateCode(result.summary.gstin) || '';
  const hsn = asRecord(payload.hsn);
  const data: Record<string, AoA> = {
    'b2b,sez,de': invoiceRows(payload.b2b, parties),
    b2ba: invoiceRows(payload.b2ba, parties, true),
    b2cl: b2clRows(payload.b2cl, supplierState),
    b2cla: b2clRows(payload.b2cla, supplierState, true),
    b2cs: b2csRows(payload.b2cs),
    cdnr: cdnrRows(payload.cdnr, parties),
    cdnra: cdnrRows(payload.cdnra, parties, true),
    cdnur: cdnurRows(payload.cdnur, supplierState),
    cdnura: cdnurRows(payload.cdnura, supplierState, true),
    'hsn(b2b)': hsnRows(hsn.hsn_b2b),
    'hsn(b2c)': hsnRows(hsn.hsn_b2c),
    docs: docsRows(payload.doc_issue),
  };

  const wb = XLSX.utils.book_new();
  const help = XLSX.utils.aoa_to_sheet([
    ['Invoice & other data upload for creation of GSTR 1'],
    ['GSTN Returns Offline Tool Excel workbook template V2.2'],
    [`GSTIN ${result.summary.gstin}`, `fp ${result.summary.fp}`, result.summary.periodLabel],
    ['Import this file in GST Offline Tool → Import Excel. Do not rename sheets or column headers.'],
    ['Dates are DD-MMM-YYYY text. Intra-state unregistered notes use CDNUR UR Type B2CS, not B2CL.'],
  ]);
  XLSX.utils.book_append_sheet(wb, help, 'Help Instruction');

  for (const def of SHEETS) {
    XLSX.utils.book_append_sheet(wb, makeSheet(def, data[def.name] || []), def.name);
  }
  return wb;
}

export function gstr1ExcelFilename(result: Gstr1ExportResult): string {
  const suffix = result.summary.mode === 'amendment' ? '_A' : '';
  return `${result.summary.gstin}_GSTR1_${result.summary.fp}${suffix}.xlsx`;
}

export function gstr1ExcelWarnings(result: Gstr1ExportResult): string[] {
  const supplierState = gstinStateCode(result.summary.gstin) || '';
  const notes = Array.isArray(result.payload.cdnur) ? (result.payload.cdnur as NoteRow[]) : [];
  let skipped = 0;
  for (const raw of notes) {
    const pos = gstr1ExcelPos(String(raw.pos || ''));
    const ur = cdnurUrType(String(raw.typ || ''), pos, supplierState);
    if (ur !== 'B2CL' || (supplierState && normalizeStateCode(pos) === supplierState)) skipped += 1;
  }
  if (!skipped) return [];
  return [
    `${skipped} intra-state unregistered credit/debit note(s) are not in Excel CDNUR. GST Offline Tool V2.2 only accepts B2CL there (place of supply must differ from your state). File those from the GSTR-1 JSON.`,
  ];
}

export function downloadGstr1Excel(result: Gstr1ExportResult): void {
  XLSX.writeFile(buildGstr1ExcelWorkbook(result), gstr1ExcelFilename(result), {
    bookSST: true,
    cellDates: false,
  });
}

export function gstr1ExcelSheetNames(): string[] {
  return ['Help Instruction', ...SHEETS.map((sheet) => sheet.name)];
}

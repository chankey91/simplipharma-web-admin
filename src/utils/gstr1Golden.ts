import type { GstDocumentSnapshot } from '../types/gst';
import { buildGstr1Payload, gstr1ItemDets, GSTR1_MAX_BYTES, gstr1PayloadSize } from './gstr1Json';
import { buildGstr1ExcelWorkbook } from './gstr1Excel';
import * as XLSX from 'xlsx';

const SELLER = '23AABCU9603R1ZX';
const BUYER = '27AAPFU0939F1ZV';

function mixedRateSnapshot(): GstDocumentSnapshot {
  return {
    sellerGstin: SELLER,
    buyerGstin: BUYER,
    buyerLegalName: 'Test Retailer',
    supplierStateCode: '23',
    placeOfSupplyStateCode: '27',
    supplyType: 'inter',
    invoiceType: 'B2B',
    reverseCharge: false,
    taxableValue: 1500,
    cgst: 0,
    sgst: 0,
    igst: 110,
    cess: 0,
    capturedAt: '2026-04-15T06:30:00.000Z',
    source: 'live',
    lines: [
      { hsn: '300490', gstRate: 5, qty: 10, taxableValue: 1000, taxAmount: 50 },
      { hsn: '300410', gstRate: 12, qty: 5, taxableValue: 500, taxAmount: 60 },
    ],
  };
}

/** Returns human-readable failures. Empty array means the GSTR-1 builder matches the golden file. */
export function gstr1GoldenErrors(): string[] {
  const errors: string[] = [];
  const gst = mixedRateSnapshot();
  const dets = gstr1ItemDets(gst);
  if (dets.length !== 2) errors.push(`expected 2 rate itms, got ${dets.length}`);
  const rates = dets.map((row) => row.rt).sort((a, b) => a - b);
  if (rates[0] !== 5 || rates[1] !== 12) errors.push(`expected rates 5 and 12, got ${rates.join(',')}`);
  const tx = dets.reduce((sum, row) => sum + row.txval, 0);
  const igst = dets.reduce((sum, row) => sum + row.iamt, 0);
  if (Math.abs(tx - 1500) > 0.05) errors.push(`itms taxable ${tx} != 1500`);
  if (Math.abs(igst - 110) > 0.05) errors.push(`itms IGST ${igst} != 110`);

  const result = buildGstr1Payload({
    gstin: SELLER,
    filingFrequency: 'monthly',
    skippedNoSnapshot: 0,
    date: new Date('2026-04-15T06:30:00+05:30'),
    documents: [
      {
        collection: 'orders',
        documentId: 'golden-1',
        kind: 'invoice',
        number: 'INV-GOLD-1',
        date: new Date('2026-04-15T06:30:00+05:30'),
        totalAmount: 1610,
        gst,
        hsnParts: [
          { hsn: '300490', qty: 10, net: 1000, gstRate: 5 },
          { hsn: '300410', qty: 5, net: 500, gstRate: 12 },
        ],
      },
    ],
    issuedInvoices: [{ number: 'INV-GOLD-1' }],
  });

  const b2b = result.payload.b2b as Array<{ ctin?: string; inv?: Array<{ itms?: unknown[] }> }>;
  const itms = b2b?.[0]?.inv?.[0]?.itms || [];
  if (itms.length !== 2) errors.push(`payload B2B itms length ${itms.length} != 2`);
  if (b2b?.[0]?.ctin !== BUYER) errors.push(`expected buyer GSTIN ${BUYER}`);

  if (result.payload.version || result.payload.hash || result.payload.filing_typ) {
    errors.push('GSTN Save schema 4.1 must not include version, hash, or filing_typ');
  }
  if (typeof result.payload.gt !== 'number' || typeof result.payload.cur_gt !== 'number') {
    errors.push('gt and cur_gt must be numbers');
  }
  const hsn = result.payload.hsn as
    | { hsn_b2b?: Array<{ hsn_sc: string; rt: number; user_desc?: string }>; hsn_b2c?: unknown[]; data?: unknown }
    | undefined;
  if (hsn?.data) errors.push('HSN must use hsn_b2b/hsn_b2c, not hsn.data');
  if (Array.isArray(hsn?.hsn_b2c) && hsn.hsn_b2c.length === 0) {
    errors.push('empty hsn_b2c arrays are rejected by GSTN 3.2.4');
  }
  const hsnRows = hsn?.hsn_b2b || [];
  if (hsnRows.length < 2) errors.push(`expected at least 2 HSN B2B rows, got ${hsnRows.length}`);
  if (!hsnRows.every((row) => row.user_desc)) errors.push('HSN rows need user_desc for the GST portal');

  const headerOnly = buildGstr1Payload({
    gstin: SELLER,
    filingFrequency: 'monthly',
    skippedNoSnapshot: 0,
    date: new Date('2026-04-15T06:30:00+05:30'),
    documents: [
      {
        collection: 'orders',
        documentId: 'legacy-1',
        kind: 'invoice',
        number: 'INV-LEGACY-1',
        date: new Date('2026-04-15T06:30:00+05:30'),
        totalAmount: 1610,
        gst: { ...gst, lines: undefined },
        hsnParts: [{ hsn: '300490', qty: 1, net: 1500, gstRate: 5 }],
      },
    ],
  });
  const legacyItms =
    (headerOnly.payload.b2b as Array<{ inv?: Array<{ itms?: Array<{ itm_det?: { rt?: number } }> }> }>)?.[0]
      ?.inv?.[0]?.itms || [];
  if (legacyItms.length !== 1) {
    errors.push(`legacy header snapshot should emit 1 itm, got ${legacyItms.length}`);
  }
  if (legacyItms[0]?.itm_det?.rt !== 5) {
    errors.push(
      `product GST 5% must not be inferred from tax/taxable (got ${legacyItms[0]?.itm_det?.rt})`
    );
  }

  const { byteLength } = gstr1PayloadSize(result.payload);
  if (byteLength > GSTR1_MAX_BYTES) errors.push('golden payload exceeded 5 MB');
  if (!result.summary.errors.length && result.summary.b2b !== 1) {
    errors.push(`expected 1 B2B invoice, got ${result.summary.b2b}`);
  }

  const excel = buildGstr1ExcelWorkbook(result);
  if (!excel.SheetNames.includes('b2b,sez,de') || !excel.SheetNames.includes('hsn(b2b)')) {
    errors.push('Excel workbook is missing GST Offline Tool V2.2 sheet names');
  }
  const b2bSheet = XLSX.utils.sheet_to_json(excel.Sheets['b2b,sez,de'], {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
  if (b2bSheet[3]?.[0] !== 'GSTIN/UIN of Recipient') {
    errors.push(`Excel B2B header mismatch: ${String(b2bSheet[3]?.[0])}`);
  }
  const excelRates = b2bSheet.slice(4).map((row) => Number(row[10]));
  if (!excelRates.includes(5) || !excelRates.includes(12)) {
    errors.push(`Excel B2B rates should be product GST 5 and 12, got ${excelRates.join(',')}`);
  }
  if (String(b2bSheet[4]?.[3] || '') !== '15-Apr-2026') {
    errors.push(`Excel invoice date must be DD-MMM-YYYY, got ${String(b2bSheet[4]?.[3])}`);
  }
  const intraNote = buildGstr1Payload({
    gstin: SELLER,
    filingFrequency: 'monthly',
    skippedNoSnapshot: 0,
    date: new Date('2026-04-15T06:30:00+05:30'),
    documents: [
      {
        collection: 'credit_notes',
        documentId: 'cn-ur-1',
        kind: 'credit_note',
        number: 'SPC202604001',
        date: new Date('2026-04-15T06:30:00+05:30'),
        totalAmount: 525,
        gst: {
          ...gst,
          buyerGstin: '',
          invoiceType: 'CDNUR',
          supplierStateCode: '23',
          placeOfSupplyStateCode: '23',
          supplyType: 'intra',
          taxableValue: 500,
          cgst: 12.5,
          sgst: 12.5,
          igst: 0,
          lines: [{ hsn: '300490', gstRate: 5, qty: 10, taxableValue: 500, taxAmount: 25 }],
        },
        hsnParts: [{ hsn: '300490', qty: 10, net: 500, gstRate: 5 }],
      },
    ],
  });
  const cdnurExcel = XLSX.utils.sheet_to_json(buildGstr1ExcelWorkbook(intraNote).Sheets.cdnur, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
  if (cdnurExcel.length > 4 && String(cdnurExcel[4]?.[0] || '')) {
    errors.push('intra-state CDNUR must be omitted from Excel (V2.2 rejects UR Type B2CS)');
  }
  const interNote = buildGstr1Payload({
    gstin: SELLER,
    filingFrequency: 'monthly',
    skippedNoSnapshot: 0,
    date: new Date('2026-04-15T06:30:00+05:30'),
    documents: [
      {
        collection: 'credit_notes',
        documentId: 'cn-ur-2',
        kind: 'credit_note',
        number: 'SPC202604002',
        date: new Date('2026-04-15T06:30:00+05:30'),
        totalAmount: 150000,
        gst: {
          ...gst,
          buyerGstin: '',
          invoiceType: 'CDNUR',
          supplierStateCode: '23',
          placeOfSupplyStateCode: '27',
          supplyType: 'inter',
          taxableValue: 142857.14,
          cgst: 0,
          sgst: 0,
          igst: 7142.86,
          lines: [{ hsn: '300490', gstRate: 5, qty: 10, taxableValue: 142857.14, taxAmount: 7142.86 }],
        },
        hsnParts: [{ hsn: '300490', qty: 10, net: 142857.14, gstRate: 5 }],
      },
    ],
  });
  const cdnurInter = XLSX.utils.sheet_to_json(buildGstr1ExcelWorkbook(interNote).Sheets.cdnur, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
  if (cdnurInter[4]?.[0] !== 'B2CL') {
    errors.push(`inter-state CDNUR Excel must be B2CL, got ${String(cdnurInter[4]?.[0])}`);
  }

  errors.push(...result.summary.errors);
  return errors;
}

export function assertGstr1Golden(): void {
  const errors = gstr1GoldenErrors();
  if (errors.length) {
    throw new Error(`GSTR-1 golden file failed:\n${errors.join('\n')}`);
  }
}

import type { GstDocumentSnapshot } from '../types/gst';
import { buildGstr1Payload, gstr1ItemDets, GSTR1_MAX_BYTES, gstr1PayloadSize } from './gstr1Json';

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

  const hsn = (result.payload.hsn as { data?: Array<{ hsn_sc: string; rt: number }> } | undefined)?.data || [];
  if (hsn.length < 2) errors.push(`expected at least 2 HSN rows, got ${hsn.length}`);

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
        hsnParts: [{ hsn: '300490', qty: 1, net: 1500 }],
      },
    ],
  });
  const legacyItms =
    (headerOnly.payload.b2b as Array<{ inv?: Array<{ itms?: unknown[] }> }>)?.[0]?.inv?.[0]?.itms || [];
  if (legacyItms.length !== 1) {
    errors.push(`legacy header snapshot should emit 1 itm, got ${legacyItms.length}`);
  }

  const { byteLength } = gstr1PayloadSize(result.payload);
  if (byteLength > GSTR1_MAX_BYTES) errors.push('golden payload exceeded 5 MB');
  if (!result.summary.errors.length && result.summary.b2b !== 1) {
    errors.push(`expected 1 B2B invoice, got ${result.summary.b2b}`);
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

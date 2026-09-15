import { downloadGstJson } from './gstDownload';
import { formatGstinDate, gstinFilingPeriod } from './gstPeriod';
import { snapGstRate } from './gstr1Json';
import { roundGst } from './gstTaxEngine';
import type { CompanyGstSettings, GstDocumentSnapshot } from '../types/gst';

export interface EinvoiceSource {
  number: string;
  date: Date;
  totalAmount: number;
  gst: GstDocumentSnapshot;
  buyerName?: string;
  buyerAddress?: string;
  buyerPincode?: string;
  buyerStateCode?: string;
  hsn?: string;
}

export interface EinvoiceExportResult {
  filename: string;
  payload: Record<string, unknown>;
  summary: {
    count: number;
    skipped: number;
    warnings: string[];
  };
}

function pin(raw?: string | null): number {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 6);
  return Number(digits) || 0;
}

function firstAddr(raw?: string | null): string {
  const line = String(raw || '')
    .split('\n')[0]
    .trim();
  return line.slice(0, 100) || 'NA';
}

export function buildEinvoicePayload(input: {
  settings: CompanyGstSettings;
  invoices: EinvoiceSource[];
  date: Date;
}): EinvoiceExportResult {
  const warnings: string[] = [];
  const inv: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const row of input.invoices) {
    const buyerGstin = row.gst.buyerGstin;
    if (row.gst.invoiceType !== 'B2B' || !buyerGstin) {
      skipped += 1;
      continue;
    }
    const rt = snapGstRate(
      row.gst.cgst + row.gst.sgst + row.gst.igst,
      row.gst.taxableValue
    );
    const loc = input.settings.state || 'NA';
    inv.push({
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: 'B2B',
        RegRev: row.gst.reverseCharge ? 'Y' : 'N',
        IgstOnIntra: 'N',
      },
      DocDtls: {
        Typ: 'INV',
        No: String(row.number).slice(0, 16),
        Dt: formatGstinDate(row.date).replace(/-/g, '/'),
      },
      SellerDtls: {
        Gstin: input.settings.gstin,
        LglNm: input.settings.legalName,
        TrdNm: input.settings.tradeName || input.settings.legalName,
        Addr1: firstAddr(input.settings.address),
        Loc: loc,
        Pin: pin(input.settings.pincode),
        Stcd: input.settings.stateCode || '23',
      },
      BuyerDtls: {
        Gstin: buyerGstin,
        LglNm: row.buyerName || row.gst.buyerLegalName || 'Buyer',
        Pos: row.gst.placeOfSupplyStateCode,
        Addr1: firstAddr(row.buyerAddress) || loc,
        Loc: loc,
        Pin: pin(row.buyerPincode) || pin(input.settings.pincode),
        Stcd: row.buyerStateCode || row.gst.placeOfSupplyStateCode,
      },
      ItemList: [
        {
          SlNo: '1',
          PrdDesc: 'Medicaments',
          IsServc: 'N',
          HsnCd: row.hsn || '300490',
          Qty: 1,
          Unit: 'NOS',
          UnitPrice: roundGst(row.gst.taxableValue),
          TotAmt: roundGst(row.gst.taxableValue),
          AssAmt: roundGst(row.gst.taxableValue),
          GstRt: rt,
          IgstAmt: roundGst(row.gst.igst),
          CgstAmt: roundGst(row.gst.cgst),
          SgstAmt: roundGst(row.gst.sgst),
          TotItemVal: roundGst(row.totalAmount),
        },
      ],
      ValDtls: {
        AssVal: roundGst(row.gst.taxableValue),
        CgstVal: roundGst(row.gst.cgst),
        SgstVal: roundGst(row.gst.sgst),
        IgstVal: roundGst(row.gst.igst),
        CesVal: roundGst(row.gst.cess || 0),
        TotInvVal: roundGst(row.totalAmount),
      },
    });
  }

  if (!input.settings.pincode) {
    warnings.push('Company pincode is missing — IRP upload may reject seller details.');
  }
  if (!inv.length) {
    warnings.push('No B2B invoices with a GST snapshot in this period.');
  }

  const fp = gstinFilingPeriod(input.date);
  return {
    filename: `einvoice_${fp}_${input.settings.gstin}.json`,
    payload: { Count: inv.length, Inv: inv },
    summary: { count: inv.length, skipped, warnings },
  };
}

export function downloadEinvoiceJson(result: EinvoiceExportResult): void {
  downloadGstJson(result.filename, result.payload);
}

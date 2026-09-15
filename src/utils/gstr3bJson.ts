import { roundGst } from './gstTaxEngine';
import { downloadGstJson } from './gstDownload';
import { gstinFilingPeriod, indianGstPeriod } from './gstPeriod';
import type { GstDocumentSnapshot } from '../types/gst';

export interface Gstr3bBucket {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr3bInterRow {
  pos: string;
  txval: number;
  iamt: number;
}

export interface Gstr3bExportResult {
  filename: string;
  payload: Record<string, unknown>;
  summary: {
    periodLabel: string;
    fp: string;
    gstin: string;
    outward: Gstr3bBucket;
    itc: Gstr3bBucket;
    interUnreg: Gstr3bInterRow[];
    inwardCount: number;
    outwardCount: number;
    warnings: string[];
  };
}

function emptyBucket(): Gstr3bBucket {
  return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
}

export function addSnapshot(
  bucket: Gstr3bBucket,
  gst: GstDocumentSnapshot,
  sign: 1 | -1
): Gstr3bBucket {
  return {
    txval: roundGst(bucket.txval + sign * gst.taxableValue),
    iamt: roundGst(bucket.iamt + sign * gst.igst),
    camt: roundGst(bucket.camt + sign * gst.cgst),
    samt: roundGst(bucket.samt + sign * gst.sgst),
    csamt: roundGst(bucket.csamt + sign * (gst.cess || 0)),
  };
}

export function buildGstr3bPayload(input: {
  gstin: string;
  date: Date;
  outward: Gstr3bBucket;
  itc: Gstr3bBucket;
  interUnreg: Gstr3bInterRow[];
  inwardNil: { inter: number; intra: number };
  outwardCount: number;
  inwardCount: number;
  warnings: string[];
}): Gstr3bExportResult {
  const fp = gstinFilingPeriod(input.date);
  const period = indianGstPeriod(input.date);
  const payload: Record<string, unknown> = {
    gstin: input.gstin,
    ret_period: fp,
    sup_details: {
      osup_det: input.outward,
      osup_zero: emptyBucket(),
      osup_nil_exmp: emptyBucket(),
      isup_rev: emptyBucket(),
      osup_nongst: { txval: 0 },
    },
    inter_sup: {
      unreg_details: input.interUnreg.filter((row) => row.txval || row.iamt),
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [
        { ty: 'IMPG', ...emptyBucket() },
        { ty: 'IMPS', ...emptyBucket() },
        { ty: 'ISRC', ...emptyBucket() },
        { ty: 'ISD', ...emptyBucket() },
        { ty: 'OTH', ...input.itc },
      ],
      itc_rev: [
        { ty: 'RUL', ...emptyBucket() },
        { ty: 'OTH', ...emptyBucket() },
      ],
      itc_net: input.itc,
      itc_inelg: [
        { ty: 'RUL', ...emptyBucket() },
        { ty: 'OTH', ...emptyBucket() },
      ],
    },
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: 0, intra: 0 },
        { ty: 'NONGST', ...input.inwardNil },
      ],
    },
  };

  return {
    filename: `returns_${fp}_GSTR3B_${input.gstin}.json`,
    payload,
    summary: {
      periodLabel: period.label,
      fp,
      gstin: input.gstin,
      outward: input.outward,
      itc: input.itc,
      interUnreg: input.interUnreg,
      inwardCount: input.inwardCount,
      outwardCount: input.outwardCount,
      warnings: input.warnings,
    },
  };
}

export function downloadGstr3bJson(result: Gstr3bExportResult): void {
  downloadGstJson(result.filename, result.payload);
}

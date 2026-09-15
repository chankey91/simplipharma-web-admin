import { loadGstPeriodBooks } from './gstPeriodBooks';
import { hasGstSnapshot } from '../utils/gstSnapshot';
import { normalizeStateCode } from '../utils/gstin';
import {
  addSnapshot,
  buildGstr3bPayload,
  type Gstr3bBucket,
  type Gstr3bExportResult,
  type Gstr3bInterRow,
} from '../utils/gstr3bJson';
import { isValidGstinFormat } from '../utils/gstin';
import { roundGst } from '../utils/gstTaxEngine';

function empty(): Gstr3bBucket {
  return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
}

export async function buildGstr3bExport(date = new Date()): Promise<Gstr3bExportResult> {
  const books = await loadGstPeriodBooks(date);
  const warnings: string[] = [];
  let outward = empty();
  let itc = empty();
  let outwardCount = 0;
  let inwardCount = 0;
  const interMap = new Map<string, Gstr3bInterRow>();

  const addInter = (pos: string, txval: number, iamt: number) => {
    const code = normalizeStateCode(pos) || '23';
    const row = interMap.get(code) || { pos: code, txval: 0, iamt: 0 };
    row.txval = roundGst(row.txval + txval);
    row.iamt = roundGst(row.iamt + iamt);
    interMap.set(code, row);
  };

  for (const order of books.orders) {
    if (!order.invoiceNumber || order.status === 'Pending' || order.status === 'Cancelled') continue;
    if (!hasGstSnapshot(order) || !order.gst) {
      warnings.push(`Sales invoice ${order.invoiceNumber} has no GST snapshot.`);
      continue;
    }
    outward = addSnapshot(outward, order.gst, 1);
    outwardCount += 1;
    if (order.gst.invoiceType === 'B2CL' || (order.gst.invoiceType === 'B2CS' && order.gst.supplyType === 'inter')) {
      addInter(order.gst.placeOfSupplyStateCode, order.gst.taxableValue, order.gst.igst);
    }
  }

  for (const note of books.creditNotes) {
    if (!hasGstSnapshot(note) || !note.gst) {
      warnings.push(`Credit note ${note.creditNoteNumber} has no GST snapshot.`);
      continue;
    }
    outward = addSnapshot(outward, note.gst, -1);
    outwardCount += 1;
  }

  for (const note of books.debitNotes) {
    if (!hasGstSnapshot(note) || !note.gst) {
      warnings.push(`Debit note ${note.debitNoteNumber} has no GST snapshot.`);
      continue;
    }
    outward = addSnapshot(outward, note.gst, 1);
    outwardCount += 1;
  }

  for (const invoice of books.purchases) {
    if (!hasGstSnapshot(invoice) || !invoice.gst) {
      warnings.push(`Purchase ${invoice.invoiceNumber} has no GST snapshot.`);
      continue;
    }
    if (!isValidGstinFormat(invoice.gst.sellerGstin || invoice.vendorGstin)) {
      warnings.push(`Purchase ${invoice.invoiceNumber} has no valid vendor GSTIN — ITC not claimed.`);
      continue;
    }
    itc = addSnapshot(itc, invoice.gst, 1);
    inwardCount += 1;
  }

  for (const ret of books.purchaseReturns) {
    if (!hasGstSnapshot(ret) || !ret.gst) continue;
    itc = addSnapshot(itc, ret.gst, -1);
  }

  return buildGstr3bPayload({
    gstin: books.settings.gstin,
    date,
    outward,
    itc,
    interUnreg: [...interMap.values()],
    inwardNil: { inter: 0, intra: 0 },
    outwardCount,
    inwardCount,
    warnings,
  });
}

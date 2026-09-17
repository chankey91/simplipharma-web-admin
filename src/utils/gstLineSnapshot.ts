import type { GstLineSnapshot } from '../types/gst';
import type { CreditNoteLine, OrderMedicine, PurchaseInvoiceItem, PurchaseReturnItem } from '../types';
import { roundGst } from './gstTaxEngine';

const DEFAULT_HSN = '300490';

export interface GstLinePart {
  hsn?: string;
  gstRate?: number;
  qty?: number;
  taxableValue: number;
}

function hsnOf(raw?: string | null): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 8) || DEFAULT_HSN;
}

function orderLineNet(item: OrderMedicine): number {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const disc = Number(item.discountPercentage) || 0;
  return Math.max(0, qty * price * (1 - disc / 100));
}

/** Scale line taxables/tax so they match the issued document totals. */
export function buildGstLineSnapshots(
  parts: GstLinePart[],
  documentTaxable: number,
  documentTax: number
): GstLineSnapshot[] {
  const cleaned = parts
    .map((part) => ({
      hsn: hsnOf(part.hsn),
      gstRate: Number(part.gstRate) > 0 ? Number(part.gstRate) : 0,
      qty: Number(part.qty) || 0,
      taxableValue: Math.max(0, Number(part.taxableValue) || 0),
    }))
    .filter((part) => part.taxableValue > 0 || part.qty > 0);
  if (!cleaned.length) return [];

  const targetTaxable = roundGst(documentTaxable);
  const targetTax = roundGst(documentTax);
  const rawTaxable = cleaned.reduce((sum, part) => sum + part.taxableValue, 0) || 1;
  const scaleT = targetTaxable / rawTaxable;

  const scaled = cleaned.map((part) => {
    const taxableValue = roundGst(part.taxableValue * scaleT);
    return {
      hsn: part.hsn,
      gstRate: part.gstRate,
      qty: part.qty,
      taxableValue,
      taxAmount: roundGst(taxableValue * (part.gstRate || 0) / 100),
    };
  });

  const rawTax = scaled.reduce((sum, row) => sum + row.taxAmount, 0);
  if (rawTax > 0) {
    const scaleX = targetTax / rawTax;
    for (const row of scaled) {
      row.taxAmount = roundGst(row.taxAmount * scaleX);
    }
  } else if (scaled.length) {
    scaled[scaled.length - 1].taxAmount = targetTax;
  }

  const last = scaled[scaled.length - 1];
  const taxableSum = scaled.reduce((sum, row) => sum + row.taxableValue, 0);
  const taxSum = scaled.reduce((sum, row) => sum + row.taxAmount, 0);
  last.taxableValue = roundGst(last.taxableValue + (targetTaxable - taxableSum));
  last.taxAmount = roundGst(last.taxAmount + (targetTax - taxSum));
  return scaled;
}

export function gstLinesFromOrderMedicines(
  items: OrderMedicine[] | undefined,
  documentTaxable: number,
  documentTax: number
): GstLineSnapshot[] {
  return buildGstLineSnapshots(
    (items || []).map((item) => ({
      hsn: item.hsn,
      gstRate: item.gstRate,
      qty: Number(item.quantity) || 0,
      taxableValue: orderLineNet(item),
    })),
    documentTaxable,
    documentTax
  );
}

export function gstLinesFromNoteItems(
  items: CreditNoteLine[] | undefined,
  documentTaxable: number,
  documentTax: number
): GstLineSnapshot[] {
  return buildGstLineSnapshots(
    (items || []).map((item) => ({
      hsn: item.hsn,
      gstRate: item.gstRate,
      qty: Number(item.quantity) || 0,
      taxableValue: Math.max(0, Number(item.refundAmount) || 0),
    })),
    documentTaxable,
    documentTax
  );
}

export function gstLinesFromPurchaseItems(
  items: Array<PurchaseInvoiceItem | PurchaseReturnItem> | undefined,
  documentTaxable: number,
  documentTax: number
): GstLineSnapshot[] {
  return buildGstLineSnapshots(
    (items || []).map((item) => ({
      gstRate: item.gstRate,
      qty: Number(item.quantity) || 0,
      taxableValue: Math.max(0, Number(item.totalAmount) || 0),
    })),
    documentTaxable,
    documentTax
  );
}

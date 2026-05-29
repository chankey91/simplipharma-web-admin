/**
 * Margin impact of order returns (credit notes) and expiry returns.
 * Sales reversal = refund ex-GST; COGS reversal = landed cost × returned qty (stock restored).
 */
import type { CreditNote, CreditNoteLine, PurchaseInvoice } from '../types';
import type { ExpiryReturnRequest } from '../services/expiryReturns';
import { buildPurchaseLandedCostLookup, type PurchaseLandedCostLookup } from './purchaseInvoiceLandedCost';
import { effectiveBatchUnitCost } from './orderLineMargin';
import { dateInMarginPeriod, coerceToDate, type MarginPeriodFilter } from './marginPeriod';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export type ReturnMarginLine = {
  source: 'order_return' | 'expiry_return';
  referenceId: string;
  referenceLabel: string;
  date: Date;
  retailerLabel?: string;
  medicineName?: string;
  batchNumber?: string;
  quantity: number;
  salesReversalExGst: number;
  cogsReversalExGst: number;
  grossProfitReversalExGst: number;
};

export type ReturnMarginSummary = {
  lines: ReturnMarginLine[];
  salesReversalExGst: number;
  cogsReversalExGst: number;
  grossProfitReversalExGst: number;
  orderReturnDocCount: number;
  expiryReturnDocCount: number;
};

function refundExGst(refundInclGst: number, gstRate: number): number {
  const r = toNum(gstRate) || 5;
  const total = toNum(refundInclGst);
  if (total <= 0) return 0;
  return total / (1 + r / 100);
}

function lineCogsReversalExGst(
  medicineId: string | undefined,
  batchNumber: string | undefined,
  quantity: number,
  medicines: any[],
  purchaseLookup?: PurchaseLandedCostLookup
): number {
  const qty = toNum(quantity);
  if (qty <= 0 || !medicineId || !batchNumber) return 0;
  const med = medicines.find((m) => m.id === medicineId);
  const batch = med?.stockBatches?.find((b: any) => b.batchNumber === batchNumber);
  const unitCost = effectiveBatchUnitCost(batch, {
    medicineId,
    batchNumber,
    purchaseLookup,
  });
  return unitCost * qty;
}

function creditNoteLinesToMarginRows(
  note: CreditNote,
  medicines: any[],
  purchaseLookup?: PurchaseLandedCostLookup
): ReturnMarginLine[] {
  const date = coerceToDate(note.creditNoteDate ?? note.createdAt);
  const retailerLabel = note.retailerName || note.retailerEmail;
  return (note.items || []).map((line: CreditNoteLine) => {
    const refund = toNum(line.refundAmount) || toNum(line.unitRefundPrice) * toNum(line.quantity);
    const sales = refundExGst(refund, line.gstRate);
    const cogs = lineCogsReversalExGst(
      line.medicineId,
      line.batchNumber,
      line.quantity,
      medicines,
      purchaseLookup
    );
    return {
      source: 'order_return' as const,
      referenceId: note.id,
      referenceLabel: note.creditNoteNumber,
      date,
      retailerLabel,
      medicineName: line.medicineName,
      batchNumber: line.batchNumber,
      quantity: toNum(line.quantity),
      salesReversalExGst: sales,
      cogsReversalExGst: cogs,
      grossProfitReversalExGst: sales - cogs,
    };
  });
}

function expiryReturnToMarginRows(
  req: ExpiryReturnRequest,
  medicines: any[],
  purchaseLookup?: PurchaseLandedCostLookup
): ReturnMarginLine[] {
  const date = coerceToDate(req.approvedAt ?? req.paidAt ?? req.createdAt);
  const retailerLabel = req.retailerName || req.retailerEmail;
  return (req.items || []).map((item) => {
    const med = medicines.find((m) => m.id === item.medicineId);
    const gstRate = toNum(med?.gstRate) || 5;
    const refund = toNum(item.refundAmount) || toNum(item.unitRefundPrice) * toNum(item.quantity);
    const sales = refundExGst(refund, gstRate);
    const cogs = lineCogsReversalExGst(
      item.medicineId,
      item.batchNumber,
      item.quantity,
      medicines,
      purchaseLookup
    );
    return {
      source: 'expiry_return' as const,
      referenceId: req.id,
      referenceLabel: req.id,
      date,
      retailerLabel,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      quantity: toNum(item.quantity),
      salesReversalExGst: sales,
      cogsReversalExGst: cogs,
      grossProfitReversalExGst: sales - cogs,
    };
  });
}

const EXPIRY_RETURN_MARGIN_STATUSES = new Set(['approved', 'paid']);

export function computeReturnMarginSummary(
  creditNotes: CreditNote[] | undefined,
  expiryReturns: ExpiryReturnRequest[] | undefined,
  medicines: any[],
  period: MarginPeriodFilter,
  purchaseInvoices?: PurchaseInvoice[]
): ReturnMarginSummary {
  const purchaseLookup =
    purchaseInvoices && purchaseInvoices.length > 0
      ? buildPurchaseLandedCostLookup(purchaseInvoices)
      : undefined;

  const lines: ReturnMarginLine[] = [];
  const orderReturnIds = new Set<string>();
  const expiryReturnIds = new Set<string>();

  for (const note of creditNotes ?? []) {
    const date = coerceToDate(note.creditNoteDate ?? note.createdAt);
    if (!dateInMarginPeriod(date, period)) continue;
    orderReturnIds.add(note.id);
    lines.push(...creditNoteLinesToMarginRows(note, medicines, purchaseLookup));
  }

  for (const req of expiryReturns ?? []) {
    if (!EXPIRY_RETURN_MARGIN_STATUSES.has(req.status)) continue;
    const date = coerceToDate(req.approvedAt ?? req.paidAt ?? req.createdAt);
    if (!dateInMarginPeriod(date, period)) continue;
    expiryReturnIds.add(req.id);
    lines.push(...expiryReturnToMarginRows(req, medicines, purchaseLookup));
  }

  const salesReversalExGst = lines.reduce((s, l) => s + l.salesReversalExGst, 0);
  const cogsReversalExGst = lines.reduce((s, l) => s + l.cogsReversalExGst, 0);

  return {
    lines,
    salesReversalExGst,
    cogsReversalExGst,
    grossProfitReversalExGst: salesReversalExGst - cogsReversalExGst,
    orderReturnDocCount: orderReturnIds.size,
    expiryReturnDocCount: expiryReturnIds.size,
  };
}

/** Dashboard / turnover: expiry refunds (incl. GST) in period. */
export function sumExpiryRefundsInPeriod(
  expiryReturns: ExpiryReturnRequest[] | undefined,
  period: MarginPeriodFilter
): number {
  let sum = 0;
  for (const req of expiryReturns ?? []) {
    if (!EXPIRY_RETURN_MARGIN_STATUSES.has(req.status)) continue;
    const date = coerceToDate(req.approvedAt ?? req.paidAt ?? req.createdAt);
    if (!dateInMarginPeriod(date, period)) continue;
    sum += toNum(req.totalRefundAmount);
  }
  return sum;
}

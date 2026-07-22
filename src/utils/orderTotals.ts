import { Medicine } from '../types';
import { orderLineInvoiceEconomics } from './orderLineInvoiceEconomics';
import type { PurchaseBatchDiscountLookup } from './orderFulfillmentDiscount';

const toNum = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

/** Medicine lines that contribute to order value (not pending product requests). */
export function isBillableFulfillmentLine(line: {
  lineType?: string;
  medicineId?: string;
  batchNumber?: string;
  batchAllocations?: unknown[];
  price?: number;
  mrp?: number;
}): boolean {
  if (line.lineType === 'product_demand') return false;
  if (!line.medicineId) return false;
  return Boolean(
    line.batchNumber ||
      (line.batchAllocations && line.batchAllocations.length > 0) ||
      toNum(line.price) > 0 ||
      toNum(line.mrp) > 0
  );
}

export type OrderTotalsBreakdown = {
  billableLines: any[];
  subTotal: number;
  totalDiscount: number;
  taxAmount: number;
  calculatedTotal: number;
  roundoff: number;
  grandTotal: number;
  /**
   * When every billable line shares the same GST %, that rate (for UI labels).
   * Null when mixed rates (e.g. 5% + 18%) or no billable lines.
   */
  uniformTaxPercentage: number | null;
};

export function calculateOrderTotalsFromLines(
  lines: any[],
  medicines: Medicine[] | undefined,
  taxPercentage: number,
  purchaseLookup?: PurchaseBatchDiscountLookup,
  options?: { lockPersistedDiscount?: boolean }
): OrderTotalsBreakdown {
  const billableLines = lines.filter(isBillableFulfillmentLine);
  const fallbackTaxPct = taxPercentage || 5;

  let subTotal = 0;
  let totalDiscount = 0;
  let taxAmount = 0;
  const gstRates = new Set<number>();

  for (const item of billableLines) {
    const med = medicines?.find((m) => m.id === item.medicineId);
    const e = orderLineInvoiceEconomics(
      item,
      med,
      fallbackTaxPct,
      purchaseLookup,
      options
    );
    const lineGross = e.unitPrice * e.paidQty;
    const lineDiscount = (lineGross * e.discountPct) / 100;
    const lineTaxable = lineGross - lineDiscount;
    const lineGst = e.gstRate > 0 ? e.gstRate : fallbackTaxPct;

    subTotal += lineGross;
    totalDiscount += lineDiscount;
    taxAmount += (lineTaxable * lineGst) / 100;
    gstRates.add(lineGst);
  }

  const amountAfterDiscount = subTotal - totalDiscount;
  const calculatedTotal = amountAfterDiscount + taxAmount;
  const roundoff = calculatedTotal > 0 ? Math.round(calculatedTotal) - calculatedTotal : 0;
  const grandTotal = calculatedTotal > 0 ? Math.round(calculatedTotal) : 0;
  const uniformTaxPercentage = gstRates.size === 1 ? [...gstRates][0]! : null;

  return {
    billableLines,
    subTotal,
    totalDiscount,
    taxAmount,
    calculatedTotal,
    roundoff,
    grandTotal,
    uniformTaxPercentage,
  };
}

/**
 * Invoice-correct grand total for ledger / receivables / lists.
 * Prefers live line maths (same as GST PDF) when billable lines exist; otherwise stored totalAmount.
 */
export function resolveOrderInvoiceGrandTotal(
  order: {
    medicines?: any[];
    taxPercentage?: number;
    totalAmount?: number;
    status?: string;
  },
  medicinesCatalog?: Medicine[],
  purchaseLookup?: PurchaseBatchDiscountLookup
): number {
  const stored = toNum(order.totalAmount);
  const lines = order.medicines || [];
  if (!lines.length || order.status === 'Pending' || order.status === 'Cancelled') {
    return stored;
  }

  const breakdown = calculateOrderTotalsFromLines(
    lines,
    medicinesCatalog,
    order.taxPercentage || 5,
    purchaseLookup,
    { lockPersistedDiscount: true }
  );

  if (breakdown.billableLines.length > 0 && breakdown.grandTotal > 0) {
    return breakdown.grandTotal;
  }
  return stored;
}


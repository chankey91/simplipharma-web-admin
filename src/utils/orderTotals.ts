import { Medicine } from '../types';
import { orderLineInvoiceEconomics, orderLineTaxableBeforeDiscount } from './orderLineInvoiceEconomics';

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
};

export function calculateOrderTotalsFromLines(
  lines: any[],
  medicines: Medicine[] | undefined,
  taxPercentage: number
): OrderTotalsBreakdown {
  const billableLines = lines.filter(isBillableFulfillmentLine);
  const taxPct = taxPercentage || 5;

  const subTotal = billableLines.reduce((sum, item) => {
    const med = medicines?.find((m) => m.id === item.medicineId);
    return sum + orderLineTaxableBeforeDiscount(item, med, taxPct);
  }, 0);

  const totalDiscount = billableLines.reduce((sum, item) => {
    const med = medicines?.find((m) => m.id === item.medicineId);
    const e = orderLineInvoiceEconomics(item, med, taxPct);
    const lineAmt = e.unitPrice * e.paidQty;
    return sum + (lineAmt * e.discountPct) / 100;
  }, 0);

  const amountAfterDiscount = subTotal - totalDiscount;
  const taxAmount = (amountAfterDiscount * taxPct) / 100;
  const calculatedTotal = amountAfterDiscount + taxAmount;
  const roundoff = calculatedTotal > 0 ? Math.round(calculatedTotal) - calculatedTotal : 0;
  const grandTotal = calculatedTotal > 0 ? Math.round(calculatedTotal) : 0;

  return {
    billableLines,
    subTotal,
    totalDiscount,
    taxAmount,
    calculatedTotal,
    roundoff,
    grandTotal,
  };
}

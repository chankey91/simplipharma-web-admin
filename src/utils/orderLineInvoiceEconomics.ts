/**
 * Same economics as order tax invoice (`getOrderInvoiceHTML` in invoice.ts):
 * billable qty = scheme order-line display bill qty (same as invoice); unit price from first allocation MRP (or item).
 */
import { orderedUnitsFromAllocation, schemeOrderLineDisplayTotals } from './schemeFulfillment';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

const schemePair = (source: any) => ({
  paid: source?.schemePaidQty ?? source?.purchaseSchemeDeal,
  free: source?.schemeFreeQty ?? source?.purchaseSchemeFree,
});

const hasExplicitAllocationFreeQty = (allocs: any[] | undefined) =>
  allocs?.some(
    (a) => a.allocationFreeQty !== undefined && a.allocationFreeQty !== null
  ) ?? false;

export type OrderLineInvoiceEconomics = {
  totalO: number;
  schemeP?: number;
  schemeF?: number;
  paidQty: number;
  unitPrice: number;
  gstRate: number;
  discountPct: number;
};

/** `orderTaxPercentage` matches invoice: GST for rate-from-MRP uses item.gstRate if set, else order tax. */
export function orderLineInvoiceEconomics(
  item: any,
  medicine: { stockBatches?: any[] } | undefined,
  orderTaxPercentage?: number
): OrderLineInvoiceEconomics {
  const allocs = item.batchAllocations as any[] | undefined;

  let totalO = 0;
  let schemeP: number | undefined;
  let schemeF: number | undefined;

  if (allocs && allocs.length > 0) {
    totalO = allocs.reduce((s, a) => s + orderedUnitsFromAllocation(a), 0);
    for (const a of allocs) {
      const b = medicine?.stockBatches?.find((x: any) => x.batchNumber === a.batchNumber);
      const ap = schemePair(a);
      const bp = schemePair(b);
      const pp = toNum(ap.paid ?? bp.paid);
      const ff = toNum(ap.free ?? bp.free);
      if (pp > 0 && ff > 0) {
        schemeP = pp;
        schemeF = ff;
        break;
      }
    }
  } else {
    totalO = toNum(item.quantity);
    const b = medicine?.stockBatches?.find((x: any) => x.batchNumber === item.batchNumber);
    if (b) {
      const p = schemePair(b);
      const pp = toNum(p.paid);
      const ff = toNum(p.free);
      if (pp > 0 && ff > 0) {
        schemeP = pp;
        schemeF = ff;
      }
    }
  }

  let paidQty: number;
  if (schemeP !== undefined && schemeF !== undefined && schemeP > 0 && schemeF > 0 && totalO > 0) {
    if (hasExplicitAllocationFreeQty(allocs) && allocs && allocs.length > 0) {
      paidQty = allocs.reduce((s: number, a: any) => s + toNum(a.quantity), 0);
    } else {
      paidQty = schemeOrderLineDisplayTotals(totalO, schemeP, schemeF).billQty;
    }
  } else if (allocs && allocs.length > 0) {
    paidQty = allocs.reduce((s: number, a: any) => s + toNum(a.quantity), 0);
  } else {
    paidQty = toNum(item.quantity);
  }

  let mrp = toNum(item.mrp);
  if (!mrp && allocs?.[0]?.mrp) {
    mrp = toNum(allocs[0].mrp);
  }
  const taxFallback =
    orderTaxPercentage !== undefined && orderTaxPercentage !== null
      ? toNum(orderTaxPercentage) || 5
      : 5;
  const gstRate =
    item.gstRate !== undefined ? toNum(item.gstRate) : taxFallback;

  let unitPrice = 0;
  if (mrp > 0) {
    const afterDiscount = mrp * 0.8;
    unitPrice = afterDiscount / (1 + gstRate / 100);
  } else if (allocs?.[0]?.purchasePrice) {
    unitPrice = toNum(allocs[0].purchasePrice);
  } else {
    unitPrice = toNum(item.price);
  }

  const discountPct = toNum(item.discountPercentage);

  return {
    totalO,
    schemeP,
    schemeF,
    paidQty,
    unitPrice,
    gstRate,
    discountPct,
  };
}

/** Line amount before discount — matches invoice `price * paidQty`. */
export function orderLineTaxableBeforeDiscount(
  item: any,
  medicine: any | undefined,
  orderTaxPercentage?: number
): number {
  const e = orderLineInvoiceEconomics(item, medicine, orderTaxPercentage);
  return e.unitPrice * e.paidQty;
}

/**
 * Same economics as order tax invoice (`getOrderInvoiceHTML` in invoice.ts):
 * billable qty = scheme order-line display bill qty; unit price from PI purchase price when set, else item.price, else MRP formula.
 */
import {
  billablePaidFromAllocationSums,
  orderLineSchemeDisplayPhysical,
  schemeOrderLineDisplayTotals,
} from './schemeFulfillment';
import {
  type PurchaseBatchDiscountLookup,
  findStockBatch,
  resolveOrderLineDiscountPct,
  resolveSellDiscountPct,
  toSellDiscountBatch,
  unitPriceFromMrp,
} from './orderFulfillmentDiscount';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

const schemePair = (source: any) => ({
  paid: source?.schemePaidQty ?? source?.purchaseSchemeDeal,
  free: source?.schemeFreeQty ?? source?.purchaseSchemeFree,
});

/** Unit price for invoice totals — matches order-details price column (PI purchase price first). */
function resolveOrderLineUnitPrice(
  item: any,
  allocs: any[] | undefined,
  gstRate: number,
  medicine: { stockBatches?: any[] } | undefined,
  purchaseLookup?: PurchaseBatchDiscountLookup
): number {
  if (allocs && allocs.length > 0) {
    if (allocs.length === 1) {
      const fromAlloc = toNum(allocs[0].purchasePrice);
      if (fromAlloc > 0) return fromAlloc;
    } else {
      const sumPaid = allocs.reduce((s: number, a: any) => s + toNum(a.quantity), 0);
      const sumAmount = allocs.reduce(
        (s: number, a: any) => s + toNum(a.purchasePrice) * toNum(a.quantity),
        0
      );
      if (sumPaid > 0 && sumAmount > 0) return sumAmount / sumPaid;
    }
  }

  const fromItem = toNum(item.price);
  if (fromItem > 0) return fromItem;

  let mrp = toNum(item.mrp);
  if (!mrp && allocs?.[0]?.mrp) {
    mrp = toNum(allocs[0].mrp);
  }
  if (mrp > 0) {
    const batchNumber =
      item.batchNumber || (allocs?.[0]?.batchNumber as string | undefined);
    const batch = findStockBatch(medicine, batchNumber);
    const sellDisc = resolveSellDiscountPct({
      batch: toSellDiscountBatch(batch, batchNumber || '', mrp, gstRate),
      gstRate,
      medicineId: item.medicineId,
      batchNumber,
      purchaseLookup,
    });
    return unitPriceFromMrp(mrp, gstRate, sellDisc);
  }

  return 0;
}

export type OrderLineInvoiceEconomics = {
  totalO: number;
  schemeP?: number;
  schemeF?: number;
  paidQty: number;
  unitPrice: number;
  gstRate: number;
  discountPct: number;
};

/** Line GST: order line → allocation → medicine catalog → order tax (same as sales invoice PDF). */
export function orderLineInvoiceEconomics(
  item: any,
  medicine: { stockBatches?: any[]; gstRate?: number } | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseBatchDiscountLookup
): OrderLineInvoiceEconomics {
  const allocs = item.batchAllocations as any[] | undefined;

  let schemeP: number | undefined;
  let schemeF: number | undefined;

  if (allocs && allocs.length > 0) {
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

  const totalO = orderLineSchemeDisplayPhysical(item, schemeP, schemeF);

  let paidQty: number;
  if (schemeP !== undefined && schemeF !== undefined && schemeP > 0 && schemeF > 0 && totalO > 0) {
    paidQty = schemeOrderLineDisplayTotals(totalO, schemeP, schemeF).billQty;
  } else if (allocs && allocs.length > 0) {
    const sumPaid = allocs.reduce((s: number, a: any) => s + toNum(a.quantity), 0);
    const sumFree = allocs.reduce((s: number, a: any) => s + toNum(a.allocationFreeQty ?? 0), 0);
    paidQty = billablePaidFromAllocationSums(item, sumPaid, sumFree);
  } else {
    paidQty = toNum(item.quantity);
  }

  const taxFallback =
    orderTaxPercentage !== undefined && orderTaxPercentage !== null
      ? toNum(orderTaxPercentage) || 5
      : 5;
  let gstRate = item.gstRate !== undefined && item.gstRate !== null ? toNum(item.gstRate) : 0;
  if (gstRate <= 0 && allocs && allocs.length > 0) {
    for (const a of allocs) {
      const g = toNum(a.gstRate);
      if (g > 0) {
        gstRate = g;
        break;
      }
    }
  }
  if (gstRate <= 0) gstRate = toNum(medicine?.gstRate);
  if (gstRate <= 0) gstRate = taxFallback;

  const unitPrice = resolveOrderLineUnitPrice(
    item,
    allocs,
    gstRate,
    medicine,
    purchaseLookup
  );

  const discountManuallySet = (item as { discountManuallySet?: boolean }).discountManuallySet === true;
  let discountPct = 0;

  if (allocs && allocs.length > 0) {
    const resolved = allocs.map((a: any) => {
      const batch = findStockBatch(medicine, a.batchNumber);
      const gst = toNum(a.gstRate) || gstRate;
      return resolveOrderLineDiscountPct({
        itemDiscount: item.discountPercentage,
        allocationDiscount: a.discountPercentage,
        medicineId: item.medicineId,
        batchNumber: a.batchNumber,
        purchaseLookup,
        batch: toSellDiscountBatch(batch, a.batchNumber, toNum(a.mrp), gst),
        gstRate: gst,
        discountManuallySet,
      });
    });
    discountPct = resolved.reduce((best, pct) => Math.max(best, pct), 0);
  } else if (item.batchNumber) {
    const batch = findStockBatch(medicine, item.batchNumber);
    discountPct = resolveOrderLineDiscountPct({
      itemDiscount: item.discountPercentage,
      medicineId: item.medicineId,
      batchNumber: item.batchNumber,
      purchaseLookup,
      batch: toSellDiscountBatch(batch, item.batchNumber, toNum(item.mrp), gstRate),
      gstRate,
      discountManuallySet,
    });
  } else if (discountManuallySet) {
    discountPct = toNum(item.discountPercentage);
  }

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
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseBatchDiscountLookup
): number {
  const allocs = item.batchAllocations as any[] | undefined;
  if (allocs && allocs.length > 1) {
    const sumAmount = allocs.reduce(
      (s: number, a: any) => s + toNum(a.purchasePrice) * toNum(a.quantity),
      0
    );
    if (sumAmount > 0) return sumAmount;
  }

  const e = orderLineInvoiceEconomics(item, medicine, orderTaxPercentage, purchaseLookup);
  return e.unitPrice * e.paidQty;
}

/** Line amount after trade discount % — matches invoice line taxable. */
export function orderLineAmountAfterDiscount(
  item: any,
  medicine: any | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseBatchDiscountLookup
): number {
  const e = orderLineInvoiceEconomics(item, medicine, orderTaxPercentage, purchaseLookup);
  const base = e.unitPrice * e.paidQty;
  return base * (1 - e.discountPct / 100);
}

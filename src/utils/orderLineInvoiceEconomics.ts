/**
 * Canonical sales-order line economics for Order Details + GST invoice PDF.
 * Billable qty = scheme display bill qty; unit price = alloc sell rate → item.price → MRP formula
 * (never inventory cost PTR). Trade disc via resolveOrderLineDiscountPct.
 */
import {
  billablePaidFromAllocationSums,
  orderLineSchemeDisplayPhysical,
  roundSchemeQty,
  schemeOrderLineDisplayTotals,
} from './schemeFulfillment';
import {
  findBatchSchemeFromMedicineAndLine,
  resolveOrderLineSchemeParams,
} from './orderSchemeOverride';
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
  /** Free qty shown on invoice Free column (not charged). */
  freeQty: number;
  unitPrice: number;
  gstRate: number;
  discountPct: number;
};

/** Line GST: order line → allocation → medicine catalog → order tax (same as sales invoice PDF). */
export function orderLineInvoiceEconomics(
  item: any,
  medicine: { stockBatches?: any[]; gstRate?: number } | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseBatchDiscountLookup,
  options?: { lockPersistedDiscount?: boolean }
): OrderLineInvoiceEconomics {
  const allocs = item.batchAllocations as any[] | undefined;

  const batchScheme = findBatchSchemeFromMedicineAndLine(item, medicine);
  const schemeParams = resolveOrderLineSchemeParams(item, batchScheme);

  let schemeP: number | undefined;
  let schemeF: number | undefined;
  if (schemeParams.apply && schemeParams.schemePaidQty && schemeParams.schemeFreeQty) {
    schemeP = schemeParams.schemePaidQty;
    schemeF = schemeParams.schemeFreeQty;
  }

  const totalO = orderLineSchemeDisplayPhysical(item, schemeP, schemeF);

  let paidQty: number;
  let freeQty: number;
  if (!schemeParams.apply) {
    paidQty = roundSchemeQty(totalO > 0 ? totalO : toNum(item.quantity));
    freeQty = 0;
  } else if (schemeP !== undefined && schemeF !== undefined && schemeP > 0 && schemeF > 0 && totalO > 0) {
    const display = schemeOrderLineDisplayTotals(totalO, schemeP, schemeF);
    paidQty = display.billQty;
    freeQty = display.freeQty;
  } else if (allocs && allocs.length > 0) {
    const sumPaid = allocs.reduce((s: number, a: any) => s + toNum(a.quantity), 0);
    const sumFree = allocs.reduce((s: number, a: any) => s + toNum(a.allocationFreeQty ?? 0), 0);
    paidQty = billablePaidFromAllocationSums(item, sumPaid, sumFree);
    freeQty = sumFree;
  } else {
    paidQty = toNum(item.quantity);
    freeQty =
      item.freeQuantity !== undefined && item.freeQuantity !== null
        ? toNum(item.freeQuantity)
        : 0;
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
  const lockPersistedDiscount = options?.lockPersistedDiscount === true;
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
        lockPersistedDiscount,
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
      lockPersistedDiscount,
    });
  } else if (discountManuallySet || lockPersistedDiscount) {
    discountPct = toNum(item.discountPercentage);
  }

  return {
    totalO,
    schemeP,
    schemeF,
    paidQty,
    freeQty,
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
  purchaseLookup?: PurchaseBatchDiscountLookup,
  options?: { lockPersistedDiscount?: boolean }
): number {
  const allocs = item.batchAllocations as any[] | undefined;
  if (allocs && allocs.length > 1) {
    const sumAmount = allocs.reduce(
      (s: number, a: any) => s + toNum(a.purchasePrice) * toNum(a.quantity),
      0
    );
    if (sumAmount > 0) return sumAmount;
  }

  const e = orderLineInvoiceEconomics(
    item,
    medicine,
    orderTaxPercentage,
    purchaseLookup,
    options
  );
  return e.unitPrice * e.paidQty;
}

/** Line amount after trade discount % — matches invoice line taxable. */
export function orderLineAmountAfterDiscount(
  item: any,
  medicine: any | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseBatchDiscountLookup,
  options?: { lockPersistedDiscount?: boolean }
): number {
  const e = orderLineInvoiceEconomics(
    item,
    medicine,
    orderTaxPercentage,
    purchaseLookup,
    options
  );
  const base = e.unitPrice * e.paidQty;
  return base * (1 - e.discountPct / 100);
}

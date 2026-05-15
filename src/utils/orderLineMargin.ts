/**
 * Gross margin per order line: net sales (ex-GST, after line discount) minus COGS.
 * COGS uses purchase-invoice landed unit cost when available (not raw purchasePrice).
 */
import { orderLineInvoiceEconomics } from './orderLineInvoiceEconomics';
import {
  buildPurchaseLandedCostLookup,
  lookupLandedUnitCostExGst,
  type PurchaseLandedCostLookup,
} from './purchaseInvoiceLandedCost';
import { orderedUnitsFromAllocation, orderLinePhysicalO } from './schemeFulfillment';
import type { PurchaseInvoice } from '../types';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

const schemePair = (source: any) => ({
  paid: source?.schemePaidQty ?? source?.purchaseSchemeDeal,
  free: source?.schemeFreeQty ?? source?.purchaseSchemeFree,
});

/** Legacy fallback: raw purchasePrice with purchase-scheme blending. */
function legacyEffectiveBatchUnitCost(batch: any | undefined): number {
  if (!batch) return 0;
  const pp = toNum(batch.purchasePrice);
  if (pp <= 0) return 0;
  const paid = toNum(schemePair(batch).paid);
  const free = toNum(schemePair(batch).free);
  if (paid > 0 && free > 0) {
    return (pp * paid) / (paid + free);
  }
  return pp;
}

/**
 * Unit cost per physical strip (ex-GST).
 * Prefers PI landed cost (already spread over paid+free); falls back to PI lookup or legacy price.
 */
export function effectiveBatchUnitCost(
  batch: any | undefined,
  options?: {
    medicineId?: string;
    batchNumber?: string;
    purchaseLookup?: PurchaseLandedCostLookup;
  }
): number {
  const landedOnBatch = toNum(batch?.landedUnitCostExGst);
  if (landedOnBatch > 0) return landedOnBatch;

  const fromLookup = lookupLandedUnitCostExGst(
    options?.purchaseLookup,
    options?.medicineId ?? undefined,
    options?.batchNumber ?? batch?.batchNumber
  );
  if (fromLookup !== undefined && fromLookup > 0) return fromLookup;

  return legacyEffectiveBatchUnitCost(batch);
}

function findBatch(medicine: { stockBatches?: any[] } | undefined, batchNumber?: string) {
  if (!medicine?.stockBatches || !batchNumber) return undefined;
  return medicine.stockBatches.find((b: any) => b.batchNumber === batchNumber);
}

function allocationUnitsOut(allocation: any): number {
  return orderedUnitsFromAllocation(allocation);
}

function lineUnitsOutWithoutAllocations(item: any): number {
  const physical = orderLinePhysicalO(item);
  if (physical > 0) return physical;
  return toNum(item.quantity) + toNum(item.freeQuantity);
}

/** Net sales ex-GST after line discount (matches fulfillment subtotal − line discounts). */
export function orderLineNetSalesExGst(
  item: any,
  medicine: { stockBatches?: any[] } | undefined,
  orderTaxPercentage?: number
): number {
  const e = orderLineInvoiceEconomics(item, medicine, orderTaxPercentage);
  const beforeDisc = e.unitPrice * e.paidQty;
  return beforeDisc * (1 - e.discountPct / 100);
}

/** COGS ex-GST: landed unit cost × physical units shipped (paid + free). */
export function orderLineCogsExGst(
  item: any,
  medicine: { stockBatches?: any[] } | undefined,
  purchaseLookup?: PurchaseLandedCostLookup
): number {
  const costOpts = (batchNumber: string | undefined, batch: any | undefined) => ({
    medicineId: item.medicineId,
    batchNumber,
    purchaseLookup,
  });

  const allocs = item.batchAllocations as any[] | undefined;
  if (allocs && allocs.length > 0) {
    return allocs.reduce((sum: number, a: any) => {
      const batch = findBatch(medicine, a.batchNumber);
      const unitCost = effectiveBatchUnitCost(batch, costOpts(a.batchNumber, batch));
      return sum + unitCost * allocationUnitsOut(a);
    }, 0);
  }
  if (item.batchNumber) {
    const batch = findBatch(medicine, item.batchNumber);
    const unitCost = effectiveBatchUnitCost(batch, costOpts(item.batchNumber, batch));
    return unitCost * lineUnitsOutWithoutAllocations(item);
  }
  return 0;
}

export function orderLineGrossProfitExGst(
  item: any,
  medicine: { stockBatches?: any[] } | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseLandedCostLookup
): number {
  return (
    orderLineNetSalesExGst(item, medicine, orderTaxPercentage) -
    orderLineCogsExGst(item, medicine, purchaseLookup)
  );
}

export function orderLineMarginPct(
  item: any,
  medicine: { stockBatches?: any[] } | undefined,
  orderTaxPercentage?: number,
  purchaseLookup?: PurchaseLandedCostLookup
): number | null {
  const net = orderLineNetSalesExGst(item, medicine, orderTaxPercentage);
  if (net <= 0) return null;
  const gp = orderLineGrossProfitExGst(item, medicine, orderTaxPercentage, purchaseLookup);
  return (gp / net) * 100;
}

export type OrderLineMarginRow = {
  medicineId?: string;
  name?: string;
  netSalesExGst: number;
  cogsExGst: number;
  grossProfitExGst: number;
  marginPct: number | null;
};

export type OrderMarginSummary = {
  netSalesExGst: number;
  cogsExGst: number;
  grossProfitExGst: number;
  marginPct: number | null;
  lines: OrderLineMarginRow[];
};

export function computeOrderMarginSummary(
  medicines: any[],
  orderMedicines: any[],
  orderTaxPercentage?: number,
  purchaseInvoices?: PurchaseInvoice[]
): OrderMarginSummary {
  const taxPct = orderTaxPercentage;
  const purchaseLookup =
    purchaseInvoices && purchaseInvoices.length > 0
      ? buildPurchaseLandedCostLookup(purchaseInvoices)
      : undefined;
  const lines: OrderLineMarginRow[] = [];
  let netSalesExGst = 0;
  let cogsExGst = 0;

  for (const item of orderMedicines) {
    const hasBatch =
      item.batchNumber || (item.batchAllocations && item.batchAllocations.length > 0);
    if (!hasBatch) continue;

    const med = medicines.find((m) => m.id === item.medicineId);
    const net = orderLineNetSalesExGst(item, med, taxPct);
    const cogs = orderLineCogsExGst(item, med, purchaseLookup);
    const gp = net - cogs;
    netSalesExGst += net;
    cogsExGst += cogs;
    lines.push({
      medicineId: item.medicineId,
      name: item.name,
      netSalesExGst: net,
      cogsExGst: cogs,
      grossProfitExGst: gp,
      marginPct: net > 0 ? (gp / net) * 100 : null,
    });
  }

  const grossProfitExGst = netSalesExGst - cogsExGst;
  return {
    netSalesExGst,
    cogsExGst,
    grossProfitExGst,
    marginPct: netSalesExGst > 0 ? (grossProfitExGst / netSalesExGst) * 100 : null,
    lines,
  };
}

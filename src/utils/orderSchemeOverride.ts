import {
  schemeLinePaidFreeConserved,
  splitSchemeAcrossAllocationPhysical,
  orderedUnitsFromAllocation,
  roundSchemeQty,
} from './schemeFulfillment';
import { findStockBatch } from './orderFulfillmentDiscount';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export type OrderSchemeLineFields = {
  orderSchemeApplied?: boolean;
  orderSchemePaidQty?: number;
  orderSchemeFreeQty?: number;
  orderSchemeManuallySet?: boolean;
};

export function getBatchSchemePair(
  batch: {
    schemePaidQty?: number;
    schemeFreeQty?: number;
    purchaseSchemeDeal?: number;
    purchaseSchemeFree?: number;
  } | null | undefined
): { schemePaidQty: number; schemeFreeQty: number } {
  return {
    schemePaidQty: toNum(batch?.schemePaidQty ?? batch?.purchaseSchemeDeal),
    schemeFreeQty: toNum(batch?.schemeFreeQty ?? batch?.purchaseSchemeFree),
  };
}

export function batchHasScheme(batch: unknown): boolean {
  const s = getBatchSchemePair(batch as { schemePaidQty?: number; schemeFreeQty?: number });
  return s.schemePaidQty > 0 && s.schemeFreeQty > 0;
}

/** First batch scheme from allocations or line batchNumber. */
export function findBatchSchemeFromMedicineAndLine(
  line: {
    batchNumber?: string;
    batchAllocations?: Array<{ batchNumber?: string; schemePaidQty?: number; schemeFreeQty?: number }>;
  },
  medicine?: { stockBatches?: Array<{ batchNumber?: string; schemePaidQty?: number; schemeFreeQty?: number }> }
): { schemePaidQty: number; schemeFreeQty: number } {
  const empty = { schemePaidQty: 0, schemeFreeQty: 0 };

  if (line.batchAllocations?.length) {
    for (const a of line.batchAllocations) {
      const fromAlloc = getBatchSchemePair(a);
      if (fromAlloc.schemePaidQty > 0 && fromAlloc.schemeFreeQty > 0) return fromAlloc;
      const b = findStockBatch(medicine, a.batchNumber);
      const fromBatch = getBatchSchemePair(b as { schemePaidQty?: number; schemeFreeQty?: number });
      if (fromBatch.schemePaidQty > 0 && fromBatch.schemeFreeQty > 0) return fromBatch;
    }
  }

  if (line.batchNumber) {
    const b = findStockBatch(medicine, line.batchNumber);
    const fromBatch = getBatchSchemePair(b as { schemePaidQty?: number; schemeFreeQty?: number });
    if (fromBatch.schemePaidQty > 0 && fromBatch.schemeFreeQty > 0) return fromBatch;
  }

  return empty;
}

/**
 * Effective scheme for this order line: off → no scheme; on → order override or batch default.
 */
export function resolveOrderLineSchemeParams(
  line: OrderSchemeLineFields,
  batchScheme: { schemePaidQty: number; schemeFreeQty: number }
): { apply: boolean; schemePaidQty?: number; schemeFreeQty?: number } {
  if (line.orderSchemeApplied === false) {
    return { apply: false };
  }

  const batchOk = batchScheme.schemePaidQty > 0 && batchScheme.schemeFreeQty > 0;
  const wantsApply =
    line.orderSchemeApplied === true || (line.orderSchemeApplied !== false && batchOk);

  if (!wantsApply) {
    return { apply: false };
  }

  if (line.orderSchemeManuallySet) {
    const p = Math.floor(toNum(line.orderSchemePaidQty));
    const f = Math.floor(toNum(line.orderSchemeFreeQty));
    if (p > 0 && f > 0) {
      return { apply: true, schemePaidQty: p, schemeFreeQty: f };
    }
  }

  if (batchOk) {
    return {
      apply: true,
      schemePaidQty: Math.floor(batchScheme.schemePaidQty),
      schemeFreeQty: Math.floor(batchScheme.schemeFreeQty),
    };
  }

  return { apply: false };
}

export function defaultOrderSchemeFieldsFromBatch(
  batch: unknown
): Pick<OrderSchemeLineFields, 'orderSchemeApplied' | 'orderSchemePaidQty' | 'orderSchemeFreeQty' | 'orderSchemeManuallySet'> {
  if (!batchHasScheme(batch)) {
    return { orderSchemeApplied: false, orderSchemeManuallySet: false };
  }
  const s = getBatchSchemePair(batch as { schemePaidQty?: number; schemeFreeQty?: number });
  return {
    orderSchemeApplied: true,
    orderSchemePaidQty: Math.floor(s.schemePaidQty),
    orderSchemeFreeQty: Math.floor(s.schemeFreeQty),
    orderSchemeManuallySet: false,
  };
}

/** Copy per-order scheme override fields onto a persisted medicine / invoice line. */
export function applyOrderSchemeFieldsToTarget(
  source: OrderSchemeLineFields,
  target: Record<string, unknown>
): void {
  if (source.orderSchemeApplied === false) target.orderSchemeApplied = false;
  else if (source.orderSchemeApplied === true) target.orderSchemeApplied = true;
  if (source.orderSchemeManuallySet === true) target.orderSchemeManuallySet = true;
  const paid = source.orderSchemePaidQty;
  const free = source.orderSchemeFreeQty;
  if (paid != null && Number.isFinite(Number(paid))) {
    target.orderSchemePaidQty = Math.floor(toNum(paid));
  }
  if (free != null && Number.isFinite(Number(free))) {
    target.orderSchemeFreeQty = Math.floor(toNum(free));
  }
}

/** Recompute paid/free on line + allocations after scheme toggle or edit. */
export function recomputeFulfillmentLineScheme(
  item: Record<string, unknown>,
  medicine?: { stockBatches?: Array<{ batchNumber?: string }> }
): Record<string, unknown> {
  const batchScheme = findBatchSchemeFromMedicineAndLine(
    item as { batchNumber?: string; batchAllocations?: Array<{ batchNumber?: string }> },
    medicine
  );
  const params = resolveOrderLineSchemeParams(item as OrderSchemeLineFields, batchScheme);
  const lineSplit = (physicalO: number) =>
    params.apply
      ? schemeLinePaidFreeConserved(physicalO, params.schemePaidQty, params.schemeFreeQty)
      : { paidQty: roundSchemeQty(physicalO), freeQty: 0 };

  const allocs = item.batchAllocations as Array<Record<string, unknown>> | undefined;
  if (!allocs?.length) {
    const lineQ = toNum(item.quantity);
    const lineFree = toNum(item.freeQuantity);
    const orig = toNum(item.originalQuantity);
    let physicalO = lineQ;
    if (lineFree > 0) physicalO = roundSchemeQty(lineQ + lineFree);
    else if (orig > lineQ) physicalO = orig;
    if (physicalO <= 0) return item;

    const split = lineSplit(physicalO);
    return {
      ...item,
      quantity: split.paidQty,
      freeQuantity: split.freeQty,
    };
  }

  const O = allocs.reduce((s, a) => s + orderedUnitsFromAllocation(a as Parameters<typeof orderedUnitsFromAllocation>[0]), 0);
  if (O <= 0) return item;

  const split = lineSplit(O);

  const processedAllocations = allocs.map((a) => {
    const qi = orderedUnitsFromAllocation(a as Parameters<typeof orderedUnitsFromAllocation>[0]);
    const { paid, free } = splitSchemeAcrossAllocationPhysical(
      qi,
      O,
      split.paidQty,
      split.freeQty
    );
    const next: Record<string, unknown> = {
      ...a,
      quantity: paid,
      allocationFreeQty: free,
    };
    if (params.apply && params.schemePaidQty && params.schemeFreeQty) {
      next.schemePaidQty = params.schemePaidQty;
      next.schemeFreeQty = params.schemeFreeQty;
    } else {
      delete next.schemePaidQty;
      delete next.schemeFreeQty;
    }
    return next;
  });

  return {
    ...item,
    batchAllocations: processedAllocations,
    quantity: split.paidQty,
    freeQuantity: split.freeQty,
  };
}

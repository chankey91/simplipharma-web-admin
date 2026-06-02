/**
 * Purchase-scheme split for order fulfillment (assign batch).
 * P = scheme pay-for qty, F = scheme get-free qty, O = physical strips (paid + free = O).
 *
 * All schemes use the same proportional rule on O:
 *   paid = O × P / (P + F)
 *   free = O × F / (P + F)
 * (rounded to 2 decimals; paid + free = O)
 */

/** Round scheme strip qty to 2 decimal places. */
export function roundSchemeQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Format scheme qty for UI (hide trailing .00). */
export function formatSchemeQty(value: number): string {
  const r = roundSchemeQty(value);
  if (Math.abs(r - Math.round(r)) < 1e-6) return String(Math.round(r));
  return r.toFixed(2);
}

/**
 * @deprecated Legacy slab split — kept for reference; use schemeLinePaidFreeConserved.
 */
export function computeSchemeFulfillmentSplit(
  orderedQty: number,
  schemePaidQty?: number,
  schemeFreeQty?: number
): { paidQty: number; freeQty: number } {
  return schemeLinePaidFreeConserved(orderedQty, schemePaidQty, schemeFreeQty);
}

/**
 * Paid / free strips that conserve physical O (paid + free = O) using proportional P : F.
 */
export function schemeLinePaidFreeConserved(
  physicalO: number,
  schemePaid?: number,
  schemeFree?: number
): { paidQty: number; freeQty: number } {
  const O = physicalO;
  const P = schemePaid ?? 0;
  const F = schemeFree ?? 0;
  if (!Number.isFinite(O) || O <= 0) {
    return { paidQty: 0, freeQty: 0 };
  }
  if (!Number.isFinite(P) || !Number.isFinite(F) || P <= 0 || F <= 0) {
    return { paidQty: roundSchemeQty(O), freeQty: 0 };
  }

  const denom = P + F;
  const paidQty = roundSchemeQty((O * P) / denom);
  const freeQty = roundSchemeQty(O - paidQty);
  return { paidQty, freeQty };
}

/** Free strips for a line — same as conserved split (paid + free = O). */
export function computeSchemeFulfillmentFreeQty(
  orderedQty: number,
  schemePaidQty?: number,
  schemeFreeQty?: number
): number {
  return schemeLinePaidFreeConserved(orderedQty, schemePaidQty, schemeFreeQty).freeQty;
}

/**
 * Order invoice / order-items UI: billable Qty, Free, Total — all conserve physical O.
 */
export function schemeOrderLineDisplayTotals(
  physicalO: number,
  schemePaid?: number,
  schemeFree?: number
): { billQty: number; freeQty: number; totalQty: number } {
  const P = schemePaid ?? 0;
  const F = schemeFree ?? 0;
  if (!(P > 0 && F > 0)) {
    return { billQty: roundSchemeQty(physicalO), freeQty: 0, totalQty: roundSchemeQty(physicalO) };
  }

  const { paidQty: billQty, freeQty } = schemeLinePaidFreeConserved(physicalO, P, F);
  return { billQty, freeQty, totalQty: roundSchemeQty(physicalO) };
}

/**
 * When summed allocation physical is just below a whole strip (e.g. 2.75) but scheme free matches the
 * "quarter slab" tier, bumping O by F/4 can land on a whole strip (3) with the **same** free qty and a
 * higher billable qty — matching how retailers count strips vs raw float sums.
 */
export function schemeBumpedPhysicalForOrderDisplay(
  physicalOFromAllocOrLine: number,
  schemeP: number,
  schemeF: number
): number {
  const P = schemeP;
  const F = schemeF;
  if (!(P > 0 && F > 0) || !Number.isFinite(physicalOFromAllocOrLine) || physicalOFromAllocOrLine <= 0) {
    return physicalOFromAllocOrLine;
  }
  const O0 = physicalOFromAllocOrLine;
  const step = F / 4;
  if (!(step > 0)) return O0;
  const O1 = O0 + step;
  const d0 = schemeOrderLineDisplayTotals(O0, P, F);
  const d1 = schemeOrderLineDisplayTotals(O1, P, F);
  if (Math.abs(d0.freeQty - d1.freeQty) > 1e-3) return O0;
  if (d1.billQty <= d0.billQty + 1e-9) return O0;
  /** Only snap up to the next whole-strip boundary (e.g. 2.75 → 3, not 3 → 3.25). */
  if (Math.abs(O1 - Math.ceil(O0 - 1e-9)) > 1e-6) return O0;
  return O1;
}

/** Physical O for scheme UI / invoice: max(line & allocs) then optional quarter-strip bump. */
export function orderLineSchemeDisplayPhysical(
  lineItem: {
    quantity?: number;
    originalQuantity?: number | null;
    batchAllocations?: Array<{ quantity?: number; allocationFreeQty?: number | null }>;
  },
  schemeP?: number | null,
  schemeF?: number | null
): number {
  const allocs = lineItem.batchAllocations;
  const sumPhys =
    allocs && allocs.length > 0
      ? allocs.reduce((s, a) => s + orderedUnitsFromAllocation(a), 0)
      : Number(lineItem.quantity) || 0;
  const P = Number(schemeP) || 0;
  const F = Number(schemeF) || 0;
  const base = Math.max(orderLinePhysicalO(lineItem, P, F), sumPhys);
  if (P > 0 && F > 0) {
    return schemeBumpedPhysicalForOrderDisplay(base, P, F);
  }
  return base;
}

/** Ordered / physical units represented by this allocation row */
export function orderedUnitsFromAllocation(allocation: {
  quantity?: number;
  allocationFreeQty?: number | null;
}): number {
  const q = Number(allocation.quantity) || 0;
  if (allocation.allocationFreeQty !== undefined && allocation.allocationFreeQty !== null) {
    const free = Number(allocation.allocationFreeQty) || 0;
    return roundSchemeQty(q + free);
  }
  return q;
}

/**
 * Physical strips on an order medicine line. Prefer max(line `quantity`, sum of allocation physical)
 * so scheme split uses the fulfilled line total when per-allocation paid+free sums drift below it.
 */
export function orderLinePhysicalO(
  lineItem: {
    quantity?: number;
    freeQuantity?: number | null;
    originalQuantity?: number | null;
    batchAllocations?: Array<{ quantity?: number; allocationFreeQty?: number | null }>;
  },
  schemeP?: number | null,
  schemeF?: number | null
): number {
  const lineQ = Number(lineItem.quantity) || 0;
  const allocs = lineItem.batchAllocations;
  if (!allocs || allocs.length === 0) {
    const freeQ = Number(lineItem.freeQuantity) || 0;
    const orig = Number(lineItem.originalQuantity) || 0;
    const P = Number(schemeP) || 0;
    const F = Number(schemeF) || 0;

    if (freeQ > 0 && P > 0 && F > 0) {
      const sumPhysical = roundSchemeQty(lineQ + freeQ);
      const fromSum = schemeOrderLineDisplayTotals(sumPhysical, P, F);
      if (Math.abs(fromSum.billQty - lineQ) < 0.02) {
        return sumPhysical;
      }
      const fromLineQ = schemeOrderLineDisplayTotals(lineQ, P, F);
      if (Math.abs(fromLineQ.totalQty - lineQ) < 1e-6 && Math.abs(fromLineQ.freeQty - freeQ) < 0.02) {
        return lineQ;
      }
    } else if (freeQ > 0 && lineQ + freeQ > lineQ + 1e-6) {
      return roundSchemeQty(lineQ + freeQ);
    }

    if (orig > lineQ && orig - lineQ <= 0.51) {
      return orig;
    }
    return lineQ;
  }
  const fromAllocs = allocs.reduce((s, a) => s + orderedUnitsFromAllocation(a), 0);
  let base = Math.max(lineQ, fromAllocs);
  /** If requested strips (original) are just above alloc sum, trust original (fixes paid/free drift vs true physical). */
  const orig = Number(lineItem.originalQuantity) || 0;
  if (orig > base && orig - base <= 0.51) {
    base = orig;
  }
  return base;
}

/**
 * Billable (paid) qty from allocation rows when not using scheme formulas: keep paid + free = line physical.
 * If summed paid+free is below `orderLinePhysicalO`, use physical − summed free (fixes stored paid rounding).
 */
export function billablePaidFromAllocationSums(
  lineItem: { quantity?: number; freeQuantity?: number | null; batchAllocations?: Array<any> },
  sumPaid: number,
  sumFree: number
): number {
  const physicalO = orderLinePhysicalO(lineItem);
  if (sumFree > 0) {
    return Math.max(0, roundSchemeQty(physicalO - sumFree));
  }
  return sumPaid;
}

/** Stock deduction = paid + scheme-applied free */
export function physicalQtyFromAllocation(allocation: {
  quantity?: number;
  allocationFreeQty?: number | null;
}): number {
  return orderedUnitsFromAllocation(allocation);
}

type SchemeAlloc = {
  quantity?: number;
  allocationFreeQty?: number | null;
  schemePaidQty?: number;
  schemeFreeQty?: number;
};

/** New rows: quantity = paid, allocationFreeQty = free. Legacy: quantity = physical O only. */
export function paidFreeFromAllocation(allocation: SchemeAlloc): { paid: number; free: number } {
  if (allocation.allocationFreeQty !== undefined && allocation.allocationFreeQty !== null) {
    return {
      paid: roundSchemeQty(Number(allocation.quantity) || 0),
      free: roundSchemeQty(Number(allocation.allocationFreeQty) || 0),
    };
  }
  const O = Number(allocation.quantity) || 0;
  const s = schemeLinePaidFreeConserved(
    O,
    allocation.schemePaidQty,
    allocation.schemeFreeQty
  );
  return { paid: s.paidQty, free: s.freeQty };
}

/** Split line-level paid/free across batch rows by physical share of O. */
export function splitSchemeAcrossAllocationPhysical(
  allocationPhysical: number,
  linePhysicalO: number,
  linePaid: number,
  lineFree: number
): { paid: number; free: number } {
  if (!(linePhysicalO > 0) || !(allocationPhysical > 0)) {
    return { paid: 0, free: 0 };
  }
  const free = roundSchemeQty((allocationPhysical / linePhysicalO) * lineFree);
  const paid = roundSchemeQty(allocationPhysical - free);
  return { paid, free };
}

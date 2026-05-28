/**
 * Purchase-scheme split for order fulfillment (assign batch).
 * P = scheme pay-for qty, F = scheme get-free qty, O = ordered / allocated units (same meaning as today: line total being fulfilled).
 *
 * - O >= P and O is a multiple of P: k = O/P → paid = k×P, free = k×F (raw sum may exceed O; see schemeLinePaidFreeConserved).
 * - O >= P with remainder r = O mod P: full slabs (k×P, k×F) plus the same half/quarter rules on r as for O < P.
 * - P/2 ≤ O < P: free = F/2, paid = O − free.
 * - P/4 ≤ O < P/2: free = F/4, paid = O − free.
 * - O < P/4: no scheme (paid = O, free = 0).
 */
export function computeSchemeFulfillmentSplit(
  orderedQty: number,
  schemePaidQty?: number,
  schemeFreeQty?: number
): { paidQty: number; freeQty: number } {
  const O = orderedQty;
  const P = schemePaidQty ?? 0;
  const F = schemeFreeQty ?? 0;
  if (!Number.isFinite(O) || O <= 0) {
    return { paidQty: 0, freeQty: 0 };
  }
  if (!Number.isFinite(P) || !Number.isFinite(F) || P <= 0 || F <= 0) {
    return { paidQty: O, freeQty: 0 };
  }

  const splitBelowFull = (x: number): { paid: number; free: number } => {
    if (x <= 0) return { paid: 0, free: 0 };
    if (x < P / 4) return { paid: x, free: 0 };
    if (x >= P) {
      return { paid: P, free: F };
    }
    if (x >= P / 2) {
      const freePart = F / 2;
      return { paid: x - freePart, free: freePart };
    }
    const freePart = F / 4;
    return { paid: x - freePart, free: freePart };
  };

  if (O < P) {
    const s = splitBelowFull(O);
    return { paidQty: s.paid, freeQty: s.free };
  }

  const k = Math.floor(O / P);
  const r = O - k * P;
  const basePaid = k * P;
  const baseFree = k * F;
  if (r <= 0) {
    return { paidQty: basePaid, freeQty: baseFree };
  }
  const rem = splitBelowFull(r);
  return {
    paidQty: basePaid + rem.paid,
    freeQty: baseFree + rem.free,
  };
}

/**
 * Paid / free strips that **conserve physical O** (paid + free = O) for fulfillment, UI, and billing.
 * When the raw split sums to something other than O (remainder rules), we round free from the
 * scaled ratio then set paid = O − free so stock and invoice line totals stay consistent.
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
    return { paidQty: O, freeQty: 0 };
  }

  const raw = computeSchemeFulfillmentSplit(O, P, F);
  const sum = raw.paidQty + raw.freeQty;
  if (Math.abs(sum - O) < 1e-6) {
    return { paidQty: raw.paidQty, freeQty: raw.freeQty };
  }
  if (sum <= 0) {
    return { paidQty: O, freeQty: 0 };
  }
  const scaledFree = raw.freeQty * (O / sum);
  let freeQty = Math.round(scaledFree);
  freeQty = Math.min(Math.max(0, freeQty), O);
  const paidQty = O - freeQty;
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
 * Order invoice / order-items UI: billable Qty, Free, Total — all conserve physical O (total = physical strips).
 */
export function schemeOrderLineDisplayTotals(
  physicalO: number,
  schemePaid?: number,
  schemeFree?: number
): { billQty: number; freeQty: number; totalQty: number } {
  const P = schemePaid ?? 0;
  const F = schemeFree ?? 0;
  if (!(P > 0 && F > 0)) {
    return { billQty: physicalO, freeQty: 0, totalQty: physicalO };
  }

  const { paidQty: billQty, freeQty } = schemeLinePaidFreeConserved(physicalO, P, F);
  return { billQty, freeQty, totalQty: physicalO };
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
    return q + (Number(allocation.allocationFreeQty) || 0);
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
      const sumPhysical = lineQ + freeQ;
      const fromSum = schemeOrderLineDisplayTotals(sumPhysical, P, F);
      if (Math.abs(fromSum.billQty - lineQ) < 0.02) {
        return sumPhysical;
      }
      const fromLineQ = schemeOrderLineDisplayTotals(lineQ, P, F);
      if (Math.abs(fromLineQ.totalQty - lineQ) < 1e-6 && Math.abs(fromLineQ.freeQty - freeQ) < 0.02) {
        return lineQ;
      }
    } else if (freeQ > 0 && lineQ + freeQ > lineQ + 1e-6) {
      return lineQ + freeQ;
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
    return Math.max(0, physicalO - sumFree);
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
      paid: Number(allocation.quantity) || 0,
      free: Number(allocation.allocationFreeQty) || 0,
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

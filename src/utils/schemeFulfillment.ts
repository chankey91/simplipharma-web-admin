/**
 * Purchase-scheme split for order fulfillment (assign batch).
 * P = scheme pay-for qty, F = scheme get-free qty, O = ordered / allocated units (same meaning as today: line total being fulfilled).
 *
 * - O >= P and O is a multiple of P: k = O/P → paid = O, free = k × F (e.g. 20 + 1 at 10+1 → paid 20, free 2).
 * - O >= P with remainder r = O mod P: full slabs (k×P, k×F) plus the same half/quarter rules on r as for O < P.
 * - P/2 ≤ O < P: free = F/2, paid = O − free.
 * - O < P/2: free = F/4, paid = O − free.
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

export function computeSchemeFulfillmentFreeQty(
  orderedQty: number,
  schemePaidQty?: number,
  schemeFreeQty?: number
): number {
  return computeSchemeFulfillmentSplit(orderedQty, schemePaidQty, schemeFreeQty).freeQty;
}

/**
 * Order invoice / order-items UI: Qty, Free, Total columns for complete slabs.
 * For odd pay-for P with +1 free (e.g. 9+1), retail often shows billable Qty as P+1 per slab (9 paid + 1 free strip → Qty 10).
 * For even P (e.g. 10+1), Qty stays k×P (e.g. 20,2,22).
 * Total = billQty + freeQty. Stock / fulfillment math still uses computeSchemeFulfillmentSplit on physical O.
 */
export function schemeOrderLineDisplayTotals(
  physicalO: number,
  schemePaid?: number,
  schemeFree?: number
): { billQty: number; freeQty: number; totalQty: number } {
  const P = schemePaid ?? 0;
  const F = schemeFree ?? 0;
  const split = computeSchemeFulfillmentSplit(physicalO, P, F);
  if (!(P > 0 && F > 0)) {
    return { billQty: physicalO, freeQty: 0, totalQty: physicalO };
  }
  if (physicalO >= P && physicalO % P === 0) {
    const k = physicalO / P;
    const oddPaySlabRetailBonus = F === 1 && P >= 3 && P % 2 === 1 ? 1 : 0;
    const billQty = k * P + k * oddPaySlabRetailBonus;
    const freeQty = k * F;
    return { billQty, freeQty, totalQty: billQty + freeQty };
  }

  let billQty = split.paidQty;
  let freeQty = split.freeQty;
  const splitSum = split.paidQty + split.freeQty;
  const hasNonIntegerBillOrFree =
    !Number.isInteger(billQty) || !Number.isInteger(freeQty);

  /** Half/quarter remainder rules can yield decimals; invoice/retail lines use whole strips. */
  if (hasNonIntegerBillOrFree && Number.isFinite(splitSum)) {
    const T = Math.round(splitSum * 1000) / 1000;
    let b = Math.round(split.paidQty);
    let f = T - b;
    if (f < 0) {
      b = Math.floor(split.paidQty);
      f = T - b;
    }
    if (f >= 0 && b >= 0) {
      billQty = b;
      freeQty = f;
    }
  }

  return {
    billQty,
    freeQty,
    totalQty: billQty + freeQty,
  };
}

/** Ordered / physical units represented by this allocation row */
export function orderedUnitsFromAllocation(allocation: {
  quantity?: number;
  allocationFreeQty?: number;
}): number {
  const q = Number(allocation.quantity) || 0;
  if (allocation.allocationFreeQty !== undefined && allocation.allocationFreeQty !== null) {
    return q + (Number(allocation.allocationFreeQty) || 0);
  }
  return q;
}

/** Stock deduction = paid + scheme-applied free */
export function physicalQtyFromAllocation(allocation: {
  quantity?: number;
  allocationFreeQty?: number;
}): number {
  return orderedUnitsFromAllocation(allocation);
}

type SchemeAlloc = {
  quantity?: number;
  allocationFreeQty?: number;
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
  const s = computeSchemeFulfillmentSplit(
    O,
    allocation.schemePaidQty,
    allocation.schemeFreeQty
  );
  return { paid: s.paidQty, free: s.freeQty };
}

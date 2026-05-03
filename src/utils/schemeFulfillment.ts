/**
 * Purchase-scheme split for order fulfillment (assign batch).
 * P = scheme pay-for qty, F = scheme get-free qty, O = ordered / allocated units (same meaning as today: line total being fulfilled).
 *
 * - O >= P and O is a multiple of P: k = O/P → paid = k×P, free = k×F (raw sum may exceed O; see schemeLinePaidFreeConserved).
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
  const s = schemeLinePaidFreeConserved(
    O,
    allocation.schemePaidQty,
    allocation.schemeFreeQty
  );
  return { paid: s.paidQty, free: s.freeQty };
}

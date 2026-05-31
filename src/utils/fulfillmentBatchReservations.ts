import type { Order } from '../types';
import { orderedUnitsFromAllocation } from './schemeFulfillment';
import { pickFulfillmentDraft } from './orderFulfillmentDraft';

export function batchReservationKey(medicineId: string, batchNumber: string): string {
  return `${medicineId}:${batchNumber}`;
}

function addReservation(
  map: Map<string, number>,
  medicineId: string,
  batchNumber: string,
  qty: number
): void {
  if (!medicineId || !batchNumber || qty <= 0) return;
  const key = batchReservationKey(medicineId, batchNumber);
  map.set(key, (map.get(key) || 0) + qty);
}

/** Sum physical qty reserved per medicine+batch from fulfillment medicine lines. */
export function accumulateFulfillmentReservationsFromLines(
  medicines: any[],
  into: Map<string, number>
): void {
  for (const line of medicines) {
    if ((line as { lineType?: string }).lineType === 'product_demand') continue;
    const medicineId = line.medicineId as string | undefined;
    if (!medicineId) continue;

    const allocs = line.batchAllocations as
      | Array<{ batchNumber?: string; quantity?: number; allocationFreeQty?: number | null }>
      | undefined;
    if (allocs?.length) {
      for (const alloc of allocs) {
        if (!alloc?.batchNumber) continue;
        addReservation(into, medicineId, alloc.batchNumber, orderedUnitsFromAllocation(alloc));
      }
    } else if (line.batchNumber) {
      const qty =
        orderedUnitsFromAllocation({
          quantity: line.quantity,
          allocationFreeQty: line.freeQuantity,
        }) || Number(line.quantity) || 0;
      if (qty > 0) {
        addReservation(into, medicineId, String(line.batchNumber), qty);
      }
    }
  }
}

/** Soft holds from other pending orders' in-progress fulfillment drafts. */
export function buildExternalPendingReservations(
  orders: Order[] | undefined,
  excludeOrderId: string
): Map<string, number> {
  const map = new Map<string, number>();
  if (!orders?.length) return map;
  for (const o of orders) {
    if (o.status !== 'Pending' || o.id === excludeOrderId) continue;
    const draft = pickFulfillmentDraft(o.id, o.fulfillmentDraft);
    if (draft?.medicines?.length) {
      accumulateFulfillmentReservationsFromLines(draft.medicines, map);
    }
  }
  return map;
}

export type BatchAvailabilityInfo = {
  stockQuantity: number;
  reservedElsewhere: number;
  reservedSameOrderOtherLines: number;
  /** Max physical units this order may still assign (excludes qty on the line being edited). */
  effectiveAvailable: number;
};

export function computeBatchAvailability(
  medicineId: string,
  batchNumber: string,
  stockQuantity: number,
  externalReservations: Map<string, number>,
  currentOrderLines: any[],
  options?: { excludeLineIndex?: number }
): BatchAvailabilityInfo {
  const key = batchReservationKey(medicineId, batchNumber);
  const reservedElsewhere = externalReservations.get(key) || 0;

  let reservedSameOrderOtherLines = 0;
  currentOrderLines.forEach((line, idx) => {
    if (options?.excludeLineIndex !== undefined && idx === options.excludeLineIndex) return;
    if ((line as { lineType?: string }).lineType === 'product_demand') return;
    if (line.medicineId !== medicineId) return;

    const allocs = line.batchAllocations || [];
    if (allocs.length) {
      for (const alloc of allocs) {
        if (alloc.batchNumber === batchNumber) {
          reservedSameOrderOtherLines += orderedUnitsFromAllocation(alloc);
        }
      }
    } else if (line.batchNumber === batchNumber) {
      reservedSameOrderOtherLines +=
        orderedUnitsFromAllocation({
          quantity: line.quantity,
          allocationFreeQty: line.freeQuantity,
        }) || Number(line.quantity) || 0;
    }
  });

  const effectiveAvailable = Math.max(
    0,
    stockQuantity - reservedElsewhere - reservedSameOrderOtherLines
  );

  return {
    stockQuantity,
    reservedElsewhere,
    reservedSameOrderOtherLines,
    effectiveAvailable,
  };
}

export type BatchStockConflict = {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  allocatedOnThisOrder: number;
  stockQuantity: number;
  reservedElsewhere: number;
  effectiveAvailable: number;
  overBy: number;
};

export function findBatchStockConflicts(
  orderLines: any[],
  externalReservations: Map<string, number>,
  getStockQuantity: (medicineId: string, batchNumber: string) => number,
  getMedicineName: (medicineId: string) => string
): BatchStockConflict[] {
  const onThisOrder = new Map<string, number>();
  const names = new Map<string, string>();

  for (const line of orderLines) {
    if ((line as { lineType?: string }).lineType === 'product_demand') continue;
    const medicineId = line.medicineId as string | undefined;
    if (!medicineId) continue;
    names.set(medicineId, line.name || getMedicineName(medicineId));

    const allocs = line.batchAllocations || [];
    if (allocs.length) {
      for (const alloc of allocs) {
        if (!alloc.batchNumber) continue;
        const key = batchReservationKey(medicineId, alloc.batchNumber);
        onThisOrder.set(key, (onThisOrder.get(key) || 0) + orderedUnitsFromAllocation(alloc));
      }
    } else if (line.batchNumber) {
      const key = batchReservationKey(medicineId, String(line.batchNumber));
      const qty =
        orderedUnitsFromAllocation({
          quantity: line.quantity,
          allocationFreeQty: line.freeQuantity,
        }) || Number(line.quantity) || 0;
      onThisOrder.set(key, (onThisOrder.get(key) || 0) + qty);
    }
  }

  const conflicts: BatchStockConflict[] = [];
  for (const [key, allocatedOnThisOrder] of onThisOrder) {
    const sep = key.indexOf(':');
    const medicineId = key.slice(0, sep);
    const batchNumber = key.slice(sep + 1);
    const stockQuantity = getStockQuantity(medicineId, batchNumber);
    const reservedElsewhere = externalReservations.get(key) || 0;
    const effectiveAvailable = Math.max(0, stockQuantity - reservedElsewhere);
    if (allocatedOnThisOrder > effectiveAvailable + 0.001) {
      conflicts.push({
        medicineId,
        medicineName: names.get(medicineId) || medicineId,
        batchNumber,
        allocatedOnThisOrder,
        stockQuantity,
        reservedElsewhere,
        effectiveAvailable,
        overBy: allocatedOnThisOrder - effectiveAvailable,
      });
    }
  }
  return conflicts;
}

export function formatBatchStockConflictMessage(conflicts: BatchStockConflict[]): string {
  return conflicts
    .map(
      (c) =>
        `${c.medicineName} / batch ${c.batchNumber}: ${c.allocatedOnThisOrder} allocated here, ` +
        `but only ${c.effectiveAvailable} available (${c.stockQuantity} in stock, ` +
        `${c.reservedElsewhere} reserved in other pending orders).`
    )
    .join('\n');
}

export function lineUsesConflictingBatch(
  line: any,
  conflictKeys: Set<string>
): boolean {
  if ((line as { lineType?: string }).lineType === 'product_demand') return false;
  const medicineId = line.medicineId as string | undefined;
  if (!medicineId) return false;

  const allocs = line.batchAllocations || [];
  if (allocs.length) {
    return allocs.some(
      (a: { batchNumber?: string }) =>
        a.batchNumber && conflictKeys.has(batchReservationKey(medicineId, a.batchNumber))
    );
  }
  if (line.batchNumber) {
    return conflictKeys.has(batchReservationKey(medicineId, String(line.batchNumber)));
  }
  return false;
}

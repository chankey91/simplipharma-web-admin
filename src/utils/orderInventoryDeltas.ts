import type { OrderMedicine } from '../types';
import { physicalQtyFromAllocation } from './schemeFulfillment';

export type OrderInventoryDelta = {
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  expiryDate?: unknown;
  mrp?: number;
  purchasePrice?: number;
};

function toNum(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function orderLineHasBatchAssignment(line: {
  lineType?: string;
  batchNumber?: string;
  batchAllocations?: Array<{ batchNumber?: string }> | undefined;
}): boolean {
  if (line.lineType === 'product_demand') return false;
  if (String(line.batchNumber || '').trim()) return true;
  return Array.isArray(line.batchAllocations) && line.batchAllocations.some((a) => Boolean(a?.batchNumber));
}

export function medicinesHaveBatchAssignments(
  medicines: Array<{
    lineType?: string;
    batchNumber?: string;
    batchAllocations?: Array<{ batchNumber?: string }> | undefined;
  }> | undefined
): boolean {
  return Boolean(medicines?.some((line) => orderLineHasBatchAssignment(line)));
}

function batchKey(batchNumber: string): string {
  return String(batchNumber || '').trim().toLowerCase();
}

/** Physical qty deducted/restored per medicine+batch from fulfilled order lines. */
export function collectOrderInventoryDeltas(
  medicines: OrderMedicine[] | Array<Record<string, unknown>> | undefined
): OrderInventoryDelta[] {
  if (!medicines?.length) return [];

  const byKey = new Map<string, OrderInventoryDelta>();

  const add = (delta: OrderInventoryDelta) => {
    const medicineId = String(delta.medicineId || '').trim();
    const batchNumber = String(delta.batchNumber || '').trim();
    const quantity = toNum(delta.quantity);
    if (!medicineId || !batchNumber || quantity <= 0) return;
    const key = `${medicineId}:${batchKey(batchNumber)}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.quantity += quantity;
      if (prev.expiryDate == null && delta.expiryDate != null) prev.expiryDate = delta.expiryDate;
      if (prev.mrp == null && delta.mrp != null) prev.mrp = delta.mrp;
      if (prev.purchasePrice == null && delta.purchasePrice != null) {
        prev.purchasePrice = delta.purchasePrice;
      }
      return;
    }
    byKey.set(key, {
      medicineId,
      medicineName: String(delta.medicineName || medicineId),
      batchNumber,
      quantity,
      expiryDate: delta.expiryDate,
      mrp: delta.mrp,
      purchasePrice: delta.purchasePrice,
    });
  };

  for (const raw of medicines) {
    const item = raw as OrderMedicine & { lineType?: string; name?: string };
    if (item.lineType === 'product_demand') continue;
    const medicineId = String(item.medicineId || '').trim();
    if (!medicineId) continue;
    const label = String(item.name || medicineId);

    if (item.batchAllocations && Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
      for (const allocation of item.batchAllocations) {
        const qty = physicalQtyFromAllocation(allocation);
        if (!allocation?.batchNumber || qty <= 0) continue;
        add({
          medicineId,
          medicineName: label,
          batchNumber: allocation.batchNumber,
          quantity: qty,
          expiryDate: allocation.expiryDate ?? (item as { expiryDate?: unknown }).expiryDate,
          mrp: allocation.mrp ?? item.mrp,
          purchasePrice: allocation.purchasePrice,
        });
      }
    } else if (item.batchNumber) {
      const qty = toNum(item.quantity) + toNum(item.freeQuantity);
      const restoreQty = qty > 0 ? qty : toNum(item.quantity);
      add({
        medicineId,
        medicineName: label,
        batchNumber: item.batchNumber,
        quantity: restoreQty,
        expiryDate: (item as { expiryDate?: unknown }).expiryDate,
        mrp: item.mrp,
      });
    }
  }

  return [...byKey.values()];
}

export function normalizeInventoryDeltas(raw: unknown): OrderInventoryDelta[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const byKey = new Map<string, OrderInventoryDelta>();
  for (const row of raw) {
    const r = row as Partial<OrderInventoryDelta>;
    const medicineId = String(r.medicineId || '').trim();
    const batchNumber = String(r.batchNumber || '').trim();
    const quantity = toNum(r.quantity);
    if (!medicineId || !batchNumber || quantity <= 0) continue;
    const key = `${medicineId}:${batchKey(batchNumber)}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.quantity += quantity;
      continue;
    }
    byKey.set(key, {
      medicineId,
      medicineName: String(r.medicineName || medicineId),
      batchNumber,
      quantity,
      expiryDate: r.expiryDate,
      mrp: r.mrp,
      purchasePrice: r.purchasePrice,
    });
  }
  return [...byKey.values()];
}

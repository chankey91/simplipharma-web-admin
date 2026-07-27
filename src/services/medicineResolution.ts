/**
 * Shared medicine resolution for purchase-invoice pickers and future auto-ingest.
 * Priority: pending-order masters → product demands (name hint) → inventory Typesense hits.
 */
import type { Medicine, Order } from '../types';
import type { ProductDemandRow } from './productDemandSearch';
import { deriveSearchMatchTokens } from './medicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';

export type MedicineResolveGroup = 'pending_order' | 'product_demand' | 'inventory';

/** Sortable group keys so MUI Autocomplete keeps section order. */
export const MEDICINE_RESOLVE_GROUP_LABEL: Record<MedicineResolveGroup, string> = {
  pending_order: '1 · On pending orders',
  product_demand: '2 · Product demands',
  inventory: '3 · Inventory',
};

export type MedicineResolveOption = {
  /** Stable Autocomplete key: medicine id or `demand:{id}`. */
  id: string;
  group: MedicineResolveGroup;
  groupLabel: string;
  label: string;
  /** When true, selecting applies a medicine master (batch can be added). */
  selectable: boolean;
  medicine?: Medicine;
  demand?: ProductDemandRow;
};

export function collectPendingOrderMedicineIds(orders: Order[] | undefined | null): string[] {
  const ids = new Set<string>();
  for (const order of orders || []) {
    if (String(order.status || '') !== 'Pending') continue;
    for (const line of order.medicines || []) {
      const id = String(line.medicineId || '').trim();
      if (!id) continue;
      ids.add(id);
    }
  }
  return [...ids];
}

function haystackMedicine(m: Medicine): string {
  return [m.name, m.productId, m.code, m.manufacturer, m.company]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

function haystackDemand(d: ProductDemandRow): string {
  return [d.productName, d.manufacturerName, d.retailerName]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

/** Token AND match (retailer-style); empty/short query → false. */
export function matchesResolveQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  const tokens = deriveSearchMatchTokens(q);
  if (tokens.length === 0) return haystack.includes(q);
  return tokens.every((t) => haystack.includes(t));
}

export function medicineMatchesResolveQuery(m: Medicine, query: string): boolean {
  return matchesResolveQuery(haystackMedicine(m), query);
}

export function demandMatchesResolveQuery(d: ProductDemandRow, query: string): boolean {
  return matchesResolveQuery(haystackDemand(d), query);
}

function medicineOption(
  medicine: Medicine,
  group: 'pending_order' | 'inventory'
): MedicineResolveOption {
  return {
    id: medicine.id,
    group,
    groupLabel: MEDICINE_RESOLVE_GROUP_LABEL[group],
    label: getMedicinePickerLabel(medicine),
    selectable: true,
    medicine,
  };
}

function demandOption(demand: ProductDemandRow): MedicineResolveOption {
  const mfr = demand.manufacturerName ? ` — ${demand.manufacturerName}` : '';
  const qty =
    demand.requestedQuantity > 0
      ? ` · qty ${demand.requestedQuantity}${demand.requestedUnit ? ` ${demand.requestedUnit}` : ''}`
      : '';
  return {
    id: `demand:${demand.id}`,
    group: 'product_demand',
    groupLabel: MEDICINE_RESOLVE_GROUP_LABEL.product_demand,
    label: `${demand.productName}${mfr}${qty} (request)`,
    selectable: false,
    demand,
  };
}

/**
 * Build grouped picker options. Does not call network — callers supply prefetched
 * pending masters / demands and current Typesense inventory hits.
 */
export function buildMedicineResolveOptions(args: {
  query: string;
  inventoryHits: Medicine[];
  pendingMedicines: Medicine[];
  pendingDemands: ProductDemandRow[];
  selectedMedicine?: Medicine | null;
  /** Max rows per section (keeps dropdown usable). */
  limitPerGroup?: number;
}): MedicineResolveOption[] {
  const q = args.query.trim();
  const limit = Math.max(5, args.limitPerGroup ?? 25);
  const out: MedicineResolveOption[] = [];
  const seenMedicineIds = new Set<string>();

  const pushMedicine = (m: Medicine, group: 'pending_order' | 'inventory') => {
    if (!m?.id || seenMedicineIds.has(m.id)) return;
    seenMedicineIds.add(m.id);
    out.push(medicineOption(m, group));
  };

  if (
    args.selectedMedicine &&
    q.length >= 2 &&
    q === getMedicinePickerLabel(args.selectedMedicine).trim()
  ) {
    pushMedicine(args.selectedMedicine, 'inventory');
    return out;
  }

  if (q.length < 2) {
    if (args.selectedMedicine) pushMedicine(args.selectedMedicine, 'inventory');
    return out;
  }

  const pendingHits = args.pendingMedicines
    .filter((m) => medicineMatchesResolveQuery(m, q))
    .slice(0, limit);
  for (const m of pendingHits) pushMedicine(m, 'pending_order');

  const demandHits = args.pendingDemands
    .filter((d) => demandMatchesResolveQuery(d, q))
    .slice(0, limit);
  for (const d of demandHits) out.push(demandOption(d));

  for (const m of args.inventoryHits.slice(0, limit)) {
    pushMedicine(m, 'inventory');
  }

  if (
    args.selectedMedicine &&
    !seenMedicineIds.has(args.selectedMedicine.id)
  ) {
    pushMedicine(args.selectedMedicine, 'inventory');
  }

  return out;
}

/**
 * Prefer a hit whose id is in `preferredIds` (pending-order masters), else first hit.
 * Used by PDF auto-match / future ingest.
 */
export function preferMedicineFromHits(
  hits: Medicine[],
  preferredIds: Iterable<string> | undefined
): Medicine | undefined {
  if (!hits.length) return undefined;
  const preferred = new Set(
    [...(preferredIds || [])].map((id) => String(id || '').trim()).filter(Boolean)
  );
  if (preferred.size === 0) return hits[0];
  const hit = hits.find((m) => preferred.has(m.id));
  return hit || hits[0];
}

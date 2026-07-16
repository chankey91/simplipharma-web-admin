/** Session overrides so Orders list shows healed totals before Typesense catches up. */

const STORAGE_KEY = 'simplipharma.orderTotalOverrides';

type OverrideMap = Record<string, number>;

function readMap(): OverrideMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OverrideMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: OverrideMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

export function setOrderTotalOverride(orderId: string, totalAmount: number): void {
  if (!orderId || !(totalAmount > 0)) return;
  const map = readMap();
  map[orderId] = totalAmount;
  writeMap(map);
}

export function clearOrderTotalOverride(orderId: string): void {
  const map = readMap();
  if (!(orderId in map)) return;
  delete map[orderId];
  writeMap(map);
}

/** Prefer override when present; clear it once the indexed amount matches. */
export function resolveOrderListTotalAmount(orderId: string, indexedTotal: number): number {
  const override = readMap()[orderId];
  if (override === undefined) return indexedTotal;
  if (Math.abs(override - indexedTotal) < 0.005) {
    clearOrderTotalOverride(orderId);
    return indexedTotal;
  }
  return override;
}

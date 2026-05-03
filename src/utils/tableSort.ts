/** Ascending comparison for strings, numbers, booleans; nulls last. */
export function compareAsc(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (a === b) return 0;
    return a ? 1 : -1;
  }
  const sa = typeof a === 'string' ? a : String(a);
  const sb = typeof b === 'string' ? b : String(b);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

export type SortDirection = 'asc' | 'desc';

export function applyDirection(cmp: number, direction: SortDirection): number {
  return direction === 'asc' ? cmp : -cmp;
}

/** Firestore Timestamp | Date | string | number → ms */
export function toTimeMs(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  const t = new Date(value as string | number).getTime();
  return Number.isFinite(t) ? t : 0;
}

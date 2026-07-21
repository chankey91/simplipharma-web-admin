/** Firestore Timestamp / FieldValue / Date — do not rebuild via Object.entries. */
function isFirestoreLeaf(value: object): boolean {
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  if (ctor === 'Timestamp' || ctor === 'FieldValue' || ctor === 'GeoPoint') return true;
  if (value instanceof Date) return true;
  // Modular SDK FieldValue sentinels often have _methodName
  if ('_methodName' in value) return true;
  // Timestamp-like
  if (
    typeof (value as { toMillis?: unknown }).toMillis === 'function' &&
    'seconds' in value &&
    'nanoseconds' in value
  ) {
    return true;
  }
  return false;
}

/** Remove undefined values before Firestore writes (setDoc/updateDoc reject undefined). */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as T;
  }
  if (value && typeof value === 'object') {
    if (isFirestoreLeaf(value as object)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
}

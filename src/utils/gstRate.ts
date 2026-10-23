/** Missing GST uses fallback (default 5). Zero is a valid rate. */
export function resolveGstRate(value: unknown, fallback = 5): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/** Parse an entered GST value. Empty → undefined; 0 stays 0. */
export function parseOptionalGstRate(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

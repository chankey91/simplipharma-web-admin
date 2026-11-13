import { normalizeCategoryKey } from './categoryMatch';

const INJECTION_CATEGORY_KEYS = new Set(['inj', 'injeciton', 'injaction']);

function timeMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'object' && value !== null) {
    const withMillis = value as { toMillis?: () => number; toDate?: () => Date; _seconds?: number };
    if (typeof withMillis.toMillis === 'function') {
      const t = withMillis.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof withMillis.toDate === 'function') {
      const t = withMillis.toDate()?.getTime?.();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof withMillis._seconds === 'number') return withMillis._seconds * 1000;
  }
  const t = new Date(value as string | number).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Latest lot by purchase date. Used for the one-time MRP check. */
export function pickLatestBatch<T extends { purchaseDate?: unknown }>(
  batches: T[] | null | undefined
): T | undefined {
  let latest: T | undefined;
  let latestMs = -1;
  for (const batch of batches || []) {
    if (!batch) continue;
    const ms = timeMs(batch.purchaseDate);
    if (!latest || ms >= latestMs) {
      latest = batch;
      latestMs = ms;
    }
  }
  return latest;
}

function isProteinPowder(name: string, categoryKey: string): boolean {
  if (
    categoryKey === 'protin powder' ||
    categoryKey === 'protein powder' ||
    categoryKey === 'protein power'
  ) {
    return true;
  }
  return (
    /protein\s+powders?/i.test(name) ||
    /protein\s+powers?/i.test(name) ||
    /protin\s+powders?/i.test(name) ||
    /whey\s+proteins?/i.test(name)
  );
}

/**
 * Name/category rule, plus MRP over 1000 when `mrp` is the latest batch MRP.
 * Category "Powder" alone is not protein powder.
 */
export function matchesDefaultNonReturnable(input: {
  name?: string | null;
  category?: string | null;
  mrp?: number | null;
}): boolean {
  const mrp = typeof input.mrp === 'number' ? input.mrp : Number.NaN;
  if (mrp > 1000) return true;

  const name = String(input.name || '');
  const category = String(input.category || '');
  const categoryKey = normalizeCategoryKey(category);
  const haystack = `${name} ${category}`;

  if (
    categoryKey.includes('injection') ||
    INJECTION_CATEGORY_KEYS.has(categoryKey) ||
    /\binjections?\b/i.test(name) ||
    /\binj\b/i.test(name)
  ) {
    return true;
  }
  if (/\bsoaps?\b/i.test(haystack)) return true;
  if (/\blotions?\b/i.test(haystack)) return true;
  if (isProteinPowder(name, categoryKey)) return true;
  return false;
}

/**
 * Master default.
 * Name/category (injection, protein powder, soap, lotion) applies to every product.
 * MRP over 1000 and an existing non-returnable flag apply only from the latest batch.
 */
export function defaultNonReturnableForMedicine(input: {
  name?: string | null;
  category?: string | null;
  stockBatches?: Array<{
    mrp?: number | null;
    nonReturnable?: boolean | null;
    purchaseDate?: unknown;
  }> | null;
}): boolean {
  const latest = pickLatestBatch(input.stockBatches);
  if (latest?.nonReturnable === true) return true;
  const batchMrp = latest && typeof latest.mrp === 'number' ? latest.mrp : undefined;
  return matchesDefaultNonReturnable({
    name: input.name,
    category: input.category,
    mrp: batchMrp,
  });
}

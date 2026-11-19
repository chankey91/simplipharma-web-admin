import type { CurrentLiveStockOffer } from '../services/liveStock';

const STOP = new Set([
  'tab',
  'tablet',
  'tablets',
  'cap',
  'caps',
  'capsule',
  'capsules',
  'mg',
  'ml',
  'syp',
  'syrup',
  'inj',
  'strip',
  'of',
  'the',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !STOP.has(token));
}

/** Same product: shared words agree, and a different strength does not match. */
function sameProduct(a: string, b: string): boolean {
  const at = tokens(a);
  const bt = tokens(b);
  if (!at.length || !bt.length) return false;
  const as = new Set(at);
  const bs = new Set(bt);
  const nums = (list: string[]) => list.filter((token) => /^\d+$/.test(token));
  const na = nums(at);
  const nb = nums(bt);
  if (na.length && nb.length && na.some((n) => !nb.includes(n))) return false;
  const extraOk = (token: string) =>
    /^\d+$/.test(token) || /^\d+x\d+$/.test(token) || /^\d+(gm|g|ml|mg|s)$/.test(token) || token === 's';
  if (at.some((token) => !bs.has(token) && !extraOk(token))) return false;
  if (bt.some((token) => !as.has(token) && !extraOk(token))) return false;
  const shared = at.filter((token) => bs.has(token)).length;
  return shared >= 1 && shared >= Math.min(at.length, bt.length);
}

function compareOffers(a: CurrentLiveStockOffer, b: CurrentLiveStockOffer, needQty: number): number {
  const need = Math.max(1, needQty);
  const coverA = a.stockQty >= need ? 0 : 1;
  const coverB = b.stockQty >= need ? 0 : 1;
  if (coverA !== coverB) return coverA - coverB;
  const priceA = a.effectiveRate ?? Number.POSITIVE_INFINITY;
  const priceB = b.effectiveRate ?? Number.POSITIVE_INFINITY;
  if (priceA !== priceB) return priceA - priceB;
  return b.stockQty - a.stockQty;
}

/** Up to three vendor names: full quantity first, then lowest effective rate. */
export function rankLiveStockVendors(
  productName: string,
  needQty: number,
  offers: CurrentLiveStockOffer[]
): string[] {
  const matched = offers.filter((offer) => sameProduct(productName, offer.productName));
  const byVendor = new Map<string, CurrentLiveStockOffer>();
  for (const offer of matched) {
    const current = byVendor.get(offer.vendorId);
    if (!current || compareOffers(offer, current, needQty) < 0) byVendor.set(offer.vendorId, offer);
  }
  return [...byVendor.values()]
    .sort((a, b) => compareOffers(a, b, needQty))
    .slice(0, 3)
    .map((offer) => offer.vendorName);
}

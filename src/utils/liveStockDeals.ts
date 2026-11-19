import type { CurrentLiveStockOffer } from '../services/liveStock';
import type { VendorSuggestion } from './vendorLastPurchase';

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

/** Percent off the vendor's rate, including scheme. Higher is a better discount. */
export function offerDiscountPercent(offer: {
  rate?: number | null;
  effectiveRate?: number | null;
  discountPercentage?: number | null;
}): { discount: number; known: boolean } {
  const rate = offer.rate;
  const effective = offer.effectiveRate;
  if (rate != null && rate > 0 && effective != null && effective >= 0 && effective <= rate) {
    return {
      discount: Math.round(((rate - effective) / rate) * 10000) / 100,
      known: true,
    };
  }
  const pct = offer.discountPercentage;
  if (pct != null && Number.isFinite(pct)) return { discount: Math.max(0, pct), known: true };
  return { discount: 0, known: false };
}

function compareOffers(a: CurrentLiveStockOffer, b: CurrentLiveStockOffer): number {
  const discountA = offerDiscountPercent(a).discount;
  const discountB = offerDiscountPercent(b).discount;
  if (discountA !== discountB) return discountB - discountA;
  return b.stockQty - a.stockQty;
}

/** One row per vendor whose stock file lists this product, including quantity 0. Discount, then stock. */
export function rankLiveStockVendors(
  productName: string,
  offers: CurrentLiveStockOffer[]
): VendorSuggestion[] {
  const matched = offers.filter((offer) => sameProduct(productName, offer.productName));
  const byVendor = new Map<string, CurrentLiveStockOffer>();
  for (const offer of matched) {
    const current = byVendor.get(offer.vendorId);
    if (!current || compareOffers(offer, current) < 0) byVendor.set(offer.vendorId, offer);
  }
  return [...byVendor.values()].map((offer) => {
    const priced = offerDiscountPercent(offer);
    return {
      vendorName: offer.vendorName,
      discount: priced.discount,
      stockQty: offer.stockQty,
      discountKnown: priced.known,
    };
  });
}

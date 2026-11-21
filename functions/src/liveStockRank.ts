/**
 * Rank a medicine against the current live-stock repository.
 * A file that lists the product is included even when the quantity is 0.
 * P1 is the best discount. Stock quantity breaks a tie.
 */
import * as admin from 'firebase-admin';
import { exportLiveStockHits } from './liveStockTypesense';

export type LiveStockOffer = {
  vendorId: string;
  vendorName: string;
  productName: string;
  manufacturer: string;
  pack: string;
  stockQty: number;
  rate: number | null;
  effectiveRate: number | null;
  discountPercentage: number | null;
  scheme: string;
  uploadedAtMs: number;
};

export type RankedDeal = {
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  vendorId: string;
  vendorName: string;
  productName: string;
  pack: string;
  stockQty: number;
  rate: number | null;
  effectiveRate: number | null;
  scheme: string;
  coversNeed: boolean;
};

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
  'injection',
  'strip',
  'of',
  'the',
  // Release and dispersible labels. Vendor files often leave these off.
  // Keep in step with src/utils/liveStockDeals.ts.
  'sr',
  'er',
  'xr',
  'cr',
  'mr',
  'pr',
  'dr',
  'ir',
  'dt',
  'md',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t && !STOP.has(t));
}

/** Same product: shared words agree. Strength still has to agree. OD and a lone letter such as H still separate products. */
export function sameProduct(a: string, b: string): boolean {
  const at = tokens(a);
  const bt = tokens(b);
  if (!at.length || !bt.length) return false;
  const as = new Set(at);
  const bs = new Set(bt);
  const nums = (list: string[]) => list.filter((t) => /^\d+$/.test(t));
  const na = nums(at);
  const nb = nums(bt);
  if (na.length && nb.length && na.some((n) => !nb.includes(n))) return false;
  // Pack tokens such as 1x10 or 50gm sit on the stock description and are not a different medicine.
  // A lone letter such as H still blocks the match, so Telma does not match Telma H.
  const extraOk = (t: string) => /^\d+$/.test(t) || /^\d+x\d+$/.test(t) || /^\d+(gm|g|ml|mg|s)$/.test(t) || t === 's';
  if (at.some((t) => !bs.has(t) && !extraOk(t))) return false;
  if (bt.some((t) => !as.has(t) && !extraOk(t))) return false;
  const shared = at.filter((t) => bs.has(t)).length;
  return shared >= 1 && shared >= Math.min(at.length, bt.length);
}

export function effectivePurchaseRate(
  rate: number | null | undefined,
  schemePaidQty?: number | null,
  schemeFreeQty?: number | null,
  discountPercentage?: number | null
): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  let unit = rate;
  if (schemePaidQty && schemeFreeQty && schemePaidQty > 0 && schemeFreeQty > 0) {
    unit = (rate * schemePaidQty) / (schemePaidQty + schemeFreeQty);
  }
  if (discountPercentage && discountPercentage > 0 && discountPercentage < 100) {
    unit = unit * (1 - discountPercentage / 100);
  }
  return Math.round(unit * 100) / 100;
}

let offerCache: { at: number; offers: LiveStockOffer[] } | null = null;

export async function loadLiveStockOffers(
  db: admin.firestore.Firestore
): Promise<LiveStockOffer[]> {
  if (offerCache && Date.now() - offerCache.at < 60_000) return offerCache.offers;
  const [hits, readySnap] = await Promise.all([
    exportLiveStockHits(),
    db.collection('liveStockUploads').where('status', '==', 'ready').select('rowCount').get(),
  ]);
  const readyUploadIds = new Set(readySnap.docs.map((doc) => doc.id));
  const rows: LiveStockOffer[] = [];
  for (const hit of hits) {
    if (!readyUploadIds.has(hit.uploadId)) continue;
    rows.push({
      vendorId: hit.vendorId,
      vendorName: hit.vendorName,
      productName: hit.productName,
      manufacturer: hit.manufacturer,
      pack: hit.pack,
      stockQty: hit.stockQty,
      rate: hit.rate,
      effectiveRate: hit.effectiveRate,
      discountPercentage: hit.discountPercentage,
      scheme: hit.scheme,
      uploadedAtMs: hit.uploadedAtMs,
    });
  }

  const latest = new Map<string, number>();
  for (const row of rows) {
    const prev = latest.get(row.vendorId) ?? 0;
    if (row.uploadedAtMs >= prev) latest.set(row.vendorId, row.uploadedAtMs);
  }
  const current = rows.filter((row) => row.uploadedAtMs === (latest.get(row.vendorId) ?? 0));
  offerCache = { at: Date.now(), offers: current };
  return current;
}

export function rankDeals(
  productName: string,
  needQty: number,
  offers: LiveStockOffer[]
): RankedDeal[] {
  const matched = offers.filter((offer) => sameProduct(productName, offer.productName));
  const byVendor = new Map<string, LiveStockOffer>();
  for (const offer of matched) {
    const current = byVendor.get(offer.vendorId);
    if (!current || betterOffer(offer, current)) byVendor.set(offer.vendorId, offer);
  }
  const ranked = [...byVendor.values()].sort((a, b) => compareOffers(a, b));
  const labels = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
  return ranked.slice(0, 5).map((offer, index) => ({
    priority: labels[index],
    vendorId: offer.vendorId,
    vendorName: offer.vendorName,
    productName: offer.productName,
    pack: offer.pack,
    stockQty: offer.stockQty,
    rate: offer.rate,
    effectiveRate: offer.effectiveRate,
    scheme: offer.scheme,
    coversNeed: offer.stockQty >= Math.max(1, needQty),
  }));
}

function discountPercent(offer: LiveStockOffer): number {
  const rate = offer.rate;
  const effective = offer.effectiveRate;
  if (rate != null && rate > 0 && effective != null && effective >= 0 && effective <= rate) {
    return Math.round(((rate - effective) / rate) * 10000) / 100;
  }
  if (offer.discountPercentage != null && offer.discountPercentage > 0) return offer.discountPercentage;
  return 0;
}

function betterOffer(next: LiveStockOffer, current: LiveStockOffer): boolean {
  return compareOffers(next, current) < 0;
}

function compareOffers(a: LiveStockOffer, b: LiveStockOffer): number {
  const discountA = discountPercent(a);
  const discountB = discountPercent(b);
  if (discountA !== discountB) return discountB - discountA;
  return b.stockQty - a.stockQty;
}

/**
 * Rank a medicine against the current live-stock repository.
 * P1 is the best discount. Stock quantity breaks a tie.
 */
import * as admin from 'firebase-admin';

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
  'strip',
  'of',
  'the',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t && !STOP.has(t));
}

/** Same product: shared words agree, and a different strength (40 vs 10, or an extra H) does not match. */
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

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function loadLiveStockOffers(
  db: admin.firestore.Firestore
): Promise<LiveStockOffer[]> {
  const snap = await db.collection('liveStockOffers').select(
    'vendorId',
    'vendorName',
    'productName',
    'manufacturer',
    'pack',
    'stockQty',
    'rate',
    'effectiveRate',
    'discountPercentage',
    'scheme',
    'uploadedAtMs'
  ).get();
  const rows: LiveStockOffer[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const vendorId = String(d.vendorId || '').trim();
    const productName = String(d.productName || '').trim();
    if (!vendorId || !productName) continue;
    const stockQty = asNumber(d.stockQty) ?? 0;
    rows.push({
      vendorId,
      vendorName: String(d.vendorName || ''),
      productName,
      manufacturer: String(d.manufacturer || ''),
      pack: String(d.pack || ''),
      stockQty,
      rate: asNumber(d.rate),
      effectiveRate: asNumber(d.effectiveRate),
      discountPercentage: asNumber(d.discountPercentage),
      scheme: String(d.scheme || ''),
      uploadedAtMs: asNumber(d.uploadedAtMs) ?? 0,
    });
  }

  const latest = new Map<string, number>();
  for (const row of rows) {
    const prev = latest.get(row.vendorId) ?? 0;
    if (row.uploadedAtMs >= prev) latest.set(row.vendorId, row.uploadedAtMs);
  }
  return rows.filter((row) => row.uploadedAtMs === (latest.get(row.vendorId) ?? 0));
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameProduct = sameProduct;
exports.effectivePurchaseRate = effectivePurchaseRate;
exports.loadLiveStockOffers = loadLiveStockOffers;
exports.rankDeals = rankDeals;
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
function tokens(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t && !STOP.has(t));
}
/** Same product: shared words agree, and a different strength (40 vs 10, or an extra H) does not match. */
function sameProduct(a, b) {
    const at = tokens(a);
    const bt = tokens(b);
    if (!at.length || !bt.length)
        return false;
    const as = new Set(at);
    const bs = new Set(bt);
    const nums = (list) => list.filter((t) => /^\d+$/.test(t));
    const na = nums(at);
    const nb = nums(bt);
    if (na.length && nb.length && na.some((n) => !nb.includes(n)))
        return false;
    // Pack tokens such as 1x10 or 50gm sit on the stock description and are not a different medicine.
    // A lone letter such as H still blocks the match, so Telma does not match Telma H.
    const extraOk = (t) => /^\d+$/.test(t) || /^\d+x\d+$/.test(t) || /^\d+(gm|g|ml|mg|s)$/.test(t) || t === 's';
    if (at.some((t) => !bs.has(t) && !extraOk(t)))
        return false;
    if (bt.some((t) => !as.has(t) && !extraOk(t)))
        return false;
    const shared = at.filter((t) => bs.has(t)).length;
    return shared >= 1 && shared >= Math.min(at.length, bt.length);
}
function effectivePurchaseRate(rate, schemePaidQty, schemeFreeQty, discountPercentage) {
    if (rate == null || !Number.isFinite(rate) || rate <= 0)
        return null;
    let unit = rate;
    if (schemePaidQty && schemeFreeQty && schemePaidQty > 0 && schemeFreeQty > 0) {
        unit = (rate * schemePaidQty) / (schemePaidQty + schemeFreeQty);
    }
    if (discountPercentage && discountPercentage > 0 && discountPercentage < 100) {
        unit = unit * (1 - discountPercentage / 100);
    }
    return Math.round(unit * 100) / 100;
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (value == null || value === '')
        return null;
    const n = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}
async function loadLiveStockOffers(db) {
    var _a, _b, _c;
    const snap = await db.collection('liveStockOffers').select('vendorId', 'vendorName', 'productName', 'manufacturer', 'pack', 'stockQty', 'rate', 'effectiveRate', 'discountPercentage', 'scheme', 'uploadedAtMs').get();
    const rows = [];
    for (const doc of snap.docs) {
        const d = doc.data();
        const vendorId = String(d.vendorId || '').trim();
        const productName = String(d.productName || '').trim();
        if (!vendorId || !productName)
            continue;
        const stockQty = (_a = asNumber(d.stockQty)) !== null && _a !== void 0 ? _a : 0;
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
            uploadedAtMs: (_b = asNumber(d.uploadedAtMs)) !== null && _b !== void 0 ? _b : 0,
        });
    }
    const latest = new Map();
    for (const row of rows) {
        const prev = (_c = latest.get(row.vendorId)) !== null && _c !== void 0 ? _c : 0;
        if (row.uploadedAtMs >= prev)
            latest.set(row.vendorId, row.uploadedAtMs);
    }
    return rows.filter((row) => { var _a; return row.uploadedAtMs === ((_a = latest.get(row.vendorId)) !== null && _a !== void 0 ? _a : 0); });
}
function rankDeals(productName, needQty, offers) {
    const matched = offers.filter((offer) => sameProduct(productName, offer.productName));
    const byVendor = new Map();
    for (const offer of matched) {
        const current = byVendor.get(offer.vendorId);
        if (!current || betterOffer(offer, current))
            byVendor.set(offer.vendorId, offer);
    }
    const ranked = [...byVendor.values()].sort((a, b) => compareOffers(a, b));
    const labels = ['P1', 'P2', 'P3', 'P4', 'P5'];
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
function discountPercent(offer) {
    const rate = offer.rate;
    const effective = offer.effectiveRate;
    if (rate != null && rate > 0 && effective != null && effective >= 0 && effective <= rate) {
        return Math.round(((rate - effective) / rate) * 10000) / 100;
    }
    if (offer.discountPercentage != null && offer.discountPercentage > 0)
        return offer.discountPercentage;
    return 0;
}
function betterOffer(next, current) {
    return compareOffers(next, current) < 0;
}
function compareOffers(a, b) {
    const discountA = discountPercent(a);
    const discountB = discountPercent(b);
    if (discountA !== discountB)
        return discountB - discountA;
    return b.stockQty - a.stockQty;
}
//# sourceMappingURL=liveStockRank.js.map
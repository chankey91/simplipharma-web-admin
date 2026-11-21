"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameProduct = sameProduct;
exports.effectivePurchaseRate = effectivePurchaseRate;
exports.loadLiveStockOffers = loadLiveStockOffers;
exports.rankDeals = rankDeals;
const liveStockTypesense_1 = require("./liveStockTypesense");
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
function tokens(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t && !STOP.has(t));
}
/** Same product: shared words agree. Strength still has to agree. OD and a lone letter such as H still separate products. */
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
let offerCache = null;
async function loadLiveStockOffers(db) {
    var _a;
    if (offerCache && Date.now() - offerCache.at < 60000)
        return offerCache.offers;
    const [hits, readySnap] = await Promise.all([
        (0, liveStockTypesense_1.exportLiveStockHits)(),
        db.collection('liveStockUploads').where('status', '==', 'ready').select('rowCount').get(),
    ]);
    const readyUploadIds = new Set(readySnap.docs.map((doc) => doc.id));
    const rows = [];
    for (const hit of hits) {
        if (!readyUploadIds.has(hit.uploadId))
            continue;
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
    const latest = new Map();
    for (const row of rows) {
        const prev = (_a = latest.get(row.vendorId)) !== null && _a !== void 0 ? _a : 0;
        if (row.uploadedAtMs >= prev)
            latest.set(row.vendorId, row.uploadedAtMs);
    }
    const current = rows.filter((row) => { var _a; return row.uploadedAtMs === ((_a = latest.get(row.vendorId)) !== null && _a !== void 0 ? _a : 0); });
    offerCache = { at: Date.now(), offers: current };
    return current;
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
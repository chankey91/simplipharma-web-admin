"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseListSummaryFacts = void 0;
/**
 * Small facts for the purchase-list summary sheet.
 * The browser must not download every purchase invoice or medicine photo.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const functionRegion_1 = require("./functionRegion");
const liveStockRank_1 = require("./liveStockRank");
const panelAuth_1 = require("./panelAuth");
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (value == null || value === '')
        return 0;
    const n = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}
function invoiceMs(value) {
    if (value && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    if (value instanceof Date)
        return value.getTime();
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
}
function packagingOf(unit, description) {
    var _a;
    const direct = String(unit || '').trim();
    if (direct)
        return direct;
    const match = String(description || '').match(/Packaging:\s*(.+)/i);
    return ((_a = match === null || match === void 0 ? void 0 : match[1]) === null || _a === void 0 ? void 0 : _a.trim()) || '—';
}
exports.purchaseListSummaryFacts = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 120, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
    if (!(0, panelAuth_1.isAdminOrOperationsRole)(role) && !(0, panelAuth_1.isPurchaseOfficerRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Not allowed to download this summary');
    }
    const requested = Array.isArray(data === null || data === void 0 ? void 0 : data.medicineIds) ? data.medicineIds : [];
    const medicineIds = [
        ...new Set(requested.map((id) => String(id || '').trim()).filter((id) => id.length > 0)),
    ].slice(0, 400);
    const wanted = new Set(medicineIds);
    const db = admin.firestore();
    const labels = [];
    for (let i = 0; i < medicineIds.length; i += 50) {
        const refs = medicineIds.slice(i, i + 50).map((id) => db.collection('medicines').doc(id));
        const snaps = await db.getAll(...refs, { fieldMask: ['productId', 'unit', 'description'] });
        for (const snap of snaps) {
            if (!snap.exists)
                continue;
            const row = snap.data() || {};
            labels.push({
                id: snap.id,
                productId: String(row.productId || '').trim(),
                packaging: packagingOf(String(row.unit || ''), String(row.description || '')),
            });
        }
    }
    const best = new Map();
    const past = new Map();
    let cursor;
    for (;;) {
        let q = db
            .collection('purchaseInvoices')
            .orderBy(admin.firestore.FieldPath.documentId())
            .select('vendorName', 'invoiceDate', 'invoiceNumber', 'items')
            .limit(150);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty)
            break;
        for (const doc of snap.docs) {
            const row = doc.data();
            const vendorName = String(row.vendorName || '').trim();
            if (!vendorName)
                continue;
            const when = invoiceMs(row.invoiceDate);
            const invoiceNumber = String(row.invoiceNumber || '').trim() || undefined;
            const items = Array.isArray(row.items) ? row.items : [];
            for (const item of items) {
                const medicineId = String((item === null || item === void 0 ? void 0 : item.medicineId) || '').trim();
                if (!medicineId || !wanted.has(medicineId))
                    continue;
                const discount = asNumber(item.discountPercentage);
                const vendors = past.get(medicineId) || new Map();
                const key = vendorName.toLowerCase();
                const existing = vendors.get(key);
                if (!existing || discount > existing.discount || (discount === existing.discount && when > existing.invoiceMs)) {
                    vendors.set(key, { vendorName, discount, invoiceMs: when });
                }
                past.set(medicineId, vendors);
                if (!(discount > 0))
                    continue;
                const current = best.get(medicineId);
                if (!current ||
                    discount > current.discountPercentage ||
                    (discount === current.discountPercentage && when > current.invoiceDateMs)) {
                    best.set(medicineId, {
                        medicineId,
                        vendorName,
                        discountPercentage: discount,
                        invoiceNumber,
                        invoiceDateMs: when,
                    });
                }
            }
        }
        if (snap.size < 150)
            break;
        cursor = snap.docs[snap.docs.length - 1];
    }
    const requestedNames = Array.isArray(data === null || data === void 0 ? void 0 : data.names) ? data.names : [];
    const names = [
        ...new Set(requestedNames.map((name) => String(name || '').trim()).filter((name) => name.length > 0)),
    ].slice(0, 400);
    let live = null;
    try {
        const offers = await (0, liveStockRank_1.loadLiveStockOffers)(db);
        live = names.map((name) => ({
            name,
            vendors: (0, liveStockRank_1.rankDeals)(name, 1, offers).map((deal) => {
                const rate = deal.rate;
                const effective = deal.effectiveRate;
                const known = rate != null && rate > 0 && effective != null && effective >= 0 && effective <= rate;
                const discount = known ? Math.round(((rate - effective) / rate) * 10000) / 100 : 0;
                return {
                    vendorName: deal.vendorName,
                    discount,
                    stockQty: deal.stockQty,
                    discountKnown: known,
                };
            }),
        }));
    }
    catch (error) {
        console.warn('purchaseListSummaryFacts: live stock lookup failed', error);
    }
    const pastRows = [];
    for (const [medicineId, vendors] of past) {
        const ranked = [...vendors.values()]
            .sort((a, b) => b.discount - a.discount || b.invoiceMs - a.invoiceMs)
            .slice(0, 8)
            .map((row) => ({ vendorName: row.vendorName, discount: row.discount }));
        pastRows.push({ medicineId, vendors: ranked });
    }
    return { labels, best: [...best.values()], past: pastRows, live };
});
//# sourceMappingURL=purchaseListSummary.js.map
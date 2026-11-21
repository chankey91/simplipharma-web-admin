"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIVE_STOCK_COLLECTION = void 0;
exports.requireLiveStockClient = requireLiveStockClient;
exports.ensureLiveStockCollection = ensureLiveStockCollection;
exports.liveStockDocument = liveStockDocument;
exports.importLiveStockDocuments = importLiveStockDocuments;
exports.deleteLiveStockWhere = deleteLiveStockWhere;
exports.deleteLiveStockForUpload = deleteLiveStockForUpload;
exports.deleteOlderVendorStock = deleteOlderVendorStock;
exports.deleteLiveStockFile = deleteLiveStockFile;
exports.mapLiveStockHit = mapLiveStockHit;
exports.exportLiveStockHits = exportLiveStockHits;
exports.searchLiveStockHits = searchLiveStockHits;
exports.migrateFirestoreLiveStock = migrateFirestoreLiveStock;
/**
 * Vendor stock rows live only in Typesense. They are replaced whenever a vendor
 * sends a new file. Firestore keeps the small upload record (status, file, vendor).
 */
const admin = require("firebase-admin");
const typesenseMedicines_1 = require("./typesenseMedicines");
exports.LIVE_STOCK_COLLECTION = 'live_stock_offers';
const FIELDS = [
    { name: 'productName', type: 'string', sort: true },
    { name: 'manufacturer', type: 'string', optional: true },
    { name: 'pack', type: 'string', optional: true },
    { name: 'scheme', type: 'string', optional: true },
    { name: 'expiry', type: 'string', optional: true },
    { name: 'uploadId', type: 'string', facet: true },
    { name: 'vendorId', type: 'string', facet: true },
    { name: 'vendorName', type: 'string', optional: true },
    { name: 'stockQty', type: 'int32', sort: true },
    { name: 'rate', type: 'float', optional: true },
    { name: 'mrp', type: 'float', optional: true },
    { name: 'effectiveRate', type: 'float', optional: true },
    { name: 'discountPercentage', type: 'float', optional: true },
    { name: 'schemePaidQty', type: 'int32', optional: true },
    { name: 'schemeFreeQty', type: 'int32', optional: true },
    { name: 'uploadedAtMs', type: 'int64', facet: true },
];
let collectionReady = false;
function filterValue(value) {
    return `\`${value.replace(/[`\\]/g, '')}\``;
}
function requireLiveStockClient() {
    const client = (0, typesenseMedicines_1.getTypesenseClient)();
    if (!client)
        throw new Error('Typesense is not configured');
    return client;
}
async function ensureLiveStockCollection(client) {
    if (collectionReady)
        return;
    try {
        await client.collections(exports.LIVE_STOCK_COLLECTION).retrieve();
    }
    catch (error) {
        const status = error === null || error === void 0 ? void 0 : error.httpStatus;
        if (status !== 404)
            throw error;
        await client.collections().create({
            name: exports.LIVE_STOCK_COLLECTION,
            fields: FIELDS,
        });
    }
    collectionReady = true;
}
function numOrOmit(value) {
    if (value == null || !Number.isFinite(value))
        return undefined;
    return value;
}
function liveStockDocument(id, row, upload) {
    const doc = {
        id,
        uploadId: upload.uploadId,
        vendorId: upload.vendorId,
        vendorName: upload.vendorName,
        productName: row.productName,
        stockQty: Math.round(Number(row.stockQty) || 0),
        uploadedAtMs: Math.round(upload.uploadedAtMs),
    };
    if (row.pack)
        doc.pack = row.pack;
    if (row.manufacturer)
        doc.manufacturer = row.manufacturer;
    if (row.scheme)
        doc.scheme = row.scheme;
    if (row.expiry)
        doc.expiry = row.expiry;
    const rate = numOrOmit(row.rate);
    const mrp = numOrOmit(row.mrp);
    const effectiveRate = numOrOmit(row.effectiveRate);
    const discountPercentage = numOrOmit(row.discountPercentage);
    if (rate != null)
        doc.rate = rate;
    if (mrp != null)
        doc.mrp = mrp;
    if (effectiveRate != null)
        doc.effectiveRate = effectiveRate;
    if (discountPercentage != null)
        doc.discountPercentage = discountPercentage;
    if (row.schemePaidQty != null && Number.isFinite(row.schemePaidQty)) {
        doc.schemePaidQty = Math.round(row.schemePaidQty);
    }
    if (row.schemeFreeQty != null && Number.isFinite(row.schemeFreeQty)) {
        doc.schemeFreeQty = Math.round(row.schemeFreeQty);
    }
    return doc;
}
async function importLiveStockDocuments(docs) {
    if (!docs.length)
        return;
    const client = requireLiveStockClient();
    await ensureLiveStockCollection(client);
    const jsonl = docs.map((doc) => JSON.stringify(doc)).join('\n');
    const raw = await client.collections(exports.LIVE_STOCK_COLLECTION).documents().import(jsonl, { action: 'upsert' });
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const failed = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !/"success"\s*:\s*true/.test(line));
    if (failed.length) {
        throw new Error(`Typesense rejected ${failed.length} stock rows: ${failed[0].slice(0, 240)}`);
    }
}
async function deleteLiveStockWhere(filter) {
    const client = requireLiveStockClient();
    await ensureLiveStockCollection(client);
    const result = await client.collections(exports.LIVE_STOCK_COLLECTION).documents().delete({ filter_by: filter });
    return Number(result.num_deleted || 0);
}
async function deleteLiveStockForUpload(uploadId) {
    if (!uploadId)
        return 0;
    return deleteLiveStockWhere(`uploadId:=${filterValue(uploadId)}`);
}
/** Drop this vendor's older file. The rows just imported share uploadedAtMs. */
async function deleteOlderVendorStock(vendorId, uploadedAtMs) {
    if (!vendorId || !uploadedAtMs)
        return 0;
    return deleteLiveStockWhere(`vendorId:=${filterValue(vendorId)} && uploadedAtMs:<${Math.round(uploadedAtMs)}`);
}
/**
 * Remove one file, and any older file for that vendor, so an earlier list
 * does not become the current stock. A newer file for the vendor stays.
 */
async function deleteLiveStockFile(vendorId, uploadId, uploadedAtMs) {
    if (vendorId && uploadedAtMs > 0) {
        return deleteLiveStockWhere(`uploadId:=${filterValue(uploadId)} || (vendorId:=${filterValue(vendorId)} && uploadedAtMs:<=${Math.round(uploadedAtMs)})`);
    }
    return deleteLiveStockForUpload(uploadId);
}
function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (value == null || value === '')
        return null;
    const n = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}
function mapLiveStockHit(raw) {
    var _a, _b;
    const productName = String(raw.productName || '').trim();
    const vendorId = String(raw.vendorId || '').trim();
    const uploadId = String(raw.uploadId || '').trim();
    if (!productName || !vendorId || !uploadId)
        return null;
    return {
        id: String(raw.id || ''),
        uploadId,
        vendorId,
        vendorName: String(raw.vendorName || ''),
        productName,
        manufacturer: String(raw.manufacturer || ''),
        pack: String(raw.pack || ''),
        stockQty: (_a = asNumber(raw.stockQty)) !== null && _a !== void 0 ? _a : 0,
        rate: asNumber(raw.rate),
        mrp: asNumber(raw.mrp),
        effectiveRate: asNumber(raw.effectiveRate),
        discountPercentage: asNumber(raw.discountPercentage),
        scheme: String(raw.scheme || ''),
        uploadedAtMs: (_b = asNumber(raw.uploadedAtMs)) !== null && _b !== void 0 ? _b : 0,
    };
}
/** Every current stock row. Used by the purchase list, which ranks names in memory. */
async function exportLiveStockHits() {
    const client = (0, typesenseMedicines_1.getTypesenseClient)();
    if (!client)
        return [];
    await ensureLiveStockCollection(client);
    const raw = await client.collections(exports.LIVE_STOCK_COLLECTION).documents().export({});
    const text = typeof raw === 'string' ? raw : '';
    const rows = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const hit = mapLiveStockHit(JSON.parse(line));
            if (hit)
                rows.push(hit);
        }
        catch (_a) {
            // Skip a damaged line rather than failing the whole purchase list.
        }
    }
    return rows;
}
async function searchLiveStockHits(args) {
    const client = (0, typesenseMedicines_1.getTypesenseSearchClient)() || (0, typesenseMedicines_1.getTypesenseClient)();
    if (!client)
        throw new Error('Typesense is not configured');
    await ensureLiveStockCollection(client);
    const q = args.q.trim();
    const browsing = q.length < 2;
    const result = await client.collections(exports.LIVE_STOCK_COLLECTION).documents().search({
        q: browsing ? '*' : q,
        query_by: 'productName,manufacturer,pack',
        filter_by: `uploadId:=${filterValue(args.uploadId)}`,
        per_page: args.perPage,
        page: args.page,
        sort_by: browsing ? 'productName:asc' : '_text_match:desc,productName:asc',
        prefix: true,
        num_typos: browsing ? 0 : 1,
    });
    const hits = (result.hits || [])
        .map((hit) => mapLiveStockHit((hit.document || {})))
        .filter((row) => Boolean(row));
    return { offers: hits, found: Number(result.found || hits.length) };
}
/**
 * Copy existing Firestore stock rows into Typesense, then delete each page
 * after it has been imported. A retry upserts the same ids.
 */
async function migrateFirestoreLiveStock(db) {
    let imported = 0;
    let deleted = 0;
    let cursor;
    const pageSize = 400;
    for (;;) {
        let q = db
            .collection('liveStockOffers')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty)
            break;
        const docs = [];
        for (const item of snap.docs) {
            const data = item.data();
            const productName = String(data.productName || '').trim();
            const vendorId = String(data.vendorId || '').trim();
            const uploadId = String(data.uploadId || '').trim();
            if (!productName || !vendorId || !uploadId)
                continue;
            const asOpt = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
            docs.push(liveStockDocument(item.id, {
                productName,
                pack: data.pack ? String(data.pack) : undefined,
                manufacturer: data.manufacturer ? String(data.manufacturer) : undefined,
                stockQty: Number(data.stockQty) || 0,
                rate: asOpt(data.rate),
                mrp: asOpt(data.mrp),
                scheme: data.scheme ? String(data.scheme) : undefined,
                schemePaidQty: asOpt(data.schemePaidQty),
                schemeFreeQty: asOpt(data.schemeFreeQty),
                discountPercentage: asOpt(data.discountPercentage),
                expiry: data.expiry ? String(data.expiry) : undefined,
                effectiveRate: asOpt(data.effectiveRate),
            }, {
                uploadId,
                vendorId,
                vendorName: String(data.vendorName || ''),
                uploadedAtMs: Number(data.uploadedAtMs) || 0,
            }));
        }
        await importLiveStockDocuments(docs);
        imported += docs.length;
        const batch = db.batch();
        snap.docs.forEach((item) => batch.delete(item.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < pageSize)
            break;
        cursor = snap.docs[snap.docs.length - 1];
    }
    return { imported, deleted };
}
//# sourceMappingURL=liveStockTypesense.js.map
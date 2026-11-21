"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLiveStockOffersToTypesense = exports.rankLiveStockNames = exports.searchLiveStockOffers = exports.deleteLiveStockUpload = exports.onLiveStockUploadBatch = exports.ingestLiveStockUpload = void 0;
/**
 * Load a vendor live-stock file (CSV, Excel, or PDF) into Typesense.
 * Firestore keeps one upload record. The latest successful file replaces that vendor's previous rows.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const liveStockExtract_1 = require("./liveStockExtract");
const liveStockRank_1 = require("./liveStockRank");
const liveStockTypesense_1 = require("./liveStockTypesense");
const UPLOADS = 'liveStockUploads';
async function deleteStaleVendorOffers(vendorId, uploadedAtMs) {
    return (0, liveStockTypesense_1.deleteOlderVendorStock)(vendorId, uploadedAtMs);
}
exports.ingestLiveStockUpload = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 300, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
    if (!(0, panelAuth_1.isAdminOrOperationsRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }
    const uploadId = String((data === null || data === void 0 ? void 0 : data.uploadId) || '').trim();
    if (!uploadId) {
        throw new functions.https.HttpsError('invalid-argument', 'uploadId required');
    }
    const db = admin.firestore();
    const ref = db.collection(UPLOADS).doc(uploadId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Upload not found');
    }
    const upload = snap.data() || {};
    const vendorId = String(upload.vendorId || '').trim();
    const vendorName = String(upload.vendorName || '').trim();
    const storagePath = String(upload.storagePath || '').trim();
    if (!vendorId || !storagePath) {
        throw new functions.https.HttpsError('failed-precondition', 'Upload is missing a vendor or file');
    }
    try {
        await queueLiveStockUpload(ref);
        // Return before the browser's callable deadline. Large files keep saving in later batches.
        const outcome = await waitForLiveStockUpload(ref, Date.now() + 45000);
        if (!outcome.done) {
            return {
                ok: true,
                started: true,
                uploadId,
                rowCount: outcome.rowCount,
                message: outcome.message ||
                    'This file is large, so it is saving in batches. Refresh Live stock in a few minutes.',
            };
        }
        if (!outcome.ok) {
            return { ok: false, uploadId, rowCount: 0, message: outcome.message || 'No stock rows found' };
        }
        return {
            ok: true,
            uploadId,
            rowCount: outcome.rowCount,
            replacedCount: outcome.replacedCount,
            engine: outcome.engine,
            message: outcome.message || `Loaded ${outcome.rowCount} stock rows for ${vendorName || 'vendor'}.`,
        };
    }
    catch (error) {
        const message = (error === null || error === void 0 ? void 0 : error.message) || String(error);
        await ref.set({
            status: 'failed',
            error: message.slice(0, 500),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        throw new functions.https.HttpsError('internal', message);
    }
});
const WRITE_BUDGET_MS = 90000;
const EXTRACT_BUDGET_MS = 100000;
const WRITE_CHUNK = 400;
function parsedJsonPath(uploadId) {
    return `live_stock_batches/${uploadId}.json`;
}
function shouldAdvanceLiveStock(before, after) {
    if (!after)
        return false;
    if (after.status === 'queued' &&
        ((before === null || before === void 0 ? void 0 : before.status) !== 'queued' || Number(after.batchNonce || 0) !== Number((before === null || before === void 0 ? void 0 : before.batchNonce) || 0))) {
        return true;
    }
    if (after.status === 'writing' && Number(after.batchNonce || 0) !== Number((before === null || before === void 0 ? void 0 : before.batchNonce) || 0))
        return true;
    return false;
}
async function queueLiveStockUpload(ref) {
    var _a, _b;
    const snap = await ref.get();
    const data = snap.data() || {};
    const status = String(data.status || '');
    const lease = ((_b = (_a = data.leaseUntil) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || 0;
    const running = status === 'queued' || status === 'writing' || status === 'extracting';
    if (running && lease > Date.now())
        return;
    if (running && (data.parsedPath || Number(data.writeCursor || 0) > 0 || Number(data.geminiOffset || 0) > 0)) {
        await ref.set({
            status: 'writing',
            batchNonce: admin.firestore.FieldValue.increment(1),
            leaseUntil: null,
            error: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
    }
    await ref.set({
        status: 'queued',
        batchNonce: admin.firestore.FieldValue.increment(1),
        writeCursor: 0,
        savedCount: 0,
        geminiOffset: 0,
        extractComplete: false,
        parsedPath: admin.firestore.FieldValue.delete(),
        leaseUntil: null,
        error: null,
        message: 'Queued',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function waitForLiveStockUpload(ref, deadlineMs) {
    while (Date.now() < deadlineMs) {
        const snap = await ref.get();
        const data = snap.data() || {};
        const status = String(data.status || '');
        if (status === 'ready') {
            return {
                done: true,
                ok: true,
                rowCount: Number(data.rowCount || 0),
                replacedCount: Number(data.replacedCount || 0),
                engine: String(data.engine || ''),
                message: String(data.message || ''),
            };
        }
        if (status === 'failed') {
            return {
                done: true,
                ok: false,
                rowCount: 0,
                replacedCount: 0,
                engine: String(data.engine || ''),
                message: String(data.error || data.message || 'No stock rows found'),
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const snap = await ref.get();
    const data = snap.data() || {};
    return {
        done: false,
        ok: true,
        rowCount: Number(data.savedCount || data.rowCount || 0),
        replacedCount: 0,
        engine: String(data.engine || ''),
        message: String(data.message || ''),
    };
}
async function claimLiveStockBatch(ref) {
    return admin.firestore().runTransaction(async (tx) => {
        var _a, _b;
        const snap = await tx.get(ref);
        if (!snap.exists)
            return null;
        const data = snap.data() || {};
        const status = String(data.status || '');
        if (status !== 'queued' && status !== 'writing')
            return null;
        const lease = ((_b = (_a = data.leaseUntil) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || 0;
        if (lease > Date.now() + 5000)
            return null;
        tx.set(ref, {
            status: 'writing',
            leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 9 * 60 * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return data;
    });
}
async function loadParsedRows(path) {
    const [buf] = await admin.storage().bucket().file(path).download();
    const parsed = JSON.parse(buf.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
}
async function saveParsedRows(path, rows) {
    await admin.storage().bucket().file(path).save(JSON.stringify(rows), {
        contentType: 'application/json',
        resumable: false,
    });
}
async function deleteParsedRows(path) {
    if (!path)
        return;
    try {
        await admin.storage().bucket().file(path).delete({ ignoreNotFound: true });
    }
    catch (error) {
        console.warn('live stock parsed file delete failed', path, error);
    }
}
async function deleteOffersForUpload(uploadId) {
    await (0, liveStockTypesense_1.deleteLiveStockForUpload)(uploadId);
}
async function writeOfferSlice(rows, from, upload) {
    const slice = rows.slice(from, from + WRITE_CHUNK);
    if (!slice.length)
        return from;
    await (0, liveStockTypesense_1.importLiveStockDocuments)(slice.map((row, offset) => (0, liveStockTypesense_1.liveStockDocument)(`${upload.uploadId}_${from + offset}`, row, upload)));
    return from + slice.length;
}
async function yieldLiveStockBatch(ref, patch) {
    await ref.set(Object.assign(Object.assign({}, patch), { status: 'writing', batchNonce: admin.firestore.FieldValue.increment(1), leaseUntil: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }), { merge: true });
}
exports.onLiveStockUploadBatch = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 540, memory: '1GB' })
    .firestore.document(`${UPLOADS}/{uploadId}`)
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const storageJustSet = !String((before === null || before === void 0 ? void 0 : before.storagePath) || '').trim() && String((after === null || after === void 0 ? void 0 : after.storagePath) || '').trim();
    if ((after === null || after === void 0 ? void 0 : after.status) === 'uploaded' && storageJustSet) {
        await change.after.ref.set({
            status: 'queued',
            batchNonce: admin.firestore.FieldValue.increment(1),
            writeCursor: 0,
            savedCount: 0,
            extractComplete: false,
            leaseUntil: null,
            error: null,
            message: 'Queued',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
    }
    if (!shouldAdvanceLiveStock(before, after))
        return null;
    const uploadId = String(context.params.uploadId || '');
    if (!uploadId)
        return null;
    try {
        await runLiveStockBatch(uploadId);
    }
    catch (error) {
        console.error('onLiveStockUploadBatch failed', uploadId, error);
    }
    return null;
});
async function runLiveStockBatch(uploadId) {
    const db = admin.firestore();
    const ref = db.collection(UPLOADS).doc(uploadId);
    const claimed = await claimLiveStockBatch(ref);
    if (!claimed)
        return;
    const vendorId = String(claimed.vendorId || '').trim();
    const vendorName = String(claimed.vendorName || '').trim();
    const storagePath = String(claimed.storagePath || '').trim();
    const contentType = String(claimed.contentType || 'application/octet-stream');
    const fileName = String(claimed.fileName || 'stock');
    if (!vendorId || !storagePath) {
        await ref.set({
            status: 'failed',
            error: 'Upload is missing a vendor or file',
            leaseUntil: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
    }
    try {
        let parsedPath = String(claimed.parsedPath || '');
        let extractComplete = claimed.extractComplete === true;
        let rows = null;
        let engine = String(claimed.engine || '');
        let model = String(claimed.model || '');
        let message = String(claimed.message || '');
        let uploadedAtMs = Number(claimed.uploadedAtMs || 0);
        let writeCursor = Number(claimed.writeCursor || 0);
        if (!extractComplete) {
            if (!parsedPath && writeCursor === 0)
                await deleteOffersForUpload(uploadId);
            const [fileBuf] = await admin.storage().bucket().file(storagePath).download();
            const previous = parsedPath ? await loadParsedRows(parsedPath) : [];
            const extracted = await (0, liveStockExtract_1.extractStockFromFile)(fileBuf, contentType, fileName, {
                geminiOnly: Number(claimed.geminiOffset || 0) > 0,
                geminiOffset: Number(claimed.geminiOffset || 0),
                geminiChunkLimit: 4,
                geminiDeadlineMs: Date.now() + EXTRACT_BUDGET_MS,
            });
            const merged = (0, liveStockExtract_1.mergeStockRows)(previous, extracted.rows);
            parsedPath = parsedJsonPath(uploadId);
            await saveParsedRows(parsedPath, merged);
            engine = extracted.engine || engine;
            model = extracted.model || model;
            message = extracted.message || message;
            if (extracted.geminiContinue) {
                await yieldLiveStockBatch(ref, {
                    parsedPath,
                    extractComplete: false,
                    geminiOffset: extracted.geminiContinue.offset,
                    rowCount: merged.length,
                    savedCount: 0,
                    engine,
                    model: model || null,
                    message: message || `Read ${merged.length} products so far.`,
                });
                return;
            }
            if (!merged.length) {
                await deleteParsedRows(parsedPath);
                await ref.set({
                    status: 'failed',
                    error: extracted.message || 'No stock rows found',
                    engine: extracted.engine,
                    model: model || null,
                    leaseUntil: null,
                    parsedPath: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                return;
            }
            extractComplete = true;
            rows = merged;
            if (!uploadedAtMs)
                uploadedAtMs = Date.now();
            writeCursor = 0;
            await ref.set({
                parsedPath,
                extractComplete: true,
                geminiOffset: admin.firestore.FieldValue.delete(),
                rowCount: rows.length,
                writeCursor: 0,
                uploadedAtMs,
                engine,
                model: model || null,
                message: message || `Saving ${rows.length} products.`,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        if (!rows)
            rows = parsedPath ? await loadParsedRows(parsedPath) : [];
        if (!uploadedAtMs)
            uploadedAtMs = Date.now();
        const deadline = Date.now() + WRITE_BUDGET_MS;
        let cursor = writeCursor;
        while (cursor < rows.length && Date.now() < deadline) {
            cursor = await writeOfferSlice(rows, cursor, { uploadId, vendorId, vendorName, uploadedAtMs });
        }
        if (cursor < rows.length) {
            await yieldLiveStockBatch(ref, {
                parsedPath,
                extractComplete: true,
                writeCursor: cursor,
                savedCount: cursor,
                rowCount: rows.length,
                uploadedAtMs,
                engine,
                model: model || null,
                message: `Saving ${cursor} of ${rows.length} products.`,
            });
            return;
        }
        const replaced = await deleteStaleVendorOffers(vendorId, uploadedAtMs);
        await deleteParsedRows(parsedPath);
        await ref.set({
            status: 'ready',
            rowCount: rows.length,
            savedCount: rows.length,
            replacedCount: replaced,
            engine: engine || null,
            model: model || null,
            message: message || `Loaded ${rows.length} stock rows for ${vendorName || 'vendor'}.`,
            error: null,
            uploadedAtMs,
            leaseUntil: null,
            parsedPath: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (error) {
        const message = String((error === null || error === void 0 ? void 0 : error.message) || error || 'Could not read this stock file').slice(0, 500);
        console.error('runLiveStockBatch failed', uploadId, message);
        await ref.set({
            status: 'failed',
            error: message,
            leaseUntil: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}
/** Remove one uploaded stock file and the products that came from it. */
exports.deleteLiveStockUpload = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
    if (!(0, panelAuth_1.isAdminOrOperationsRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }
    const uploadId = String((data === null || data === void 0 ? void 0 : data.uploadId) || '').trim();
    if (!uploadId) {
        throw new functions.https.HttpsError('invalid-argument', 'uploadId required');
    }
    const db = admin.firestore();
    const ref = db.collection(UPLOADS).doc(uploadId);
    try {
        const snap = await ref.get();
        if (!snap.exists) {
            throw new functions.https.HttpsError('not-found', 'Stock list not found');
        }
        const upload = snap.data() || {};
        const vendorId = String(upload.vendorId || '').trim();
        const uploadedAtMs = Number(upload.uploadedAtMs || 0);
        const storagePath = String(upload.storagePath || '').trim();
        const removedOffers = await (0, liveStockTypesense_1.deleteLiveStockFile)(vendorId, uploadId, uploadedAtMs);
        if (storagePath) {
            try {
                await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
            }
            catch (error) {
                console.warn('deleteLiveStockUpload: storage delete failed', storagePath, error);
            }
        }
        await ref.delete();
        return { ok: true, uploadId, removedOffers };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError)
            throw error;
        const message = String((error === null || error === void 0 ? void 0 : error.message) || error || 'Could not delete this stock list').slice(0, 300);
        console.error('deleteLiveStockUpload failed', { uploadId, message });
        throw new functions.https.HttpsError('internal', message);
    }
});
async function requireStockReader(uid) {
    if (!uid)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const role = await (0, panelAuth_1.getUserRole)(uid);
    if (!(0, panelAuth_1.isAdminOrOperationsRole)(role) && !(0, panelAuth_1.isPurchaseOfficerRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Not allowed to read live stock');
    }
}
/** Products from one uploaded file. The screen searches here instead of downloading the file. */
exports.searchLiveStockOffers = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    var _a;
    await requireStockReader((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const uploadId = String((data === null || data === void 0 ? void 0 : data.uploadId) || '').trim();
    if (!uploadId)
        throw new functions.https.HttpsError('invalid-argument', 'uploadId required');
    const q = String((data === null || data === void 0 ? void 0 : data.q) || '').slice(0, 80);
    const page = Math.min(20, Math.max(1, Number(data === null || data === void 0 ? void 0 : data.page) || 1));
    const perPage = Math.min(250, Math.max(1, Number(data === null || data === void 0 ? void 0 : data.perPage) || 250));
    try {
        return await (0, liveStockTypesense_1.searchLiveStockHits)({ uploadId, q, page, perPage });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not search stock';
        throw new functions.https.HttpsError('failed-precondition', message.slice(0, 300));
    }
});
function dealDiscount(rate, effectiveRate) {
    if (rate != null && rate > 0 && effectiveRate != null && effectiveRate >= 0 && effectiveRate <= rate) {
        return { discount: Math.round(((rate - effectiveRate) / rate) * 10000) / 100, known: true };
    }
    return { discount: 0, known: false };
}
/** Rank live-stock vendors for order-summary names without sending every stock row to the browser. */
exports.rankLiveStockNames = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 120, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a;
    await requireStockReader((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const names = Array.isArray(data === null || data === void 0 ? void 0 : data.names)
        ? data.names.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 80)
        : [];
    const offers = await (0, liveStockRank_1.loadLiveStockOffers)(admin.firestore());
    return {
        matches: names.map((name) => ({
            name,
            vendors: (0, liveStockRank_1.rankDeals)(name, 1, offers).map((deal) => {
                const priced = dealDiscount(deal.rate, deal.effectiveRate);
                return {
                    vendorName: deal.vendorName,
                    discount: priced.discount,
                    stockQty: deal.stockQty,
                    discountKnown: priced.known,
                };
            }),
        })),
    };
});
/** One-time copy of Firestore stock rows into Typesense, then remove them from Firestore. */
exports.migrateLiveStockOffersToTypesense = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (_data, context) => {
    var _a;
    await requireStockReader((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
    if (role !== 'admin' && role !== 'Admin') {
        throw new functions.https.HttpsError('permission-denied', 'Admin required');
    }
    return (0, liveStockTypesense_1.migrateFirestoreLiveStock)(admin.firestore());
});
//# sourceMappingURL=liveStockIngest.js.map
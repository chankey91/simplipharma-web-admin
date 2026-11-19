"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteLiveStockUpload = exports.ingestLiveStockUpload = void 0;
/**
 * Load a vendor live-stock file (CSV, Excel, or PDF) into liveStockOffers.
 * The latest successful file for a vendor replaces that vendor's previous rows.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const liveStockExtract_1 = require("./liveStockExtract");
const UPLOADS = 'liveStockUploads';
const OFFERS = 'liveStockOffers';
function stripUndefined(value) {
    if (value === undefined || value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map((item) => stripUndefined(item));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined)
            continue;
        out[key] = stripUndefined(item);
    }
    return out;
}
async function deleteStaleVendorOffers(db, vendorId, uploadedAtMs) {
    const snap = await db.collection(OFFERS).where('vendorId', '==', vendorId).get();
    const stale = snap.docs.filter((doc) => Number(doc.data().uploadedAtMs || 0) < uploadedAtMs);
    let removed = 0;
    for (let i = 0; i < stale.length; i += 400) {
        const batch = db.batch();
        for (const doc of stale.slice(i, i + 400))
            batch.delete(doc.ref);
        await batch.commit();
        removed += Math.min(400, stale.length - i);
    }
    return removed;
}
exports.ingestLiveStockUpload = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 300, memory: '1GB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
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
    const contentType = String(upload.contentType || 'application/octet-stream');
    const fileName = String(upload.fileName || 'stock');
    if (!vendorId || !storagePath) {
        throw new functions.https.HttpsError('failed-precondition', 'Upload is missing a vendor or file');
    }
    await ref.set({ status: 'extracting', updatedAt: admin.firestore.FieldValue.serverTimestamp(), error: null }, { merge: true });
    try {
        const [fileBuf] = await admin.storage().bucket().file(storagePath).download();
        const extracted = await (0, liveStockExtract_1.extractStockFromFile)(fileBuf, contentType, fileName);
        if (extracted.rows.length === 0) {
            await ref.set({
                status: 'failed',
                error: extracted.message || 'No stock rows found',
                engine: extracted.engine,
                model: extracted.model || null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return { ok: false, uploadId, rowCount: 0, message: extracted.message || 'No stock rows found' };
        }
        const uploadedAtMs = Date.now();
        const chunkSize = 400;
        for (let i = 0; i < extracted.rows.length; i += chunkSize) {
            const batch = db.batch();
            for (const row of extracted.rows.slice(i, i + chunkSize)) {
                const docRef = db.collection(OFFERS).doc();
                batch.set(docRef, stripUndefined({
                    uploadId,
                    vendorId,
                    vendorName,
                    productName: row.productName,
                    productNameKey: row.productName.toLowerCase(),
                    pack: row.pack || null,
                    manufacturer: row.manufacturer || null,
                    stockQty: row.stockQty,
                    rate: (_b = row.rate) !== null && _b !== void 0 ? _b : null,
                    mrp: (_c = row.mrp) !== null && _c !== void 0 ? _c : null,
                    scheme: row.scheme || null,
                    schemePaidQty: (_d = row.schemePaidQty) !== null && _d !== void 0 ? _d : null,
                    schemeFreeQty: (_e = row.schemeFreeQty) !== null && _e !== void 0 ? _e : null,
                    discountPercentage: (_f = row.discountPercentage) !== null && _f !== void 0 ? _f : null,
                    expiry: row.expiry || null,
                    effectiveRate: (_g = row.effectiveRate) !== null && _g !== void 0 ? _g : null,
                    uploadedAtMs,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                }));
            }
            await batch.commit();
        }
        const replaced = await deleteStaleVendorOffers(db, vendorId, uploadedAtMs);
        await ref.set({
            status: 'ready',
            rowCount: extracted.rows.length,
            replacedCount: replaced,
            engine: extracted.engine,
            model: extracted.model || null,
            message: extracted.message || null,
            error: null,
            uploadedAtMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return {
            ok: true,
            uploadId,
            rowCount: extracted.rows.length,
            replacedCount: replaced,
            engine: extracted.engine,
            message: extracted.message || `Loaded ${extracted.rows.length} stock rows for ${vendorName || 'vendor'}.`,
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
async function deleteOfferDocs(docs) {
    const db = admin.firestore();
    let removed = 0;
    for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of docs.slice(i, i + 400))
            batch.delete(doc.ref);
        await batch.commit();
        removed += Math.min(400, docs.length - i);
    }
    return removed;
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
        const offerSnap = vendorId
            ? await db.collection(OFFERS).where('vendorId', '==', vendorId).get()
            : await db.collection(OFFERS).where('uploadId', '==', uploadId).get();
        const doomed = offerSnap.docs.filter((doc) => {
            const row = doc.data();
            if (String(row.uploadId || '') === uploadId)
                return true;
            // Drop this file and anything older so an earlier list does not become current again.
            // A newer file for the same vendor stays.
            return uploadedAtMs > 0 && Number(row.uploadedAtMs || 0) <= uploadedAtMs;
        });
        const removedOffers = await deleteOfferDocs(doomed);
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
//# sourceMappingURL=liveStockIngest.js.map
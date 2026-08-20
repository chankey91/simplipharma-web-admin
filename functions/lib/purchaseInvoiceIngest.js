"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processPurchaseInvoiceDraft = void 0;
/**
 * Phase 1 — purchase invoice ingest: process uploaded PDF/image drafts.
 * Client creates draft + uploads file, then calls processPurchaseInvoiceDraft.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const panelAuth_1 = require("./panelAuth");
const purchaseInvoiceExtract_1 = require("./purchaseInvoiceExtract");
const typesenseMedicines_1 = require("./typesenseMedicines");
const functionRegion_1 = require("./functionRegion");
const DRAFTS = 'purchase_invoice_drafts';
/** Firestore rejects `undefined` field values — drop them recursively. */
function stripUndefinedDeep(value) {
    if (value === undefined)
        return value;
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefinedDeep(item));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined)
            continue;
        out[k] = stripUndefinedDeep(v);
    }
    return out;
}
async function assertCanIngest(uid) {
    const role = await (0, panelAuth_1.getUserRole)(uid);
    if ((0, panelAuth_1.isPurchaseOfficerRole)(role))
        return;
    await (0, panelAuth_1.assertCanWriteModule)(uid, 'purchases');
}
async function collectPendingMedicineIds(db) {
    var _a;
    const snap = await db.collection('orders').where('status', '==', 'Pending').get();
    const ids = new Set();
    for (const doc of snap.docs) {
        const medicines = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.medicines;
        if (!Array.isArray(medicines))
            continue;
        for (const m of medicines) {
            const id = String((m === null || m === void 0 ? void 0 : m.medicineId) || '').trim();
            if (id)
                ids.add(id);
        }
    }
    return ids;
}
function scoreName(a, b) {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    if (!x || !y)
        return 0;
    if (x === y)
        return 1;
    if (x.includes(y) || y.includes(x))
        return 0.85;
    const xt = new Set(x.split(/\s+/).filter((t) => t.length >= 2));
    const yt = y.split(/\s+/).filter((t) => t.length >= 2);
    if (!yt.length)
        return 0;
    const hit = yt.filter((t) => xt.has(t) || [...xt].some((u) => u.includes(t) || t.includes(u))).length;
    return hit / yt.length;
}
async function searchMedicineCandidates(query, pendingIds) {
    const client = (0, typesenseMedicines_1.getTypesenseClient)();
    if (!client || query.trim().length < 2)
        return [];
    const res = await client
        .collections(typesenseMedicines_1.TYPESENSE_COLLECTION)
        .documents()
        .search({
        q: query.trim().toLowerCase(),
        query_by: 'search_blob,name,code,productId,manufacturer',
        per_page: 12,
        prefix: true,
        num_typos: 2,
    });
    const hits = (res.hits || []).map((h) => (h.document || {}));
    const out = [];
    for (const doc of hits) {
        const medicineId = String(doc.id || doc.docId || '').trim();
        if (!medicineId)
            continue;
        const medicineName = String(doc.name || '');
        const productId = doc.productId != null && String(doc.productId).trim()
            ? String(doc.productId).trim()
            : undefined;
        const base = scoreName(query, medicineName);
        const pending = pendingIds.has(medicineId);
        out.push({
            medicineId,
            medicineName,
            productId,
            score: Math.min(1, base + (pending ? 0.3 : 0)),
            reason: pending ? 'pending_order' : 'inventory',
        });
    }
    out.sort((a, b) => b.score - a.score);
    // Prefer pending when scores are close
    out.sort((a, b) => {
        if (a.reason === b.reason)
            return b.score - a.score;
        if (a.reason === 'pending_order')
            return -1;
        if (b.reason === 'pending_order')
            return 1;
        return b.score - a.score;
    });
    return out;
}
async function matchVendor(db, gstin, nameHint) {
    var _a, _b;
    if (gstin) {
        const g = (0, purchaseInvoiceExtract_1.normalizeGstin)(gstin);
        const snap = await db.collection('vendors').where('gstNumber', '==', g).limit(2).get();
        if (snap.size === 1) {
            const d = snap.docs[0];
            return { vendorId: d.id, vendorName: String(((_a = d.data()) === null || _a === void 0 ? void 0 : _a.vendorName) || '') };
        }
    }
    if (nameHint && nameHint.trim().length >= 4) {
        const snap = await db.collection('vendors').limit(200).get();
        const hay = nameHint.toLowerCase();
        let best = null;
        for (const d of snap.docs) {
            const name = String(((_b = d.data()) === null || _b === void 0 ? void 0 : _b.vendorName) || '');
            const score = scoreName(hay, name);
            if (score >= 0.7 && (!best || score > best.score)) {
                best = { id: d.id, name, score };
            }
        }
        if (best)
            return { vendorId: best.id, vendorName: best.name };
    }
    return {};
}
exports.processPurchaseInvoiceDraft = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 300, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    await assertCanIngest(context.auth.uid);
    const draftId = String((data === null || data === void 0 ? void 0 : data.draftId) || '').trim();
    if (!draftId) {
        throw new functions.https.HttpsError('invalid-argument', 'draftId required');
    }
    const db = admin.firestore();
    const ref = db.collection(DRAFTS).doc(draftId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Draft not found');
    }
    const draft = snap.data() || {};
    if (draft.createdBy && draft.createdBy !== context.auth.uid) {
        // Admin/ops may process others' drafts
        const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
        if ((0, panelAuth_1.isPurchaseOfficerRole)(role) && draft.createdBy !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Not your draft');
        }
    }
    const storagePath = String(((_b = draft.sourceFile) === null || _b === void 0 ? void 0 : _b.storagePath) || '').trim();
    const contentType = String(((_c = draft.sourceFile) === null || _c === void 0 ? void 0 : _c.contentType) || 'application/octet-stream');
    if (!storagePath) {
        throw new functions.https.HttpsError('failed-precondition', 'Draft missing sourceFile.storagePath');
    }
    await ref.set({
        status: 'extracting',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errors: [],
    }, { merge: true });
    try {
        const bucket = admin.storage().bucket();
        const [fileBuf] = await bucket.file(storagePath).download();
        const extracted = await (0, purchaseInvoiceExtract_1.extractInvoiceFromFile)(fileBuf, contentType);
        await ref.set(stripUndefinedDeep({
            status: 'resolving',
            extractionMeta: {
                engine: extracted.engine,
                message: extracted.message || null,
                model: extracted.model || null,
            },
            vendorHint: extracted.vendorHint || null,
            invoiceNumber: extracted.invoiceNumber || null,
            invoiceDate: extracted.invoiceDate || null,
            rawTextPreview: (extracted.rawText || '').slice(0, 8000),
            extractedLines: extracted.lines,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }), { merge: true });
        const pendingIds = await collectPendingMedicineIds(db);
        const vendor = await matchVendor(db, (_d = extracted.vendorHint) === null || _d === void 0 ? void 0 : _d.gstin, (_e = extracted.vendorHint) === null || _e === void 0 ? void 0 : _e.name);
        const resolvedLines = [];
        for (const line of extracted.lines) {
            const candidates = await searchMedicineCandidates(line.productName, pendingIds);
            const top = candidates[0];
            const second = candidates[1];
            let matchStatus = 'unmatched';
            if (top && top.score >= 0.92 && (!second || top.score - second.score >= 0.08)) {
                matchStatus = 'matched';
            }
            else if (top && top.score >= 0.55) {
                matchStatus = candidates.length > 1 && second && second.score >= 0.55 ? 'ambiguous' : 'matched';
            }
            const resolved = Object.assign(Object.assign({}, line), { matchStatus, matchReason: (top === null || top === void 0 ? void 0 : top.reason) || 'none', candidates: candidates.slice(0, 5) });
            if (matchStatus !== 'unmatched' && top) {
                resolved.medicineId = top.medicineId;
                resolved.medicineName = top.medicineName;
                if (top.productId)
                    resolved.productId = top.productId;
            }
            resolvedLines.push(resolved);
        }
        const needsReview = extracted.engine === 'none' ||
            resolvedLines.length === 0 ||
            resolvedLines.some((l) => l.matchStatus !== 'matched') ||
            !vendor.vendorId;
        await ref.set(stripUndefinedDeep({
            status: needsReview ? 'needs_review' : 'ready',
            vendorId: vendor.vendorId || null,
            vendorName: vendor.vendorName || null,
            resolvedLines,
            errors: extracted.message ? [extracted.message] : [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }), { merge: true });
        return {
            ok: true,
            draftId,
            status: needsReview ? 'needs_review' : 'ready',
            lineCount: resolvedLines.length,
            engine: extracted.engine,
        };
    }
    catch (e) {
        const message = (e === null || e === void 0 ? void 0 : e.message) || String(e);
        await ref.set({
            status: 'failed',
            errors: [message],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        throw new functions.https.HttpsError('internal', message);
    }
});
//# sourceMappingURL=purchaseInvoiceIngest.js.map
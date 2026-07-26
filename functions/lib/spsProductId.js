"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPS_PRODUCT_ID_PREFIX = void 0;
exports.formatSpsProductId = formatSpsProductId;
exports.allocateSpsProductIds = allocateSpsProductIds;
exports.allocateSpsProductId = allocateSpsProductId;
/**
 * Allocate sequential business product IDs: SPS000001, SPS000002, …
 * Counter doc: counters/spsProductId { next: number } — next value to assign.
 * Admin SDK variant for Cloud Functions (bulk import, etc.).
 */
const admin = require("firebase-admin");
exports.SPS_PRODUCT_ID_PREFIX = 'SPS';
function formatSpsProductId(seq) {
    if (!Number.isFinite(seq) || seq < 1) {
        throw new Error(`Invalid SPS sequence: ${seq}`);
    }
    return `${exports.SPS_PRODUCT_ID_PREFIX}${String(Math.floor(seq)).padStart(6, '0')}`;
}
/**
 * Atomically reserves `count` sequential SPS ids and returns them in order.
 */
async function allocateSpsProductIds(db, count) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) {
        throw new Error(`allocateSpsProductIds: count must be >= 1 (got ${count})`);
    }
    if (n > 5000) {
        throw new Error(`allocateSpsProductIds: max 5000 per call (got ${n})`);
    }
    const counterRef = db.collection('counters').doc('spsProductId');
    const start = await db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(counterRef);
        const current = snap.exists ? Number((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.next) : 1;
        const nextStart = Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1;
        tx.set(counterRef, {
            next: nextStart + n,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return nextStart;
    });
    return Array.from({ length: n }, (_, i) => formatSpsProductId(start + i));
}
async function allocateSpsProductId(db) {
    const [id] = await allocateSpsProductIds(db, 1);
    return id;
}
//# sourceMappingURL=spsProductId.js.map
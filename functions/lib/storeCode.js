"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStoreCodeNumber = parseStoreCodeNumber;
exports.formatStoreCode = formatStoreCode;
exports.generateNextStoreCode = generateNextStoreCode;
const admin = require("firebase-admin");
const STORE_CODE_PREFIX = 'MS';
const STORE_CODE_RE = /^MS(\d+)$/i;
function parseStoreCodeNumber(code) {
    const raw = String(code || '').trim();
    const m = raw.match(STORE_CODE_RE);
    if (!m)
        return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
}
function formatStoreCode(n) {
    const digits = Math.max(3, String(n).length);
    return `${STORE_CODE_PREFIX}${String(n).padStart(digits, '0')}`;
}
/** Next MS### for retailers (Admin SDK). */
async function generateNextStoreCode() {
    const snap = await admin.firestore().collection('users').where('role', '==', 'retailer').get();
    let max = 0;
    for (const doc of snap.docs) {
        const n = parseStoreCodeNumber(doc.data().storeCode);
        if (n != null && n > max)
            max = n;
    }
    return formatStoreCode(max + 1);
}
//# sourceMappingURL=storeCode.js.map
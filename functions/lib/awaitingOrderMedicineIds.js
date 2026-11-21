"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.awaitingFulfillmentMedicineIds = void 0;
/**
 * Product names for the purchase-invoice picker.
 * Pending and Picked up orders stay on the server. The browser only receives
 * the fields needed to label a suggestion (no order photos, no stock batches).
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const STATUSES = ['Pending', 'Picked up'];
function clip(value, max) {
    const text = String(value !== null && value !== void 0 ? value : '').trim();
    return text.length > max ? text.slice(0, max) : text;
}
function optional(value, max) {
    const text = clip(value, max);
    return text || undefined;
}
function absorbMedicineIds(snap, ids) {
    for (const docSnap of snap.docs) {
        const medicines = docSnap.get('medicines');
        if (!Array.isArray(medicines))
            continue;
        for (const line of medicines) {
            const id = String((line === null || line === void 0 ? void 0 : line.medicineId) || '').trim();
            if (id)
                ids.add(id);
        }
    }
}
exports.awaitingFulfillmentMedicineIds = functionRegion_1.ff
    .runWith({ minInstances: 0, timeoutSeconds: 60, memory: '1GB' })
    .https.onCall(async (_data, context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await (0, panelAuth_1.getUserRole)(context.auth.uid);
    if (!(0, panelAuth_1.isPanelRole)(role) && !(0, panelAuth_1.isPurchaseOfficerRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Not allowed to look up order products');
    }
    const db = admin.firestore();
    const ids = new Set();
    await Promise.all(STATUSES.map(async (status) => {
        const snap = await db.collection('orders').where('status', '==', status).select('medicines').get();
        absorbMedicineIds(snap, ids);
    }));
    const medicineIds = [...ids];
    const medicines = [];
    for (let i = 0; i < medicineIds.length; i += 100) {
        const refs = medicineIds.slice(i, i + 100).map((id) => db.collection('medicines').doc(id));
        const snaps = await db.getAll(...refs, {
            fieldMask: ['name', 'productId', 'code', 'manufacturer', 'company', 'unit', 'description', 'category'],
        });
        for (const snap of snaps) {
            if (!snap.exists)
                continue;
            const row = snap.data() || {};
            medicines.push({
                id: snap.id,
                name: clip(row.name, 180),
                category: clip(row.category, 80),
                manufacturer: clip(row.manufacturer, 120),
                productId: optional(row.productId, 40),
                code: optional(row.code, 40),
                company: optional(row.company, 120),
                unit: optional(row.unit, 80),
                description: optional(row.description, 240),
            });
        }
    }
    return { medicines };
});
//# sourceMappingURL=awaitingOrderMedicineIds.js.map
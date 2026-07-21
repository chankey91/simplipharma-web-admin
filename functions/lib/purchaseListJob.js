"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishPurchaseListNet = exports.scheduledPurchaseListAfternoon = exports.scheduledPurchaseListNoon = void 0;
exports.istDateString = istDateString;
exports.istDayRangeMs = istDayRangeMs;
exports.publishNetPurchaseListForDay = publishNetPurchaseListForDay;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
function productAggregateKey(medicine) {
    var _a, _b;
    if ((_a = medicine.medicineId) === null || _a === void 0 ? void 0 : _a.trim())
        return `med:${medicine.medicineId.trim()}`;
    if ((_b = medicine.productDemandId) === null || _b === void 0 ? void 0 : _b.trim())
        return `demand:${medicine.productDemandId.trim()}`;
    return `name:${String(medicine.name || '')
        .trim()
        .toLowerCase()}`;
}
function coverageKey(item) {
    var _a;
    if ((_a = item.medicineId) === null || _a === void 0 ? void 0 : _a.trim())
        return `med:${item.medicineId.trim()}`;
    return `name:${String(item.medicineName || '')
        .trim()
        .toLowerCase()}`;
}
/** YYYY-MM-DD in Asia/Kolkata */
function istDateString(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
/** Inclusive IST calendar day → [startMs, endMsExclusive) */
function istDayRangeMs(dateStr) {
    const startMs = new Date(`${dateStr}T00:00:00+05:30`).getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000;
    return { startMs, endMs };
}
function orderReference(orderId) {
    return orderId.length > 8 ? orderId.slice(-8).toUpperCase() : orderId.toUpperCase();
}
async function loadPendingOrdersInRange(db, startMs, endMs) {
    const start = admin.firestore.Timestamp.fromMillis(startMs);
    const end = admin.firestore.Timestamp.fromMillis(endMs);
    try {
        const snap = await db
            .collection('orders')
            .where('status', '==', 'Pending')
            .where('orderDate', '>=', start)
            .where('orderDate', '<', end)
            .get();
        return snap.docs;
    }
    catch (err) {
        console.warn('purchaseListJob: compound query failed, scanning Pending orders:', err);
        const snap = await db.collection('orders').where('status', '==', 'Pending').get();
        return snap.docs.filter((doc) => {
            const raw = doc.data().orderDate;
            const ms = raw && typeof raw.toMillis === 'function'
                ? raw.toMillis()
                : raw instanceof Date
                    ? raw.getTime()
                    : 0;
            return ms >= startMs && ms < endMs;
        });
    }
}
async function sumCoveredQtyByKey(db) {
    const covered = new Map();
    const lists = await db.collection('purchaseLists').get();
    for (const listDoc of lists.docs) {
        const items = await listDoc.ref.collection('items').get();
        for (const itemDoc of items.docs) {
            const data = itemDoc.data();
            const found = typeof data.foundQty === 'number' && Number.isFinite(data.foundQty)
                ? Math.max(0, Math.floor(data.foundQty))
                : 0;
            if (found <= 0)
                continue;
            const key = coverageKey({
                medicineId: data.medicineId,
                medicineName: data.medicineName,
            });
            covered.set(key, (covered.get(key) || 0) + found);
        }
    }
    return covered;
}
async function aggregateGrossNeed(db, orderDocs) {
    var _a;
    const medicineCache = new Map();
    const aggregate = new Map();
    for (const orderDoc of orderDocs) {
        const order = orderDoc.data();
        const orderNumber = (typeof order.invoiceNumber === 'string' && order.invoiceNumber) ||
            orderReference(orderDoc.id);
        const medicines = Array.isArray(order.medicines) ? order.medicines : [];
        for (const medicine of medicines) {
            const key = productAggregateKey(medicine);
            const medicineId = String(medicine.medicineId || '').trim();
            let manufacturer = String(medicine.manufacturerName || '').trim();
            if (!manufacturer && medicineId) {
                if (!medicineCache.has(medicineId)) {
                    try {
                        const medSnap = await db.collection('medicines').doc(medicineId).get();
                        medicineCache.set(medicineId, medSnap.exists ? String(((_a = medSnap.data()) === null || _a === void 0 ? void 0 : _a.manufacturer) || 'N/A') : 'N/A');
                    }
                    catch (_b) {
                        medicineCache.set(medicineId, 'N/A');
                    }
                }
                manufacturer = medicineCache.get(medicineId) || 'N/A';
            }
            if (!manufacturer)
                manufacturer = 'N/A';
            const qty = Number(medicine.quantity) || 0;
            const existing = aggregate.get(key);
            if (existing) {
                existing.totalQty += qty;
                existing.orderNumbers.add(orderNumber);
            }
            else {
                aggregate.set(key, {
                    key,
                    medicineId,
                    medicineName: String(medicine.name || 'Unknown'),
                    manufacturer,
                    totalQty: qty,
                    orderNumbers: new Set([orderNumber]),
                });
            }
        }
    }
    return Array.from(aggregate.values()).sort((a, b) => {
        const m = a.manufacturer.localeCompare(b.manufacturer);
        if (m !== 0)
            return m;
        return a.medicineName.localeCompare(b.medicineName);
    });
}
async function supersedeOpenLists(db) {
    const open = await db.collection('purchaseLists').where('status', '==', 'open').get();
    if (open.empty)
        return 0;
    const batch = db.batch();
    for (const doc of open.docs) {
        batch.update(doc.ref, {
            status: 'superseded',
            supersededAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    return open.size;
}
async function writePurchaseListItems(db, listRef, rows) {
    const chunkSize = 400;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const batch = db.batch();
        const slice = rows.slice(i, i + chunkSize);
        for (const row of slice) {
            const itemRef = listRef.collection('items').doc();
            batch.set(itemRef, {
                medicineId: row.medicineId,
                medicineName: row.medicineName,
                manufacturer: row.manufacturer,
                totalQty: row.totalQty,
                grossQty: row.grossQty,
                coveredQty: row.coveredQty,
                orderCount: row.orderNumbers.length,
                orderNumbers: row.orderNumbers,
                status: 'pending',
                foundQty: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
}
/**
 * Publish net remaining purchase need for an IST calendar day.
 * Subtracts foundQty already recorded on any prior purchase list items.
 */
async function publishNetPurchaseListForDay(args) {
    const db = admin.firestore();
    const today = istDateString();
    const fromDate = args.fromDate || args.dateStr || today;
    const toDate = args.toDate || args.dateStr || today;
    const { startMs } = istDayRangeMs(fromDate);
    const { endMs } = istDayRangeMs(toDate);
    const orderDocs = await loadPendingOrdersInRange(db, startMs, endMs);
    const grossRows = await aggregateGrossNeed(db, orderDocs);
    const covered = await sumCoveredQtyByKey(db);
    let eliminatedCount = 0;
    let reducedCount = 0;
    const netRows = [];
    for (const row of grossRows) {
        const coveredQty = covered.get(row.key) || 0;
        const net = Math.max(0, row.totalQty - coveredQty);
        if (net <= 0) {
            eliminatedCount += 1;
            continue;
        }
        if (coveredQty > 0)
            reducedCount += 1;
        netRows.push({
            medicineId: row.medicineId,
            medicineName: row.medicineName,
            manufacturer: row.manufacturer,
            totalQty: net,
            orderNumbers: Array.from(row.orderNumbers).sort(),
            grossQty: row.totalQty,
            coveredQty,
        });
    }
    if (netRows.length === 0) {
        return {
            listId: null,
            itemCount: 0,
            totalQtyNeeded: 0,
            pendingOrderCount: orderDocs.length,
            eliminatedCount,
            reducedCount,
            supersededOpenLists: 0,
            fromDate,
            toDate,
            message: orderDocs.length === 0
                ? 'No pending orders for the selected dates'
                : 'All pending product need is already covered by purchase officer findings',
        };
    }
    const supersededOpenLists = await supersedeOpenLists(db);
    const totalQtyNeeded = netRows.reduce((s, r) => s + r.totalQty, 0);
    const listRef = db.collection('purchaseLists').doc();
    await listRef.set({
        fromDate,
        toDate,
        status: 'open',
        createdBy: args.createdBy || 'system',
        source: args.source,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        itemCount: netRows.length,
        totalQtyNeeded,
        pendingOrderCount: orderDocs.length,
        eliminatedCount,
        reducedCount,
    });
    await writePurchaseListItems(db, listRef, netRows);
    return {
        listId: listRef.id,
        itemCount: netRows.length,
        totalQtyNeeded,
        pendingOrderCount: orderDocs.length,
        eliminatedCount,
        reducedCount,
        supersededOpenLists,
        fromDate,
        toDate,
        message: `Published ${netRows.length} medicines (net remaining after purchase officer findings)`,
    };
}
async function runScheduledPublish(source) {
    const result = await publishNetPurchaseListForDay({ source, createdBy: 'system' });
    console.log(`[${source}]`, JSON.stringify(result));
}
/** Daily 12:00 Asia/Kolkata — first purchase run from today's pending orders */
exports.scheduledPurchaseListNoon = functions.pubsub
    .schedule('0 12 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    await runScheduledPublish('scheduled-12');
});
/** Daily 15:00 Asia/Kolkata — refresh remaining need (excludes already found qty) */
exports.scheduledPurchaseListAfternoon = functions.pubsub
    .schedule('0 15 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    await runScheduledPublish('scheduled-15');
});
/**
 * Admin/operations callable: run the same net publish job on demand
 * (optional date YYYY-MM-DD, defaults to today IST).
 */
exports.publishPurchaseListNet = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
    const role = userDoc.exists ? String(((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || '') : '';
    if (!['admin', 'Admin', 'operations', 'Operations'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }
    const dateOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
    const fromDate = dateOk(data === null || data === void 0 ? void 0 : data.fromDate)
        ? data.fromDate.trim()
        : dateOk(data === null || data === void 0 ? void 0 : data.dateStr)
            ? data.dateStr.trim()
            : undefined;
    const toDate = dateOk(data === null || data === void 0 ? void 0 : data.toDate)
        ? data.toDate.trim()
        : dateOk(data === null || data === void 0 ? void 0 : data.dateStr)
            ? data.dateStr.trim()
            : undefined;
    return publishNetPurchaseListForDay({
        fromDate,
        toDate,
        source: 'manual-admin',
        createdBy: context.auth.uid,
    });
});
//# sourceMappingURL=purchaseListJob.js.map
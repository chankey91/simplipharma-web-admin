"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminReindexMedicinesTypesense = exports.searchMedicinesTypesense = exports.onMedicineWriteTypesense = exports.TYPESENSE_COLLECTION = void 0;
exports.getTypesenseClient = getTypesenseClient;
exports.upsertMedicineInTypesense = upsertMedicineInTypesense;
exports.deleteMedicineFromTypesense = deleteMedicineFromTypesense;
/**
 * Typesense search index for `medicines` (Firestore source of truth).
 *
 * Versions:
 * - NPM `typesense` (JS client): use latest 3.x in `functions/` (`npm install typesense@latest`).
 * - Typesense Server (Cloud or self-host): e.g. Docker `typesense/typesense:30.1` — see `docker-compose.typesense.yml`.
 *
 * Configure (deployed project) — see `functions/TYPESENSE_CONFIG.md`. Example (self-host HTTP on port 8088):
 *   firebase functions:config:set \
 *     typesense.host="YOUR_SERVER_IP" \
 *     typesense.api_key='YOUR_KEY' \
 *     typesense.protocol="http" \
 *     typesense.port="8088"
 *
 * Typesense Cloud: use https + 443. After config: `firebase deploy --only functions`.
 * Run callable `adminReindexMedicinesTypesense` once (Admin → Inventory → Rebuild search index).
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const typesense_1 = require("typesense");
exports.TYPESENSE_COLLECTION = 'medicines';
function getTypesenseConfig() {
    const cfg = functions.config().typesense;
    if (!(cfg === null || cfg === void 0 ? void 0 : cfg.host) || !(cfg === null || cfg === void 0 ? void 0 : cfg.api_key)) {
        return null;
    }
    const protocol = (cfg.protocol || 'https').replace(/:$/, '');
    const defaultPort = protocol === 'https' ? '443' : '8108';
    const port = parseInt(String(cfg.port || defaultPort), 10) || (protocol === 'https' ? 443 : 8108);
    return {
        host: String(cfg.host).trim(),
        apiKey: String(cfg.api_key).trim(),
        protocol,
        port,
    };
}
function getTypesenseClient() {
    const c = getTypesenseConfig();
    if (!c)
        return null;
    return new typesense_1.default.Client({
        nodes: [{ host: c.host, port: c.port, protocol: c.protocol }],
        apiKey: c.apiKey,
        connectionTimeoutSeconds: 15,
    });
}
async function ensureCollection(client) {
    try {
        await client.collections(exports.TYPESENSE_COLLECTION).retrieve();
    }
    catch (_a) {
        await client.collections().create({
            name: exports.TYPESENSE_COLLECTION,
            fields: [
                { name: 'name', type: 'string' },
                { name: 'code', type: 'string', optional: true },
                { name: 'manufacturer', type: 'string', optional: true },
                { name: 'category', type: 'string', optional: true, facet: true },
                { name: 'price', type: 'float', optional: true },
            ],
        });
    }
}
function firestoreDataToTypesenseDoc(medicineId, data) {
    var _a, _b;
    if (!data || data.deleted === true)
        return null;
    const basePrice = (_b = (_a = data.price) !== null && _a !== void 0 ? _a : data.mrp) !== null && _b !== void 0 ? _b : 0;
    const price = typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
    return {
        id: medicineId,
        name: String(data.name || ''),
        code: data.code != null ? String(data.code) : '',
        manufacturer: String(data.manufacturer || data.company || ''),
        category: String(data.category || ''),
        price,
    };
}
async function upsertMedicineInTypesense(medicineId, data) {
    const client = getTypesenseClient();
    if (!client) {
        console.warn('Typesense: not configured, skip upsert');
        return;
    }
    const doc = firestoreDataToTypesenseDoc(medicineId, data);
    if (!doc) {
        await deleteMedicineFromTypesense(medicineId).catch(() => undefined);
        return;
    }
    await ensureCollection(client);
    await client.collections(exports.TYPESENSE_COLLECTION).documents().upsert(doc);
}
async function deleteMedicineFromTypesense(medicineId) {
    const client = getTypesenseClient();
    if (!client)
        return;
    try {
        await client.collections(exports.TYPESENSE_COLLECTION).documents(medicineId).delete();
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.httpStatus) === 404)
            return;
        throw e;
    }
}
/** Firestore sync: index on create/update, remove on delete or soft-delete. */
exports.onMedicineWriteTypesense = functions.firestore
    .document('medicines/{medicineId}')
    .onWrite(async (change, context) => {
    const medicineId = context.params.medicineId;
    try {
        if (!change.after.exists) {
            await deleteMedicineFromTypesense(medicineId);
            return;
        }
        const data = change.after.data();
        if ((data === null || data === void 0 ? void 0 : data.deleted) === true) {
            await deleteMedicineFromTypesense(medicineId);
            return;
        }
        await upsertMedicineInTypesense(medicineId, data);
    }
    catch (err) {
        console.error('onMedicineWriteTypesense failed', medicineId, err);
    }
});
async function isAdmin(uid) {
    var _a;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    return Boolean(userDoc.exists && ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) === 'admin');
}
/** Parse minimal Medicine card fields (aligned with mobile parseMedicineDocLite). */
function parseMedicineLiteFromSnap(snap) {
    var _a, _b, _c;
    const data = snap.data();
    if (!data || data.deleted === true)
        return null;
    const basePrice = (_b = (_a = data.price) !== null && _a !== void 0 ? _a : data.mrp) !== null && _b !== void 0 ? _b : 0;
    let price = typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
    let mrp = data.mrp != null
        ? typeof data.mrp === 'number'
            ? data.mrp
            : parseFloat(String(data.mrp))
        : undefined;
    const rawBatches = Array.isArray(data.stockBatches) ? data.stockBatches : [];
    const stockBatches = rawBatches
        .map((b) => {
        var _a, _b, _c, _d, _e, _f;
        if (!b || typeof b !== 'object')
            return null;
        return Object.assign(Object.assign({}, b), { expiryDate: ((_b = (_a = b.expiryDate) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || b.expiryDate, mfgDate: ((_d = (_c = b.mfgDate) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c)) || b.mfgDate, purchaseDate: ((_f = (_e = b.purchaseDate) === null || _e === void 0 ? void 0 : _e.toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) || b.purchaseDate });
    })
        .filter(Boolean);
    if (stockBatches.length > 0) {
        const sorted = [...stockBatches].sort((a, b) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const da = (_e = (_d = (_c = (_b = (_a = a.expiryDate) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.getTime) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : new Date(a.expiryDate).getTime();
            const db = (_k = (_j = (_h = (_g = (_f = b.expiryDate) === null || _f === void 0 ? void 0 : _f.toDate) === null || _g === void 0 ? void 0 : _g.call(_f)) === null || _h === void 0 ? void 0 : _h.getTime) === null || _j === void 0 ? void 0 : _j.call(_h)) !== null && _k !== void 0 ? _k : new Date(b.expiryDate).getTime();
            return da - db;
        });
        const oldest = sorted[0];
        if (oldest) {
            const disc = (Number(oldest.discountPercentage) || 0) / 100;
            const mult = 1 - disc;
            const batchMrp = oldest.mrp != null ? Number(oldest.mrp) : NaN;
            if (!isNaN(batchMrp))
                price = batchMrp * mult;
            else if (oldest.purchasePrice != null) {
                const bp = Number(oldest.purchasePrice);
                if (!isNaN(bp))
                    price = bp * mult;
            }
            if (oldest.mrp != null)
                mrp = Number(oldest.mrp);
        }
    }
    return {
        id: snap.id,
        name: String(data.name || ''),
        code: data.code ? String(data.code) : undefined,
        category: String(data.category || ''),
        unit: data.unit ? String(data.unit) : undefined,
        stock: typeof data.stock === 'number' ? data.stock : parseInt(String((_c = data.stock) !== null && _c !== void 0 ? _c : '0'), 10) || 0,
        currentStock: data.currentStock,
        price,
        mrp,
        manufacturer: String(data.manufacturer || data.company || ''),
        company: data.company ? String(data.company) : undefined,
        description: data.description,
        imageUrl: data.imageUrl,
        gstRate: data.gstRate,
        salesSchemeDeal: data.salesSchemeDeal,
        salesSchemeFree: data.salesSchemeFree,
        purchaseSchemeDeal: data.purchaseSchemeDeal,
        purchaseSchemeFree: data.purchaseSchemeFree,
        stockBatches: undefined,
    };
}
async function fetchMedicinesOrderedByIds(ids) {
    const db = admin.firestore();
    const out = [];
    const map = new Map();
    for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const refs = chunk.map((id) => db.collection('medicines').doc(id));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) {
            const m = parseMedicineLiteFromSnap(s);
            if (m)
                map.set(s.id, m);
        }
    }
    for (const id of ids) {
        const row = map.get(id);
        if (row)
            out.push(row);
    }
    return out;
}
/** Map Typesense hit documents only (no Firestore) — fast path for autocomplete UIs. */
function medicinesFromTypesenseHitsOnly(hits) {
    const out = [];
    for (const h of hits) {
        const d = (h.document && typeof h.document === 'object' ? h.document : {});
        const id = String(d.id || '').trim();
        if (!id)
            continue;
        const rawPrice = d.price;
        const price = typeof rawPrice === 'number'
            ? rawPrice
            : parseFloat(String(rawPrice !== null && rawPrice !== void 0 ? rawPrice : 0)) || 0;
        const codeRaw = d.code;
        out.push({
            id,
            name: String(d.name || ''),
            code: codeRaw != null && String(codeRaw).trim() !== '' ? String(codeRaw) : undefined,
            category: String(d.category || ''),
            manufacturer: String(d.manufacturer || ''),
            price,
            stock: 0,
        });
    }
    return out;
}
/**
 * `code` in the index is often GST HSN — shared by many SKUs. Searching it in Typesense with
 * name/manufacturer pollutes ranking for text queries (e.g. product names). For strict admin search,
 * only search `code` when the query looks like an HSN / numeric lookup.
 */
function typesenseQueryBy(query, strict) {
    if (!strict)
        return 'name,code,manufacturer';
    const t = query.trim();
    const digitsOnly = t.replace(/\D/g, '');
    const hasLetter = /[a-zA-Z]/.test(t);
    const looksNumericLookup = digitsOnly.length >= 2 && !hasLetter;
    if (looksNumericLookup)
        return 'name,code,manufacturer';
    return 'name,manufacturer';
}
/** Comma-separated weights 1:1 with `query_by` field order (name strongest; code between name and mfr when present). */
function typesenseQueryByWeights(queryBy) {
    const n = queryBy.split(',').map((s) => s.trim()).filter(Boolean).length;
    if (n === 3)
        return '4,2,1';
    if (n === 2)
        return '4,1';
    return '1';
}
/**
 * Authenticated catalog search (Typesense + optional Firestore hydrate).
 * minInstances keeps one instance warm to reduce cold-start latency (requires Blaze; billed while idle).
 */
exports.searchMedicinesTypesense = functions
    .runWith({ minInstances: 1 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const query = String(data.query || '').trim();
    const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 120);
    /** Admin UIs: stricter matching so unrelated products (e.g. fuzzy noise) don’t rank in. */
    const strict = data.strict === true;
    /** Default true: full lite docs from Firestore. Set false for autocomplete speed (Typesense fields only). */
    const hydrate = data.hydrate !== false;
    if (query.length < 2) {
        return { medicines: [], source: 'typesense' };
    }
    const client = getTypesenseClient();
    if (!client) {
        throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured on the server');
    }
    try {
        await ensureCollection(client);
        const queryBy = typesenseQueryBy(query, strict);
        const res = await client.collections(exports.TYPESENSE_COLLECTION).documents().search({
            q: query,
            query_by: queryBy,
            query_by_weights: typesenseQueryByWeights(queryBy),
            per_page: limit,
            // strict (admin): no prefix fan-out + 1 typo — cuts unrelated fuzzy matches vs loose retailer search
            prefix: !strict,
            num_typos: strict ? 1 : 2,
            sort_by: '_text_match:desc',
            prioritize_exact_match: true,
        });
        const hits = res.hits || [];
        if (!hydrate) {
            const medicines = medicinesFromTypesenseHitsOnly(hits);
            return { medicines, source: 'typesense_index' };
        }
        const ids = hits.map((h) => { var _a; return String(((_a = h.document) === null || _a === void 0 ? void 0 : _a.id) || ''); }).filter(Boolean);
        const medicines = await fetchMedicinesOrderedByIds(ids);
        return { medicines, source: 'typesense' };
    }
    catch (err) {
        console.error('searchMedicinesTypesense error', (err === null || err === void 0 ? void 0 : err.message) || err);
        throw new functions.https.HttpsError('internal', (err === null || err === void 0 ? void 0 : err.message) || 'Search failed');
    }
});
/** One-time / maintenance: full reindex from Firestore (admin only). */
exports.adminReindexMedicinesTypesense = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    if (!(await isAdmin(context.auth.uid))) {
        throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }
    const client = getTypesenseClient();
    if (!client) {
        throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured. Set functions config typesense.host and typesense.api_key.');
    }
    await ensureCollection(client);
    let batch = [];
    const flush = async () => {
        if (batch.length === 0)
            return;
        await client.collections(exports.TYPESENSE_COLLECTION).documents().import(batch, { action: 'upsert' });
        batch = [];
    };
    const snap = await admin.firestore().collection('medicines').get();
    let count = 0;
    for (const doc of snap.docs) {
        const d = firestoreDataToTypesenseDoc(doc.id, doc.data());
        if (d) {
            batch.push(d);
            count++;
        }
        if (batch.length >= 100)
            await flush();
    }
    await flush();
    return { ok: true, indexed: count, totalDocs: snap.size };
});
//# sourceMappingURL=typesenseMedicines.js.map
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
exports.TYPESENSE_COLLECTION = 'medicines';
function loadTypesenseClientConstructor() {
    var _a;
    // Lazy require — avoids slow cold load during Firebase deploy discovery
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Typesense = require('typesense');
    return ((_a = Typesense.default) !== null && _a !== void 0 ? _a : Typesense).Client;
}
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
    const Client = loadTypesenseClientConstructor();
    return new Client({
        nodes: [{ host: c.host, port: c.port, protocol: c.protocol }],
        apiKey: c.apiKey,
        connectionTimeoutSeconds: 15,
    });
}
const COLLECTION_FIELDS_BASE = [
    { name: 'name', type: 'string' },
    { name: 'code', type: 'string', optional: true },
    { name: 'manufacturer', type: 'string', optional: true },
    { name: 'category', type: 'string', optional: true, facet: true },
    { name: 'price', type: 'float', optional: true },
    /** Lowercase concat of name/code/mfr/category for middle-token & multi-word recall */
    { name: 'search_blob', type: 'string', optional: true },
];
async function ensureCollection(client) {
    try {
        const existing = await client.collections(exports.TYPESENSE_COLLECTION).retrieve();
        const names = new Set((existing.fields || []).map((f) => f.name));
        if (!names.has('search_blob')) {
            await client.collections(exports.TYPESENSE_COLLECTION).update({
                fields: [{ name: 'search_blob', type: 'string', optional: true }],
            });
        }
    }
    catch (e) {
        const http = e === null || e === void 0 ? void 0 : e.httpStatus;
        if (http !== 404)
            throw e;
        await client.collections().create({
            name: exports.TYPESENSE_COLLECTION,
            fields: COLLECTION_FIELDS_BASE,
        });
    }
}
/** Mirrors mobile/Firestore search helpers: joint text blob for Typesense recall. */
function buildMedicineSearchBlob(data) {
    if (!data)
        return '';
    const parts = [data.name, data.manufacturer, data.company, data.code, data.category]
        .filter((x) => x != null && String(x).trim() !== '')
        .map((x) => String(x).trim());
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function firestoreDataToTypesenseDoc(medicineId, data) {
    var _a, _b;
    if (!data || data.deleted === true)
        return null;
    const basePrice = (_b = (_a = data.price) !== null && _a !== void 0 ? _a : data.mrp) !== null && _b !== void 0 ? _b : 0;
    const price = typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
    const searchBlob = buildMedicineSearchBlob(data);
    const doc = {
        id: medicineId,
        name: String(data.name || ''),
        code: data.code != null ? String(data.code) : '',
        manufacturer: String(data.manufacturer || data.company || ''),
        category: String(data.category || ''),
        price,
    };
    if (searchBlob)
        doc.search_blob = searchBlob;
    return doc;
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
async function canReindexMedicines(uid) {
    var _a;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const role = userDoc.exists ? (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role : undefined;
    return role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations';
}
/** Parse minimal Medicine card fields (aligned with mobile parseMedicineDocLite). */
async function parseMedicineLiteFromSnap(snap) {
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
    // Prefer embedded stockBatches; if empty, try medicineBatches collection (post-split).
    let rawBatches = Array.isArray(data.stockBatches) ? data.stockBatches : [];
    if (rawBatches.length === 0) {
        try {
            const batchSnap = await admin
                .firestore()
                .collection('medicineBatches')
                .where('medicineId', '==', snap.id)
                .limit(50)
                .get();
            rawBatches = batchSnap.docs.map((d) => d.data());
        }
        catch (err) {
            console.warn('medicineBatches lookup failed for', snap.id, err);
        }
    }
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
            const m = await parseMedicineLiteFromSnap(s);
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
 * `code` alone is shared HSN for many SKUs — keep index field for lookups but prefer `search_blob`
 * (+ name/mfr) for fuzzy text when strict; digit-only lookups still prioritize `code` via query_by shape.
 */
function typesenseQueryBy(query, strict) {
    if (!strict)
        return 'search_blob,name,code,manufacturer';
    const t = query.trim();
    const digitsOnly = t.replace(/\D/g, '');
    const hasLetter = /[a-zA-Z]/.test(t);
    const looksNumericLookup = digitsOnly.length >= 2 && !hasLetter;
    if (looksNumericLookup)
        return 'search_blob,name,code,manufacturer';
    return 'search_blob,name,manufacturer';
}
/** Align weights with {@link typesenseQueryBy} field order: search_blob boosts middle-token recall. */
function typesenseQueryByWeights(queryBy) {
    const weights = {
        search_blob: 4,
        name: 6,
        code: 5,
        manufacturer: 2,
    };
    const parts = queryBy
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return parts.map((field) => { var _a; return String((_a = weights[field]) !== null && _a !== void 0 ? _a : 3); }).join(',');
}
/** Natural / retailer-style broad search when `strict` is not true OR `queryMode === 'natural'`. */
function isBroadRetailSearch(strict, queryModeRaw) {
    if (!strict)
        return true;
    return String(queryModeRaw || '').toLowerCase() === 'natural';
}
/**
 * Authenticated catalog search (Typesense + optional Firestore hydrate).
 * minInstances keeps one instance warm to reduce cold-start latency (requires Blaze; billed while idle).
 *
 * Request (optional backwards-compatible fields consumed by retailer app):
 * - `matchTokenCount` — informational / future tuning
 * - `queryMode`: `'natural' | 'strict'` — `'natural'` widens Typesense behaviour even if `strict` is true (escape hatch).
 */
exports.searchMedicinesTypesense = functions
    .runWith({ minInstances: 1 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
        // Lowercase to match search_blob indexing and avoid case-sensitive misses (e.g. CROCIN vs Crocin).
        const query = String(data.query || '').trim().toLowerCase();
        const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 120);
    /** `strict !== true` (default unless explicitly `true`): prefix + extra typos + split_join_tokens — aligns with retailer mobile fallback. Admin panels pass `{ strict: true }`. */
    const strict = data.strict === true;
    const broad = isBroadRetailSearch(strict, data.queryMode);
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
            prefix: broad,
            num_typos: broad ? 2 : 1,
            split_join_tokens: broad ? 'always' : 'fallback',
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
    .https.onCall(async (_data, context) => {
    try {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
        }
        if (!(await canReindexMedicines(context.auth.uid))) {
            throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
        }
        const client = getTypesenseClient();
        if (!client) {
            throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured. Set firebase functions:config:set typesense.host, typesense.api_key, typesense.protocol, typesense.port (http defaults to port 8108 if port omitted!), then firebase deploy --only functions. See functions/TYPESENSE_CONFIG.md.');
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
    }
    catch (err) {
        if (err instanceof functions.https.HttpsError)
            throw err;
        console.error('adminReindexMedicinesTypesense failed', err);
        const message = err &&
            typeof err === 'object' &&
            typeof err.message === 'string'
            ? err.message.trim()
            : String(err || 'unknown error').trim();
        throw new functions.https.HttpsError('failed-precondition', `Typesense unreachable or rejected the request (${message}). ` +
            'Verify firebase functions:config typesense.host, protocol, port (must match your server — e.g. 8088 is NOT the default when protocol is http; default is 8108), and api_key. ' +
            'Ensure the Typesense server allows inbound TCP from the internet / Google Cloud egress. Run: firebase deploy --only functions after config changes.');
    }
});
//# sourceMappingURL=typesenseMedicines.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsMillis = tsMillis;
exports.lower = lower;
exports.createTypesenseSync = createTypesenseSync;
/**
 * Generic Typesense sync + search factory.
 *
 * Given a per-collection config, produces the three Cloud Functions used by the
 * admin search pattern (mirrors `typesenseMedicines.ts` / `typesenseOrders.ts`):
 *   - a Firestore `onWrite` trigger that keeps the Typesense index in sync,
 *   - an authenticated `search` callable (search + filter + sort + pagination +
 *     global facet/total counts), and
 *   - an admin-only `reindex` callable for backfilling.
 *
 * Reuses the shared Typesense client/config from `typesenseMedicines.ts`.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const typesenseMedicines_1 = require("./typesenseMedicines");
/** Convert a Firestore Timestamp / date-ish value to epoch milliseconds. */
function tsMillis(value) {
    if (value == null)
        return 0;
    if (typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
}
function lower(value) {
    return String(value !== null && value !== void 0 ? value : '').trim().toLowerCase();
}
async function canReindex(uid) {
    var _a;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const role = userDoc.exists ? (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role : undefined;
    return role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations';
}
function createTypesenseSync(config) {
    const sortable = new Set(config.sortableFields);
    const ensureCollection = async (client) => {
        try {
            await client.collections(config.collectionName).retrieve();
        }
        catch (e) {
            const http = e === null || e === void 0 ? void 0 : e.httpStatus;
            if (http !== 404)
                throw e;
            await client.collections().create({
                name: config.collectionName,
                fields: config.fields,
            });
        }
    };
    const upsert = async (id, data) => {
        const client = (0, typesenseMedicines_1.getTypesenseClient)();
        if (!client) {
            console.warn(`Typesense: not configured, skip ${config.collectionName} upsert`);
            return;
        }
        const doc = config.buildDoc(id, data);
        if (!doc) {
            await remove(id).catch(() => undefined);
            return;
        }
        await ensureCollection(client);
        await client.collections(config.collectionName).documents().upsert(doc);
    };
    const remove = async (id) => {
        const client = (0, typesenseMedicines_1.getTypesenseClient)();
        if (!client)
            return;
        try {
            await client.collections(config.collectionName).documents(id).delete();
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.httpStatus) === 404)
                return;
            throw e;
        }
    };
    const onWrite = functions.firestore
        .document(`${config.collectionName}/{docId}`)
        .onWrite(async (change, context) => {
        const docId = context.params.docId;
        try {
            if (!change.after.exists) {
                await remove(docId);
                return;
            }
            await upsert(docId, change.after.data());
        }
        catch (err) {
            console.error(`onWrite sync failed for ${config.collectionName}/${docId}`, err);
        }
    });
    const getGlobalCounts = async (client) => {
        const facetCounts = {};
        try {
            const res = await client
                .collections(config.collectionName)
                .documents()
                .search(Object.assign({ q: '*', query_by: config.queryBy.split(',')[0], per_page: 0 }, (config.facetField ? { facet_by: config.facetField } : {})));
            const totalAll = Number(res.found) || 0;
            if (config.facetField) {
                const facet = (res.facet_counts || []).find((f) => f.field_name === config.facetField);
                for (const c of (facet === null || facet === void 0 ? void 0 : facet.counts) || []) {
                    facetCounts[String(c.value)] = Number(c.count) || 0;
                }
            }
            return { totalAll, facetCounts };
        }
        catch (e) {
            console.warn(`getGlobalCounts failed for ${config.collectionName}`, e);
            return { totalAll: 0, facetCounts };
        }
    };
    const search = functions.https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
        }
        const client = (0, typesenseMedicines_1.getTypesenseClient)();
        if (!client) {
            throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured on the server');
        }
        const rawQuery = String((data === null || data === void 0 ? void 0 : data.query) || '').trim();
        const q = rawQuery.length > 0 ? rawQuery : '*';
        const filter = String((data === null || data === void 0 ? void 0 : data.filter) || '').trim();
        const page = Math.max(1, Number(data === null || data === void 0 ? void 0 : data.page) || 1);
        const perPage = Math.min(Math.max(Number(data === null || data === void 0 ? void 0 : data.perPage) || 10, 1), 100);
        const sortFieldRaw = String((data === null || data === void 0 ? void 0 : data.sortField) || config.defaultSort);
        const sortField = sortable.has(sortFieldRaw) ? sortFieldRaw : config.defaultSort;
        const sortOrder = String((data === null || data === void 0 ? void 0 : data.sortOrder) || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        try {
            await ensureCollection(client);
            const searchParams = {
                q,
                query_by: config.queryBy,
                sort_by: `${sortField}:${sortOrder}`,
                per_page: perPage,
                page,
                prefix: true,
                num_typos: 1,
            };
            if (config.facetField && filter && filter !== 'All') {
                searchParams.filter_by = `${config.facetField}:=\`${filter}\``;
            }
            const res = await client
                .collections(config.collectionName)
                .documents()
                .search(searchParams);
            const rows = (res.hits || []).map((h) => h.document && typeof h.document === 'object' ? h.document : {});
            const { totalAll, facetCounts } = await getGlobalCounts(client);
            return {
                rows,
                found: Number(res.found) || 0,
                page,
                perPage,
                facetCounts,
                totalAll,
                source: 'typesense',
            };
        }
        catch (err) {
            console.error(`search failed for ${config.collectionName}`, (err === null || err === void 0 ? void 0 : err.message) || err);
            throw new functions.https.HttpsError('internal', (err === null || err === void 0 ? void 0 : err.message) || 'Search failed');
        }
    });
    const reindex = functions
        .runWith({ timeoutSeconds: 540, memory: '512MB' })
        .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
        }
        if (!(await canReindex(context.auth.uid))) {
            throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
        }
        const client = (0, typesenseMedicines_1.getTypesenseClient)();
        if (!client) {
            throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured. See functions/TYPESENSE_CONFIG.md.');
        }
        try {
            await ensureCollection(client);
            let batch = [];
            const flush = async () => {
                if (batch.length === 0)
                    return;
                await client
                    .collections(config.collectionName)
                    .documents()
                    .import(batch, { action: 'upsert' });
                batch = [];
            };
            const snap = await admin.firestore().collection(config.collectionName).get();
            let count = 0;
            for (const doc of snap.docs) {
                const d = config.buildDoc(doc.id, doc.data());
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
            console.error(`reindex failed for ${config.collectionName}`, err);
            const message = err && typeof err === 'object' && typeof err.message === 'string'
                ? err.message.trim()
                : String(err || 'unknown error').trim();
            throw new functions.https.HttpsError('failed-precondition', `Typesense unreachable or rejected the request (${message}). Verify functions:config typesense.* and server reachability, then redeploy.`);
        }
    });
    return { onWrite, search, reindex };
}
//# sourceMappingURL=typesenseSync.js.map
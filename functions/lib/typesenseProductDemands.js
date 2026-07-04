"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchProductDemandsTypesense = exports.adminReindexProductDemandsTypesense = exports.onProductDemandWriteTypesense = void 0;
/** Typesense sync + auth-scoped search for `product_demands`. */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const typesenseSync_1 = require("./typesenseSync");
const typesenseMedicines_1 = require("./typesenseMedicines");
const COLLECTION = 'product_demands';
const SORTABLE = new Set([
    'docId',
    'productName',
    'manufacturerName',
    'retailerName',
    'retailerSort',
    'requestedQuantity',
    'status',
    'createdAt',
]);
const productDemandSync = (0, typesenseSync_1.createTypesenseSync)({
    collectionName: COLLECTION,
    fields: [
        { name: 'docId', type: 'string', sort: true },
        { name: 'retailerId', type: 'string', optional: true, facet: true },
        { name: 'productName', type: 'string', sort: true },
        { name: 'manufacturerName', type: 'string', optional: true, sort: true },
        { name: 'retailerName', type: 'string', optional: true, sort: true },
        { name: 'retailerEmail', type: 'string', optional: true, sort: true },
        { name: 'retailerSort', type: 'string', optional: true, sort: true },
        { name: 'search_blob', type: 'string', optional: true },
        { name: 'status', type: 'string', facet: true, sort: true },
        { name: 'requestedQuantity', type: 'int32', sort: true },
        { name: 'requestedUnit', type: 'string', optional: true },
        { name: 'orderId', type: 'string', optional: true },
        { name: 'imageUrl', type: 'string', optional: true },
        { name: 'createdAt', type: 'int64', sort: true },
    ],
    queryBy: 'search_blob,productName,manufacturerName,retailerName,retailerEmail',
    sortableFields: [...SORTABLE],
    defaultSort: 'createdAt',
    facetField: 'status',
    buildDoc: (id, data) => {
        if (!data)
            return null;
        const productName = String(data.productName || '');
        const manufacturerName = String(data.manufacturerName || '');
        const retailerName = String(data.retailerName || '');
        const retailerEmail = String(data.retailerEmail || '');
        const notes = typeof data.notes === 'string' ? data.notes : '';
        const searchBlob = [productName, manufacturerName, retailerName, retailerEmail, notes]
            .filter((x) => x && String(x).trim() !== '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        const rqRaw = data.requestedQuantity;
        let requestedQuantity = 1;
        if (typeof rqRaw === 'number' && Number.isFinite(rqRaw)) {
            requestedQuantity = Math.max(1, Math.floor(rqRaw));
        }
        else if (rqRaw != null && rqRaw !== '') {
            const p = parseInt(String(rqRaw), 10);
            if (!isNaN(p) && p >= 1)
                requestedQuantity = p;
        }
        return {
            id,
            docId: id,
            retailerId: String(data.retailerId || ''),
            productName,
            manufacturerName,
            retailerName,
            retailerEmail,
            retailerSort: (retailerName || retailerEmail).toLowerCase(),
            search_blob: searchBlob,
            status: String(data.status || ''),
            requestedQuantity,
            requestedUnit: String(data.requestedUnit || '—'),
            orderId: typeof data.orderId === 'string' ? data.orderId : '',
            imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : '',
            createdAt: (0, typesenseSync_1.tsMillis)(data.createdAt),
        };
    },
});
async function resolveProductDemandScope(uid) {
    var _a;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists)
        return null;
    const role = String(((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || '');
    if (role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations') {
        return undefined;
    }
    if (role === 'retailer') {
        return `retailerId:=\`${uid}\``;
    }
    if (role === 'salesOfficer' || role === 'SalesOfficer') {
        const snap = await admin
            .firestore()
            .collection('users')
            .where('role', '==', 'retailer')
            .where('salesOfficerId', '==', uid)
            .get();
        const ids = snap.docs.map((d) => d.id).filter(Boolean);
        if (ids.length === 0)
            return `retailerId:=\`__none__\``;
        return `retailerId:[${ids.map((id) => `\`${id}\``).join(',')}]`;
    }
    return null;
}
exports.onProductDemandWriteTypesense = productDemandSync.onWrite;
exports.adminReindexProductDemandsTypesense = productDemandSync.reindex;
/** Auth-scoped product demand search (retailer / SO / admin). */
exports.searchProductDemandsTypesense = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const client = (0, typesenseMedicines_1.getTypesenseClient)();
    if (!client) {
        throw new functions.https.HttpsError('failed-precondition', 'Typesense is not configured on the server');
    }
    const scopeFilter = await resolveProductDemandScope(context.auth.uid);
    if (scopeFilter === null) {
        throw new functions.https.HttpsError('permission-denied', 'Product demand search not allowed');
    }
    const rawQuery = String((data === null || data === void 0 ? void 0 : data.query) || '').trim();
    const q = rawQuery.length > 0 ? rawQuery : '*';
    const status = String((data === null || data === void 0 ? void 0 : data.filter) || (data === null || data === void 0 ? void 0 : data.status) || '').trim();
    const page = Math.max(1, Number(data === null || data === void 0 ? void 0 : data.page) || 1);
    const perPage = Math.min(Math.max(Number(data === null || data === void 0 ? void 0 : data.perPage) || 20, 1), 100);
    const sortFieldRaw = String((data === null || data === void 0 ? void 0 : data.sortField) || 'createdAt');
    const sortField = SORTABLE.has(sortFieldRaw) ? sortFieldRaw : 'createdAt';
    const sortOrder = String((data === null || data === void 0 ? void 0 : data.sortOrder) || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    try {
        const filters = [];
        if (scopeFilter)
            filters.push(scopeFilter);
        if (status && status !== 'All')
            filters.push(`status:=\`${status}\``);
        const filterBy = filters.length > 0 ? filters.join(' && ') : undefined;
        const searchParams = {
            q,
            query_by: 'search_blob,productName,manufacturerName,retailerName,retailerEmail',
            sort_by: `${sortField}:${sortOrder}`,
            per_page: perPage,
            page,
            prefix: true,
            num_typos: 1,
        };
        if (filterBy)
            searchParams.filter_by = filterBy;
        const res = await client.collections(COLLECTION).documents().search(searchParams);
        const rows = (res.hits || []).map((h) => h.document && typeof h.document === 'object' ? h.document : {});
        let facetCounts = {};
        try {
            const facetParams = {
                q: '*',
                query_by: 'productName',
                per_page: 0,
                facet_by: 'status',
            };
            if (scopeFilter)
                facetParams.filter_by = scopeFilter;
            const facetRes = await client.collections(COLLECTION).documents().search(facetParams);
            const facet = (facetRes.facet_counts || []).find((f) => f.field_name === 'status');
            for (const c of (facet === null || facet === void 0 ? void 0 : facet.counts) || []) {
                facetCounts[String(c.value)] = Number(c.count) || 0;
            }
        }
        catch (e) {
            console.warn('product demand facet counts failed', e);
        }
        return {
            rows,
            found: Number(res.found) || 0,
            page,
            perPage,
            facetCounts,
            totalAll: Number(res.found) || 0,
            source: 'typesense',
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('searchProductDemandsTypesense error', message);
        throw new functions.https.HttpsError('internal', message || 'Product demand search failed');
    }
});
//# sourceMappingURL=typesenseProductDemands.js.map
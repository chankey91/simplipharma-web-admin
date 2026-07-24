/**
 * Typesense search index for `medicines` (Firestore source of truth).
 *
 * Versions:
 * - NPM `typesense` (JS client): use latest 3.x in `functions/` (`npm install typesense@latest`).
 * - Typesense Server (Cloud or self-host): e.g. Docker `typesense/typesense:30.1` â€” see `docker-compose.typesense.yml`.
 *
 * Configure (deployed project) â€” see `functions/TYPESENSE_CONFIG.md`. Example (self-host HTTP on port 8088):
 *   firebase functions:config:set \
 *     typesense.host="YOUR_SERVER_IP" \
 *     typesense.api_key='YOUR_ADMIN_KEY' \
 *     typesense.search_api_key='YOUR_SEARCH_ONLY_KEY' \
 *     typesense.protocol="http" \
 *     typesense.port="8088"
 *
 * Typesense Cloud: use https + 443. After config: `firebase deploy --only functions`.
 * Run callable `adminReindexMedicinesTypesense` once (Admin â†’ Inventory â†’ Rebuild search index).
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { MEDICINE_SYNONYM_SEED } from './typesenseMedicineSynonyms';

export const TYPESENSE_COLLECTION = 'medicines';

type TypesenseClient = import('typesense').Client;

function loadTypesenseClientConstructor(): typeof import('typesense').default.Client {
  // Lazy require â€” avoids slow cold load during Firebase deploy discovery
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Typesense = require('typesense');
  return (Typesense.default ?? Typesense).Client;
}

type TypesenseRuntimeConfig = {
  host: string;
  apiKey: string;
  searchApiKey: string;
  protocol: string;
  port: number;
};

function getTypesenseConfig(): TypesenseRuntimeConfig | null {
  const cfg = functions.config().typesense as
    | {
        host?: string;
        api_key?: string;
        search_api_key?: string;
        protocol?: string;
        port?: string;
      }
    | undefined;
  if (!cfg?.host || !cfg?.api_key) {
    return null;
  }
  const protocol = (cfg.protocol || 'https').replace(/:$/, '');
  const defaultPort = protocol === 'https' ? '443' : '8108';
  const port = parseInt(String(cfg.port || defaultPort), 10) || (protocol === 'https' ? 443 : 8108);
  const apiKey = String(cfg.api_key).trim();
  const searchApiKey = String(cfg.search_api_key || cfg.api_key).trim();
  return {
    host: String(cfg.host).trim(),
    apiKey,
    searchApiKey,
    protocol,
    port,
  };
}

/** Admin/master key — upsert, delete, reindex, synonyms. */
export function getTypesenseClient(): TypesenseClient | null {
  return buildTypesenseClient('admin');
}

/** Search-only key when configured (falls back to admin key). Prefer for hot search path. */
export function getTypesenseSearchClient(): TypesenseClient | null {
  return buildTypesenseClient('search');
}

function buildTypesenseClient(mode: 'admin' | 'search'): TypesenseClient | null {
  const c = getTypesenseConfig();
  if (!c) return null;
  const Client = loadTypesenseClientConstructor();
  return new Client({
    nodes: [{ host: c.host, port: c.port, protocol: c.protocol as 'http' | 'https' }],
    apiKey: mode === 'search' ? c.searchApiKey : c.apiKey,
    connectionTimeoutSeconds: 15,
  });
}

const COLLECTION_FIELDS_BASE = [
  { name: 'name', type: 'string' as const, sort: true },
  { name: 'code', type: 'string' as const, optional: true },
  { name: 'manufacturer', type: 'string' as const, optional: true, facet: true, sort: true },
  { name: 'category', type: 'string' as const, optional: true, facet: true },
  { name: 'price', type: 'float' as const, optional: true },
  /** Lowercase concat of name/code/mfr/category for middle-token & multi-word recall */
  { name: 'search_blob', type: 'string' as const, optional: true },
  /** Denormalized master aggregates â€” required for Inventory browse/filter at scale (no full catalog download). */
  { name: 'stock', type: 'int32' as const, optional: true, sort: true, facet: true },
  { name: 'currentStock', type: 'int32' as const, optional: true },
  { name: 'nearestExpiry', type: 'int64' as const, optional: true, sort: true },
  { name: 'unit', type: 'string' as const, optional: true },
  { name: 'gstRate', type: 'float' as const, optional: true },
];

const OPTIONAL_SCHEMA_FIELDS = COLLECTION_FIELDS_BASE.filter((f) =>
  ['search_blob', 'stock', 'currentStock', 'nearestExpiry', 'unit', 'gstRate'].includes(f.name)
);

/** One ensure per warm instance â€” never on every search (hot path). */
let ensureCollectionPromise: Promise<void> | null = null;

async function ensureCollection(client: TypesenseClient): Promise<void> {
  if (!ensureCollectionPromise) {
    ensureCollectionPromise = (async () => {
      try {
        const existing = await client.collections(TYPESENSE_COLLECTION).retrieve();
        const names = new Set((existing.fields || []).map((f: { name: string }) => f.name));
        const toAdd = OPTIONAL_SCHEMA_FIELDS.filter((f) => !names.has(f.name));
        // name/manufacturer may exist without sort/facet â€” Typesense cannot patch those in-place;
        // new optional fields are additive. Full recreate only via reindex ops if needed.
        if (toAdd.length > 0) {
          await client.collections(TYPESENSE_COLLECTION).update({ fields: toAdd });
        }
      } catch (e: unknown) {
        const http = (e as { httpStatus?: number })?.httpStatus;
        if (http !== 404) throw e;
        await client.collections().create({
          name: TYPESENSE_COLLECTION,
          fields: COLLECTION_FIELDS_BASE,
        });
      }
    })().catch((err) => {
      ensureCollectionPromise = null;
      throw err;
    });
  }
  await ensureCollectionPromise;
}

function toEpochMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    const t = d?.getTime?.();
    return Number.isFinite(t) ? t : 0;
  }
  const t = new Date(value as string | number | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Mirrors mobile/Firestore search helpers: joint text blob for Typesense recall. */
function buildMedicineSearchBlob(data: FirebaseFirestore.DocumentData | undefined): string {
  if (!data) return '';
  const parts = [data.name, data.manufacturer, data.company, data.code, data.category]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function firestoreDataToTypesenseDoc(
  medicineId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Record<string, unknown> | null {
  if (!data || data.deleted === true) return null;
  const basePrice = data.price ?? data.mrp ?? 0;
  const price =
    typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
  const stockRaw = data.currentStock ?? data.stock ?? 0;
  const stock =
    typeof stockRaw === 'number' ? Math.max(0, Math.floor(stockRaw)) : parseInt(String(stockRaw), 10) || 0;
  const gstRaw = data.gstRate;
  const gstRate =
    typeof gstRaw === 'number' ? gstRaw : parseFloat(String(gstRaw ?? 5)) || 5;
  const searchBlob = buildMedicineSearchBlob(data);
  const doc: Record<string, unknown> = {
    id: medicineId,
    name: String(data.name || ''),
    code: data.code != null ? String(data.code) : '',
    manufacturer: String(data.manufacturer || data.company || ''),
    category: String(data.category || ''),
    price,
    stock,
    currentStock: stock,
    nearestExpiry: toEpochMs(data.nearestExpiry ?? data.expiryDate),
    unit: data.unit != null ? String(data.unit) : '',
    gstRate,
  };
  if (searchBlob) doc.search_blob = searchBlob;
  return doc;
}

export async function upsertMedicineInTypesense(
  medicineId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Promise<void> {
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
  await client.collections(TYPESENSE_COLLECTION).documents().upsert(doc);
}

export async function deleteMedicineFromTypesense(medicineId: string): Promise<void> {
  const client = getTypesenseClient();
  if (!client) return;
  try {
    await client.collections(TYPESENSE_COLLECTION).documents(medicineId).delete();
  } catch (e: any) {
    if (e?.httpStatus === 404) return;
    throw e;
  }
}

/** Firestore sync: index on create/update, remove on delete or soft-delete. */
export const onMedicineWriteTypesense = functions.firestore
  .document('medicines/{medicineId}')
  .onWrite(async (change, context) => {
    const medicineId = context.params.medicineId as string;
    try {
      if (!change.after.exists) {
        await deleteMedicineFromTypesense(medicineId);
        return;
      }
      const data = change.after.data();
      if (data?.deleted === true) {
        await deleteMedicineFromTypesense(medicineId);
        return;
      }
      await upsertMedicineInTypesense(medicineId, data);
    } catch (err) {
      console.error('onMedicineWriteTypesense failed', medicineId, err);
    }
  });

async function canReindexMedicines(uid: string): Promise<boolean> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  const role = userDoc.exists ? userDoc.data()?.role : undefined;
  return role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations';
}

/** Parse minimal Medicine card fields (aligned with mobile parseMedicineDocLite). */
async function parseMedicineLiteFromSnap(
  snap: FirebaseFirestore.DocumentSnapshot
): Promise<Record<string, unknown> | null> {
  const data = snap.data();
  if (!data || data.deleted === true) return null;
  const basePrice = data.price ?? data.mrp ?? 0;
  let price = typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
  let mrp =
    data.mrp != null
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
    } catch (err) {
      console.warn('medicineBatches lookup failed for', snap.id, err);
    }
  }

  const stockBatches = rawBatches
    .map((b: any) => {
      if (!b || typeof b !== 'object') return null;
      return {
        ...b,
        expiryDate: b.expiryDate?.toDate?.() || b.expiryDate,
        mfgDate: b.mfgDate?.toDate?.() || b.mfgDate,
        purchaseDate: b.purchaseDate?.toDate?.() || b.purchaseDate,
      };
    })
    .filter(Boolean);
  if (stockBatches.length > 0) {
    const sorted = [...stockBatches].sort((a: any, b: any) => {
      const da = a.expiryDate?.toDate?.()?.getTime?.() ?? new Date(a.expiryDate).getTime();
      const db = b.expiryDate?.toDate?.()?.getTime?.() ?? new Date(b.expiryDate).getTime();
      return da - db;
    });
    const oldest = sorted[0];
    if (oldest) {
      const disc = (Number(oldest.discountPercentage) || 0) / 100;
      const mult = 1 - disc;
      const batchMrp = oldest.mrp != null ? Number(oldest.mrp) : NaN;
      if (!isNaN(batchMrp)) price = batchMrp * mult;
      else if (oldest.purchasePrice != null) {
        const bp = Number(oldest.purchasePrice);
        if (!isNaN(bp)) price = bp * mult;
      }
      if (oldest.mrp != null) mrp = Number(oldest.mrp);
    }
  }
  return {
    id: snap.id,
    name: String(data.name || ''),
    code: data.code ? String(data.code) : undefined,
    category: String(data.category || ''),
    unit: data.unit ? String(data.unit) : undefined,
    stock: typeof data.stock === 'number' ? data.stock : parseInt(String(data.stock ?? '0'), 10) || 0,
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

async function fetchMedicinesOrderedByIds(ids: string[]): Promise<Record<string, unknown>[]> {
  const db = admin.firestore();
  const out: Record<string, unknown>[] = [];
  const map = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const refs = chunk.map((id) => db.collection('medicines').doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const m = await parseMedicineLiteFromSnap(s);
      if (m) map.set(s.id, m);
    }
  }
  for (const id of ids) {
    const row = map.get(id);
    if (row) out.push(row);
  }
  return out;
}

/** Map Typesense hit documents only (no Firestore) — fast path for autocomplete + Inventory browse. */
function medicinesFromTypesenseHitsOnly(hits: { document?: unknown }[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const h of hits) {
    const d = (h.document && typeof h.document === 'object' ? h.document : {}) as Record<
      string,
      unknown
    >;
    const id = String(d.id || '').trim();
    if (!id) continue;
    const rawPrice = d.price;
    const price =
      typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice ?? 0)) || 0;
    const stockRaw = d.currentStock ?? d.stock ?? 0;
    const stock =
      typeof stockRaw === 'number' ? stockRaw : parseInt(String(stockRaw), 10) || 0;
    const codeRaw = d.code;
    const nearestRaw = d.nearestExpiry;
    const nearestExpiry =
      typeof nearestRaw === 'number' && nearestRaw > 0 ? nearestRaw : undefined;
    const gstRaw = d.gstRate;
    const gstRate =
      typeof gstRaw === 'number' ? gstRaw : parseFloat(String(gstRaw ?? 5)) || 5;
    const unitRaw = d.unit;
    out.push({
      id,
      name: String(d.name || ''),
      code: codeRaw != null && String(codeRaw).trim() !== '' ? String(codeRaw) : undefined,
      category: String(d.category || ''),
      manufacturer: String(d.manufacturer || ''),
      price,
      stock,
      currentStock: stock,
      nearestExpiry,
      unit: unitRaw != null && String(unitRaw).trim() !== '' ? String(unitRaw) : undefined,
      gstRate,
    });
  }
  return out;
}

function typesenseQueryBy(query: string, strict: boolean): string {
  if (!strict) return 'search_blob,name,code,manufacturer';
  const t = query.trim();
  const digitsOnly = t.replace(/\D/g, '');
  const hasLetter = /[a-zA-Z]/.test(t);
  const looksNumericLookup = digitsOnly.length >= 2 && !hasLetter;
  if (looksNumericLookup) return 'search_blob,name,code,manufacturer';
  return 'search_blob,name,manufacturer';
}

function typesenseQueryByWeights(queryBy: string): string {
  const weights: Record<string, number> = {
    search_blob: 4,
    name: 6,
    code: 5,
    manufacturer: 2,
  };
  const parts = queryBy
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((field) => String(weights[field] ?? 3)).join(',');
}

function isBroadRetailSearch(strict: boolean, queryModeRaw: unknown): boolean {
  if (!strict) return true;
  return String(queryModeRaw || '').toLowerCase() === 'natural';
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function buildMedicineFilters(data: Record<string, unknown>): string[] {
  const filters: string[] = [];
  const category = String(data.category || '').trim();
  if (category && category !== 'All') {
    filters.push(`category:=\`${escapeFilterValue(category)}\``);
  }
  const manufacturer = String(data.manufacturer || '').trim();
  if (manufacturer && manufacturer !== 'All') {
    filters.push(`manufacturer:=\`${escapeFilterValue(manufacturer)}\``);
  }
  const stockFilter = String(data.stockFilter || '').trim();
  if (stockFilter === 'Out') filters.push('stock:=0');
  else if (stockFilter === 'Low') filters.push('stock:>0 && stock:<10');
  else if (stockFilter === 'In Stock') filters.push('stock:>0');

  const expiry = String(data.expiryFilter || '').trim();
  const now = Date.now();
  if (expiry === 'expired') {
    filters.push(`nearestExpiry:>0 && nearestExpiry:<${now}`);
  } else if (expiry === 'expiring') {
    const in30 = now + 30 * 24 * 60 * 60 * 1000;
    filters.push(`nearestExpiry:>=${now} && nearestExpiry:<=${in30}`);
  }
  return filters;
}

function resolveSortBy(data: Record<string, unknown>, browsing: boolean): string | undefined {
  const sortKey = String(data.sortKey || '').trim();
  const dir = String(data.sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  if (sortKey === '_text_match') return '_text_match:desc';
  // Numeric sorts are safe once stock/nearestExpiry fields exist (added via schema patch).
  if (sortKey === 'stock' || sortKey === 'nearestExpiry') return `${sortKey}:${dir}`;
  // name/manufacturer may lack sort:true on legacy collections — omit rather than fail the query.
  if (!browsing) return '_text_match:desc';
  return undefined;
}

async function upsertMedicineSynonyms(client: TypesenseClient): Promise<number> {
  let upserted = 0;
  for (const def of MEDICINE_SYNONYM_SEED) {
    const payload: { synonyms: string[]; root?: string } = { synonyms: def.synonyms };
    if (def.root) payload.root = def.root;
    await client.collections(TYPESENSE_COLLECTION).synonyms().upsert(def.id, payload);
    upserted += 1;
  }
  return upserted;
}

/** Structured log + best-effort daily Firestore counters (never blocks search). */
function recordMedicineSearchAnalytics(payload: {
  browse: boolean;
  queryLen: number;
  found: number;
  latencyMs: number;
  page: number;
  hydrate: boolean;
  empty: boolean;
}): void {
  console.log(
    JSON.stringify({
      event: 'typesense_medicine_search',
      ...payload,
    })
  );
  const day = new Date().toISOString().slice(0, 10);
  void admin
    .firestore()
    .collection('typesenseSearchAnalytics')
    .doc(`medicines_${day}`)
    .set(
      {
        day,
        collection: 'medicines',
        searches: admin.firestore.FieldValue.increment(1),
        emptySearches: admin.firestore.FieldValue.increment(payload.empty ? 1 : 0),
        browseSearches: admin.firestore.FieldValue.increment(payload.browse ? 1 : 0),
        latencyMsSum: admin.firestore.FieldValue.increment(payload.latencyMs),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch((err) => {
      console.warn('typesenseSearchAnalytics write failed', err?.message || err);
    });
}

/**
 * Authenticated catalog search (Typesense + optional Firestore hydrate).
 * Autocomplete: q length ≥ 2. Inventory browse: `browse: true` → q:"*" + page/filters/facets.
 */
export const searchMedicinesTypesense = functions
  .runWith({ minInstances: 1 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const rawQuery = String(data.query || '').trim();
    const query = rawQuery.toLowerCase();
    const browse = data.browse === true;
    const page = Math.min(Math.max(Number(data.page) || 1, 1), 500);
    const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 120);
    const strict = data.strict === true;
    const broad = isBroadRetailSearch(strict, data.queryMode);
    const hydrate = data.hydrate !== false;
    const includeFacets = data.includeFacets === true;
    const startedAt = Date.now();

    if (!browse && query.length < 2) {
      return {
        medicines: [],
        found: 0,
        page: 1,
        facet_counts: {},
        source: 'typesense' as const,
      };
    }

    // Prefer search-only key; do not ensureCollection here (needs admin key / write ACL).
    const client = getTypesenseSearchClient();
    if (!client) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Typesense is not configured on the server'
      );
    }

    try {
      const browsing = browse && query.length < 2;
      const q = browsing ? '*' : query;
      const queryBy = browsing ? 'name' : typesenseQueryBy(query, strict);
      const filters = buildMedicineFilters(data as Record<string, unknown>);
      const sortBy = resolveSortBy(data as Record<string, unknown>, browsing);
      const searchParams: Record<string, unknown> = {
        q,
        query_by: queryBy,
        per_page: limit,
        page,
        prioritize_exact_match: !browsing,
      };
      if (filters.length) searchParams.filter_by = filters.join(' && ');
      if (sortBy) searchParams.sort_by = sortBy;
      if (!browsing) {
        searchParams.query_by_weights = typesenseQueryByWeights(queryBy);
        searchParams.prefix = broad;
        searchParams.num_typos = broad ? 2 : 1;
        searchParams.split_join_tokens = broad ? 'always' : 'fallback';
      }
      if (includeFacets) {
        searchParams.facet_by = 'category,manufacturer';
        searchParams.max_facet_values = 100;
      }

      const res = await client.collections(TYPESENSE_COLLECTION).documents().search(searchParams);
      const hits = res.hits || [];
      const facet_counts: Record<string, Array<{ value: string; count: number }>> = {};
      for (const fc of res.facet_counts || []) {
        const field = String((fc as { field_name?: string }).field_name || '');
        if (!field) continue;
        facet_counts[field] = (
          (fc as { counts?: Array<{ value: string; count: number }> }).counts || []
        ).map((c) => ({ value: String(c.value), count: Number(c.count) || 0 }));
      }

      const found = Number(res.found) || hits.length;
      recordMedicineSearchAnalytics({
        browse: browsing,
        queryLen: rawQuery.length,
        found,
        latencyMs: Date.now() - startedAt,
        page,
        hydrate,
        empty: found === 0,
      });

      if (!hydrate) {
        const medicines = medicinesFromTypesenseHitsOnly(hits);
        return {
          medicines,
          found: Number(res.found) || medicines.length,
          page,
          facet_counts,
          source: 'typesense_index' as const,
        };
      }
      const ids = hits
        .map((h: { document?: { id?: string } }) => String(h.document?.id || ''))
        .filter(Boolean);
      const medicines = await fetchMedicinesOrderedByIds(ids);
      return {
        medicines,
        found: Number(res.found) || medicines.length,
        page,
        facet_counts,
        source: 'typesense' as const,
      };
    } catch (err: any) {
      console.error('searchMedicinesTypesense error', err?.message || err);
      throw new functions.https.HttpsError('internal', err?.message || 'Search failed');
    }
  });

/** Paginated reindex — safe for ~800k Firestore masters. */
export const adminReindexMedicinesTypesense = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
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
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Typesense is not configured. Set firebase functions:config:set typesense.host, typesense.api_key, typesense.protocol, typesense.port (http defaults to port 8108 if port omitted!), then firebase deploy --only functions. See functions/TYPESENSE_CONFIG.md.'
        );
      }

      ensureCollectionPromise = null;
      await ensureCollection(client);
      let batch: Record<string, unknown>[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        await client.collections(TYPESENSE_COLLECTION).documents().import(batch, { action: 'upsert' });
        batch = [];
      };

      const db = admin.firestore();
      const pageSize = 500;
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let count = 0;
      let totalDocs = 0;

      for (;;) {
        let q: FirebaseFirestore.Query = db
          .collection('medicines')
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;
        totalDocs += snap.size;
        for (const doc of snap.docs) {
          const d = firestoreDataToTypesenseDoc(doc.id, doc.data());
          if (d) {
            batch.push(d);
            count++;
          }
          if (batch.length >= 100) await flush();
        }
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize) break;
      }
      await flush();

      let synonymsUpserted = 0;
      try {
        synonymsUpserted = await upsertMedicineSynonyms(client);
      } catch (synErr: any) {
        console.warn('medicine synonyms upsert after reindex failed', synErr?.message || synErr);
      }

      return { ok: true, indexed: count, totalDocs, synonymsUpserted };
    } catch (err: unknown) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error('adminReindexMedicinesTypesense failed', err);
      const message =
        err &&
        typeof err === 'object' &&
        typeof (err as { message?: string }).message === 'string'
          ? (err as { message: string }).message.trim()
          : String(err || 'unknown error').trim();

      throw new functions.https.HttpsError(
        'failed-precondition',
        `Typesense unreachable or rejected the request (${message}). ` +
          'Verify firebase functions:config typesense.host, protocol, port (must match your server — e.g. 8088 is NOT the default when protocol is http; default is 8108), and api_key. ' +
          'Ensure the Typesense server allows inbound TCP from the internet / Google Cloud egress. Run: firebase deploy --only functions after config changes.'
      );
    }
  });

/** Upsert pharma synonym seed into Typesense (admin/ops). Safe to re-run. */
export const adminSyncMedicineSynonymsTypesense = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    if (!(await canReindexMedicines(context.auth.uid))) {
      throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }
    const client = getTypesenseClient();
    if (!client) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Typesense is not configured on the server'
      );
    }
    await ensureCollection(client);
    const upserted = await upsertMedicineSynonyms(client);
    return { ok: true, upserted, seedSize: MEDICINE_SYNONYM_SEED.length };
  });

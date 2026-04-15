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
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Typesense from 'typesense';

export const TYPESENSE_COLLECTION = 'medicines';

function getTypesenseConfig(): { host: string; apiKey: string; protocol: string; port: number } | null {
  const cfg = functions.config().typesense as
    | { host?: string; api_key?: string; protocol?: string; port?: string }
    | undefined;
  if (!cfg?.host || !cfg?.api_key) {
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

export function getTypesenseClient(): InstanceType<typeof Typesense.Client> | null {
  const c = getTypesenseConfig();
  if (!c) return null;
  return new Typesense.Client({
    nodes: [{ host: c.host, port: c.port, protocol: c.protocol as 'http' | 'https' }],
    apiKey: c.apiKey,
    connectionTimeoutSeconds: 15,
  });
}

async function ensureCollection(client: InstanceType<typeof Typesense.Client>): Promise<void> {
  try {
    await client.collections(TYPESENSE_COLLECTION).retrieve();
  } catch {
    await client.collections().create({
      name: TYPESENSE_COLLECTION,
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

function firestoreDataToTypesenseDoc(
  medicineId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Record<string, unknown> | null {
  if (!data || data.deleted === true) return null;
  const basePrice = data.price ?? data.mrp ?? 0;
  const price =
    typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice)) || 0;
  return {
    id: medicineId,
    name: String(data.name || ''),
    code: data.code != null ? String(data.code) : '',
    manufacturer: String(data.manufacturer || data.company || ''),
    category: String(data.category || ''),
    price,
  };
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

async function isAdmin(uid: string): Promise<boolean> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  return Boolean(userDoc.exists && userDoc.data()?.role === 'admin');
}

/** Parse minimal Medicine card fields (aligned with mobile parseMedicineDocLite). */
function parseMedicineLiteFromSnap(
  snap: FirebaseFirestore.DocumentSnapshot
): Record<string, unknown> | null {
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
  const rawBatches = Array.isArray(data.stockBatches) ? data.stockBatches : [];
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
      const m = parseMedicineLiteFromSnap(s);
      if (m) map.set(s.id, m);
    }
  }
  for (const id of ids) {
    const row = map.get(id);
    if (row) out.push(row);
  }
  return out;
}

/** Map Typesense hit documents only (no Firestore) — fast path for autocomplete UIs. */
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
      typeof rawPrice === 'number'
        ? rawPrice
        : parseFloat(String(rawPrice ?? 0)) || 0;
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
 * Authenticated catalog search (Typesense + optional Firestore hydrate).
 * minInstances keeps one instance warm to reduce cold-start latency (requires Blaze; billed while idle).
 */
export const searchMedicinesTypesense = functions
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
    return { medicines: [], source: 'typesense' as const };
  }

  const client = getTypesenseClient();
  if (!client) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Typesense is not configured on the server'
    );
  }

  try {
    await ensureCollection(client);
    const res = await client.collections(TYPESENSE_COLLECTION).documents().search({
      q: query,
      query_by: 'name,code,manufacturer',
      per_page: limit,
      // strict (admin): no prefix fan-out + 1 typo — cuts unrelated fuzzy matches vs loose retailer search
      prefix: !strict,
      num_typos: strict ? 1 : 2,
    });

    const hits = res.hits || [];
    if (!hydrate) {
      const medicines = medicinesFromTypesenseHitsOnly(hits);
      return { medicines, source: 'typesense_index' as const };
    }
    const ids = hits.map((h) => String((h.document as { id?: string })?.id || '')).filter(Boolean);
    const medicines = await fetchMedicinesOrderedByIds(ids);
    return { medicines, source: 'typesense' as const };
  } catch (err: any) {
    console.error('searchMedicinesTypesense error', err?.message || err);
    throw new functions.https.HttpsError(
      'internal',
      err?.message || 'Search failed'
    );
  }
});

/** One-time / maintenance: full reindex from Firestore (admin only). */
export const adminReindexMedicinesTypesense = functions
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
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Typesense is not configured. Set functions config typesense.host and typesense.api_key.'
      );
    }

    await ensureCollection(client);
    let batch: Record<string, unknown>[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await client.collections(TYPESENSE_COLLECTION).documents().import(batch, { action: 'upsert' });
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
      if (batch.length >= 100) await flush();
    }
    await flush();

    return { ok: true, indexed: count, totalDocs: snap.size };
  });

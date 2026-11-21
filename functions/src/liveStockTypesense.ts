/**
 * Vendor stock rows live only in Typesense. They are replaced whenever a vendor
 * sends a new file. Firestore keeps the small upload record (status, file, vendor).
 */
import * as admin from 'firebase-admin';
import { getTypesenseClient, getTypesenseSearchClient } from './typesenseMedicines';
import type { ExtractedStockRow } from './liveStockExtract';

export const LIVE_STOCK_COLLECTION = 'live_stock_offers';

type TypesenseClient = NonNullable<ReturnType<typeof getTypesenseClient>>;

const FIELDS = [
  { name: 'productName', type: 'string', sort: true },
  { name: 'manufacturer', type: 'string', optional: true },
  { name: 'pack', type: 'string', optional: true },
  { name: 'scheme', type: 'string', optional: true },
  { name: 'expiry', type: 'string', optional: true },
  { name: 'uploadId', type: 'string', facet: true },
  { name: 'vendorId', type: 'string', facet: true },
  { name: 'vendorName', type: 'string', optional: true },
  { name: 'stockQty', type: 'int32', sort: true },
  { name: 'rate', type: 'float', optional: true },
  { name: 'mrp', type: 'float', optional: true },
  { name: 'effectiveRate', type: 'float', optional: true },
  { name: 'discountPercentage', type: 'float', optional: true },
  { name: 'schemePaidQty', type: 'int32', optional: true },
  { name: 'schemeFreeQty', type: 'int32', optional: true },
  { name: 'uploadedAtMs', type: 'int64', facet: true },
];

let collectionReady = false;

function filterValue(value: string): string {
  return `\`${value.replace(/[`\\]/g, '')}\``;
}

export function requireLiveStockClient(): TypesenseClient {
  const client = getTypesenseClient();
  if (!client) throw new Error('Typesense is not configured');
  return client;
}

export async function ensureLiveStockCollection(client: TypesenseClient): Promise<void> {
  if (collectionReady) return;
  try {
    await client.collections(LIVE_STOCK_COLLECTION).retrieve();
  } catch (error: unknown) {
    const status = (error as { httpStatus?: number })?.httpStatus;
    if (status !== 404) throw error;
    await client.collections().create({
      name: LIVE_STOCK_COLLECTION,
      fields: FIELDS as never,
    });
  }
  collectionReady = true;
}

function numOrOmit(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return value;
}

export function liveStockDocument(
  id: string,
  row: ExtractedStockRow,
  upload: { uploadId: string; vendorId: string; vendorName: string; uploadedAtMs: number }
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id,
    uploadId: upload.uploadId,
    vendorId: upload.vendorId,
    vendorName: upload.vendorName,
    productName: row.productName,
    stockQty: Math.round(Number(row.stockQty) || 0),
    uploadedAtMs: Math.round(upload.uploadedAtMs),
  };
  if (row.pack) doc.pack = row.pack;
  if (row.manufacturer) doc.manufacturer = row.manufacturer;
  if (row.scheme) doc.scheme = row.scheme;
  if (row.expiry) doc.expiry = row.expiry;
  const rate = numOrOmit(row.rate);
  const mrp = numOrOmit(row.mrp);
  const effectiveRate = numOrOmit(row.effectiveRate);
  const discountPercentage = numOrOmit(row.discountPercentage);
  if (rate != null) doc.rate = rate;
  if (mrp != null) doc.mrp = mrp;
  if (effectiveRate != null) doc.effectiveRate = effectiveRate;
  if (discountPercentage != null) doc.discountPercentage = discountPercentage;
  if (row.schemePaidQty != null && Number.isFinite(row.schemePaidQty)) {
    doc.schemePaidQty = Math.round(row.schemePaidQty);
  }
  if (row.schemeFreeQty != null && Number.isFinite(row.schemeFreeQty)) {
    doc.schemeFreeQty = Math.round(row.schemeFreeQty);
  }
  return doc;
}

export async function importLiveStockDocuments(docs: Array<Record<string, unknown>>): Promise<void> {
  if (!docs.length) return;
  const client = requireLiveStockClient();
  await ensureLiveStockCollection(client);
  const jsonl = docs.map((doc) => JSON.stringify(doc)).join('\n');
  const raw = await client.collections(LIVE_STOCK_COLLECTION).documents().import(jsonl, { action: 'upsert' });
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const failed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/"success"\s*:\s*true/.test(line));
  if (failed.length) {
    throw new Error(`Typesense rejected ${failed.length} stock rows: ${failed[0].slice(0, 240)}`);
  }
}

export async function deleteLiveStockWhere(filter: string): Promise<number> {
  const client = requireLiveStockClient();
  await ensureLiveStockCollection(client);
  const result = await client.collections(LIVE_STOCK_COLLECTION).documents().delete({ filter_by: filter });
  return Number((result as { num_deleted?: number }).num_deleted || 0);
}

export async function deleteLiveStockForUpload(uploadId: string): Promise<number> {
  if (!uploadId) return 0;
  return deleteLiveStockWhere(`uploadId:=${filterValue(uploadId)}`);
}

/** Drop this vendor's older file. The rows just imported share uploadedAtMs. */
export async function deleteOlderVendorStock(vendorId: string, uploadedAtMs: number): Promise<number> {
  if (!vendorId || !uploadedAtMs) return 0;
  return deleteLiveStockWhere(`vendorId:=${filterValue(vendorId)} && uploadedAtMs:<${Math.round(uploadedAtMs)}`);
}

/**
 * Remove one file, and any older file for that vendor, so an earlier list
 * does not become the current stock. A newer file for the vendor stays.
 */
export async function deleteLiveStockFile(vendorId: string, uploadId: string, uploadedAtMs: number): Promise<number> {
  if (vendorId && uploadedAtMs > 0) {
    return deleteLiveStockWhere(
      `uploadId:=${filterValue(uploadId)} || (vendorId:=${filterValue(vendorId)} && uploadedAtMs:<=${Math.round(uploadedAtMs)})`
    );
  }
  return deleteLiveStockForUpload(uploadId);
}

export type LiveStockHit = {
  id: string;
  uploadId: string;
  vendorId: string;
  vendorName: string;
  productName: string;
  manufacturer: string;
  pack: string;
  stockQty: number;
  rate: number | null;
  mrp: number | null;
  effectiveRate: number | null;
  discountPercentage: number | null;
  scheme: string;
  uploadedAtMs: number;
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function mapLiveStockHit(raw: Record<string, unknown>): LiveStockHit | null {
  const productName = String(raw.productName || '').trim();
  const vendorId = String(raw.vendorId || '').trim();
  const uploadId = String(raw.uploadId || '').trim();
  if (!productName || !vendorId || !uploadId) return null;
  return {
    id: String(raw.id || ''),
    uploadId,
    vendorId,
    vendorName: String(raw.vendorName || ''),
    productName,
    manufacturer: String(raw.manufacturer || ''),
    pack: String(raw.pack || ''),
    stockQty: asNumber(raw.stockQty) ?? 0,
    rate: asNumber(raw.rate),
    mrp: asNumber(raw.mrp),
    effectiveRate: asNumber(raw.effectiveRate),
    discountPercentage: asNumber(raw.discountPercentage),
    scheme: String(raw.scheme || ''),
    uploadedAtMs: asNumber(raw.uploadedAtMs) ?? 0,
  };
}

/** Every current stock row. Used by the purchase list, which ranks names in memory. */
export async function exportLiveStockHits(): Promise<LiveStockHit[]> {
  const client = getTypesenseClient();
  if (!client) return [];
  await ensureLiveStockCollection(client);
  const raw = await client.collections(LIVE_STOCK_COLLECTION).documents().export({});
  const text = typeof raw === 'string' ? raw : '';
  const rows: LiveStockHit[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const hit = mapLiveStockHit(JSON.parse(line) as Record<string, unknown>);
      if (hit) rows.push(hit);
    } catch {
      // Skip a damaged line rather than failing the whole purchase list.
    }
  }
  return rows;
}

export async function searchLiveStockHits(args: {
  uploadId: string;
  q: string;
  page: number;
  perPage: number;
}): Promise<{ offers: LiveStockHit[]; found: number }> {
  const client = getTypesenseSearchClient() || getTypesenseClient();
  if (!client) throw new Error('Typesense is not configured');
  await ensureLiveStockCollection(client);
  const q = args.q.trim();
  const browsing = q.length < 2;
  const result = await client.collections(LIVE_STOCK_COLLECTION).documents().search({
    q: browsing ? '*' : q,
    query_by: 'productName,manufacturer,pack',
    filter_by: `uploadId:=${filterValue(args.uploadId)}`,
    per_page: args.perPage,
    page: args.page,
    sort_by: browsing ? 'productName:asc' : '_text_match:desc,productName:asc',
    prefix: true,
    num_typos: browsing ? 0 : 1,
  });
  const hits = (result.hits || [])
    .map((hit) => mapLiveStockHit((hit.document || {}) as Record<string, unknown>))
    .filter((row): row is LiveStockHit => Boolean(row));
  return { offers: hits, found: Number(result.found || hits.length) };
}

/**
 * Copy existing Firestore stock rows into Typesense, then delete each page
 * after it has been imported. A retry upserts the same ids.
 */
export async function migrateFirestoreLiveStock(
  db: admin.firestore.Firestore
): Promise<{ imported: number; deleted: number }> {
  let imported = 0;
  let deleted = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const pageSize = 400;
  for (;;) {
    let q: FirebaseFirestore.Query = db
      .collection('liveStockOffers')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    const docs: Array<Record<string, unknown>> = [];
    for (const item of snap.docs) {
      const data = item.data();
      const productName = String(data.productName || '').trim();
      const vendorId = String(data.vendorId || '').trim();
      const uploadId = String(data.uploadId || '').trim();
      if (!productName || !vendorId || !uploadId) continue;
      const asOpt = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      docs.push(
        liveStockDocument(
          item.id,
          {
            productName,
            pack: data.pack ? String(data.pack) : undefined,
            manufacturer: data.manufacturer ? String(data.manufacturer) : undefined,
            stockQty: Number(data.stockQty) || 0,
            rate: asOpt(data.rate),
            mrp: asOpt(data.mrp),
            scheme: data.scheme ? String(data.scheme) : undefined,
            schemePaidQty: asOpt(data.schemePaidQty),
            schemeFreeQty: asOpt(data.schemeFreeQty),
            discountPercentage: asOpt(data.discountPercentage),
            expiry: data.expiry ? String(data.expiry) : undefined,
            effectiveRate: asOpt(data.effectiveRate),
          },
          {
            uploadId,
            vendorId,
            vendorName: String(data.vendorName || ''),
            uploadedAtMs: Number(data.uploadedAtMs) || 0,
          }
        )
      );
    }
    await importLiveStockDocuments(docs);
    imported += docs.length;
    const batch = db.batch();
    snap.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { imported, deleted };
}

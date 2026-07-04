/**
 * Typesense search index for `orders` (Firestore source of truth).
 *
 * Mirrors the `medicines` integration (see `typesenseMedicines.ts`) so the admin
 * Orders page can search / filter / sort / paginate server-side instead of
 * downloading the entire `orders` collection into the browser. Reuses the shared
 * Typesense client + config from `typesenseMedicines.ts`.
 *
 * After deploy, run the callable `adminReindexOrdersTypesense` once to backfill
 * existing orders (the onWrite trigger keeps it in sync afterwards).
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getTypesenseClient } from './typesenseMedicines';

type TypesenseClient = import('typesense').Client;

export const TYPESENSE_ORDERS_COLLECTION = 'orders';

const ORDER_STATUSES = [
  'Pending',
  'Order Fulfillment',
  'In Transit',
  'Delivered',
  'Cancelled',
] as const;

/** Fields the client is allowed to sort by, mapped to indexed Typesense fields. */
const SORTABLE_FIELDS = new Set([
  'docId',
  'orderDate',
  'retailerEmail',
  'itemCount',
  'amountSortable',
  'status',
  'invoiceNumber',
  'paymentStatus',
]);

const ORDERS_COLLECTION_FIELDS = [
  // `docId` mirrors the Firestore document id as a sortable string.
  { name: 'docId', type: 'string' as const, sort: true },
  { name: 'retailerId', type: 'string' as const, optional: true, facet: true },
  { name: 'salesOfficerId', type: 'string' as const, optional: true, facet: true },
  { name: 'retailerEmail', type: 'string' as const, optional: true, sort: true },
  { name: 'retailerName', type: 'string' as const, optional: true },
  { name: 'medicineNames', type: 'string' as const, optional: true },
  { name: 'invoiceNumber', type: 'string' as const, optional: true, sort: true },
  { name: 'search_blob', type: 'string' as const, optional: true },
  { name: 'status', type: 'string' as const, facet: true, sort: true },
  { name: 'paymentStatus', type: 'string' as const, facet: true, optional: true, sort: true },
  { name: 'orderDate', type: 'int64' as const, sort: true },
  { name: 'itemCount', type: 'int32' as const, sort: true },
  // Derived so sorting matches the UI (Pending rows sort as 0).
  { name: 'amountSortable', type: 'float' as const, sort: true },
  { name: 'totalAmount', type: 'float' as const, optional: true },
];

async function ensureOrdersCollection(client: TypesenseClient): Promise<void> {
  try {
    const existing = await client.collections(TYPESENSE_ORDERS_COLLECTION).retrieve();
    // Self-heal: add any schema fields introduced after the collection was first
    // created (e.g. paymentStatus, invoiceNumber). Added fields must be optional.
    const existingNames = new Set((existing.fields || []).map((f: { name: string }) => f.name));
    const missing = ORDERS_COLLECTION_FIELDS.filter(
      (f) => !existingNames.has(f.name) && (f as { optional?: boolean }).optional
    );
    if (missing.length > 0) {
      try {
        await client
          .collections(TYPESENSE_ORDERS_COLLECTION)
          .update({ fields: missing } as never);
      } catch (updateErr) {
        // Ignore races where a concurrent call already added the field.
        console.warn('orders schema field add skipped', updateErr);
      }
    }
  } catch (e: unknown) {
    const http = (e as { httpStatus?: number })?.httpStatus;
    if (http !== 404) throw e;
    await client.collections().create({
      name: TYPESENSE_ORDERS_COLLECTION,
      fields: ORDERS_COLLECTION_FIELDS,
    });
  }
}

function toMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  const t = new Date(value as string | number | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

function buildOrderSearchBlob(
  orderId: string,
  data: FirebaseFirestore.DocumentData,
  medicineNames: string
): string {
  const parts = [orderId, data.retailerEmail, data.retailerName, data.invoiceNumber, medicineNames]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function firestoreDataToOrderDoc(
  orderId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Record<string, unknown> | null {
  if (!data) return null;
  const medicines = Array.isArray(data.medicines) ? data.medicines : [];
  const medicineNames = medicines
    .map((m: { name?: unknown }) => String(m?.name ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const status = String(data.status || '');
  const totalAmount =
    typeof data.totalAmount === 'number'
      ? data.totalAmount
      : parseFloat(String(data.totalAmount ?? 0)) || 0;

  return {
    id: orderId,
    docId: orderId,
    retailerId: String(data.retailerId || ''),
    salesOfficerId: String(data.salesOfficerId || ''),
    retailerEmail: String(data.retailerEmail || ''),
    retailerName: String(data.retailerName || ''),
    medicineNames,
    invoiceNumber: String(data.invoiceNumber || ''),
    search_blob: buildOrderSearchBlob(orderId, data, medicineNames),
    status,
    paymentStatus: String(data.paymentStatus || 'Unpaid'),
    orderDate: toMillis(data.orderDate),
    itemCount: medicines.length,
    amountSortable: status === 'Pending' ? 0 : totalAmount,
    totalAmount,
  };
}

export async function upsertOrderInTypesense(
  orderId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Promise<void> {
  const client = getTypesenseClient();
  if (!client) {
    console.warn('Typesense: not configured, skip order upsert');
    return;
  }
  const doc = firestoreDataToOrderDoc(orderId, data);
  if (!doc) {
    await deleteOrderFromTypesense(orderId).catch(() => undefined);
    return;
  }
  await ensureOrdersCollection(client);
  await client.collections(TYPESENSE_ORDERS_COLLECTION).documents().upsert(doc);
}

export async function deleteOrderFromTypesense(orderId: string): Promise<void> {
  const client = getTypesenseClient();
  if (!client) return;
  try {
    await client.collections(TYPESENSE_ORDERS_COLLECTION).documents(orderId).delete();
  } catch (e: any) {
    if (e?.httpStatus === 404) return;
    throw e;
  }
}

/** Firestore sync: index on create/update, remove on delete. Errors are swallowed so a Typesense outage never blocks order writes. */
export const onOrderWriteTypesense = functions.firestore
  .document('orders/{orderId}')
  .onWrite(async (change, context) => {
    const orderId = context.params.orderId as string;
    try {
      if (!change.after.exists) {
        await deleteOrderFromTypesense(orderId);
        return;
      }
      await upsertOrderInTypesense(orderId, change.after.data());
    } catch (err) {
      console.error('onOrderWriteTypesense failed', orderId, err);
    }
  });

function orderRowFromHit(document: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(document.id ?? document.docId ?? ''),
    retailerEmail: document.retailerEmail != null ? String(document.retailerEmail) : '',
    retailerName: document.retailerName != null ? String(document.retailerName) : '',
    invoiceNumber: document.invoiceNumber != null ? String(document.invoiceNumber) : '',
    status: String(document.status ?? ''),
    paymentStatus: document.paymentStatus != null ? String(document.paymentStatus) : '',
    orderDate: typeof document.orderDate === 'number' ? document.orderDate : 0,
    itemCount: typeof document.itemCount === 'number' ? document.itemCount : 0,
    totalAmount: typeof document.totalAmount === 'number' ? document.totalAmount : 0,
  };
}

async function getStatusCounts(
  client: TypesenseClient,
  scopeFilter?: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const s of ORDER_STATUSES) counts[s] = 0;
  try {
    const searchParams: Record<string, unknown> = {
      q: '*',
      query_by: 'search_blob',
      per_page: 0,
      facet_by: 'status',
    };
    if (scopeFilter) searchParams.filter_by = scopeFilter;
    const res = await client.collections(TYPESENSE_ORDERS_COLLECTION).documents().search(searchParams);
    const facet = (res.facet_counts || []).find((f: { field_name?: string }) => f.field_name === 'status');
    for (const c of facet?.counts || []) {
      counts[String(c.value)] = Number(c.count) || 0;
    }
  } catch (e) {
    console.warn('getStatusCounts failed', e);
  }
  return counts;
}

type OrderSearchScope =
  | { kind: 'all' }
  | { kind: 'retailer'; retailerId: string }
  | { kind: 'salesOfficer'; salesOfficerId: string };

async function resolveOrderSearchScope(uid: string): Promise<OrderSearchScope | null> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  if (!userDoc.exists) return null;
  const role = String(userDoc.data()?.role || '');
  if (role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations') {
    return { kind: 'all' };
  }
  if (role === 'retailer') {
    return { kind: 'retailer', retailerId: uid };
  }
  if (role === 'salesOfficer' || role === 'SalesOfficer') {
    return { kind: 'salesOfficer', salesOfficerId: uid };
  }
  return null;
}

function scopeFilterForSearch(scope: OrderSearchScope): string | undefined {
  if (scope.kind === 'retailer') {
    return `retailerId:=\`${scope.retailerId}\``;
  }
  if (scope.kind === 'salesOfficer') {
    return `salesOfficerId:=\`${scope.salesOfficerId}\``;
  }
  return undefined;
}

/**
 * Authenticated server-side order search. Returns one page of results already
 * filtered, sorted and paginated, plus global per-status counts for the KPI
 * cards — so the client never downloads the whole `orders` collection.
 */
export const searchOrdersTypesense = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const client = getTypesenseClient();
  if (!client) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Typesense is not configured on the server'
    );
  }

  const rawQuery = String(data?.query || '').trim();
  const q = rawQuery.length > 0 ? rawQuery : '*';
  const status = String(data?.status || '').trim();
  const paymentStatus = String(data?.paymentStatus || '').trim();
  const invoicedOnly = data?.invoicedOnly === true;
  const paymentDueOnly = data?.paymentDueOnly === true;
  const page = Math.max(1, Number(data?.page) || 1);
  const perPage = Math.min(Math.max(Number(data?.perPage) || 10, 1), 100);
  const sortFieldRaw = String(data?.sortField || 'orderDate');
  const sortField = SORTABLE_FIELDS.has(sortFieldRaw) ? sortFieldRaw : 'orderDate';
  const sortOrder = String(data?.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  try {
    await ensureOrdersCollection(client);

    const scope = await resolveOrderSearchScope(context.auth.uid);
    if (!scope) {
      throw new functions.https.HttpsError('permission-denied', 'Order search not allowed for this account');
    }
    const scopeFilter = scopeFilterForSearch(scope);

    // Combine optional filters: order status, "invoiced only" (excludes Pending
    // and Cancelled), and payment status. Used by the Orders and Invoices pages.
    const filters: string[] = [];
    if (scopeFilter) filters.push(scopeFilter);
    if (status && status !== 'All') filters.push(`status:=\`${status}\``);
    if (invoicedOnly) filters.push('status:!=[`Pending`, `Cancelled`]');
    if (paymentDueOnly) {
      filters.push('paymentStatus:=[`Unpaid`, `Partial`]');
    } else if (paymentStatus && paymentStatus !== 'All') {
      filters.push(`paymentStatus:=\`${paymentStatus}\``);
    }
    const filterBy = filters.length > 0 ? filters.join(' && ') : undefined;

    const searchParams: Record<string, unknown> = {
      q,
      query_by: 'search_blob,retailerEmail,retailerName,medicineNames,invoiceNumber',
      sort_by: `${sortField}:${sortOrder}`,
      per_page: perPage,
      page,
      prefix: true,
      num_typos: 1,
    };
    if (filterBy) searchParams.filter_by = filterBy;

    const res = await client
      .collections(TYPESENSE_ORDERS_COLLECTION)
      .documents()
      .search(searchParams);

    const hits = (res.hits || []).map((h: { document?: unknown }) =>
      orderRowFromHit((h.document && typeof h.document === 'object' ? h.document : {}) as Record<string, unknown>)
    );

    const statusCounts = await getStatusCounts(client, scopeFilter);

    return {
      orders: hits,
      found: Number(res.found) || 0,
      page,
      perPage,
      statusCounts,
      source: 'typesense' as const,
    };
  } catch (err: any) {
    console.error('searchOrdersTypesense error', err?.message || err);
    throw new functions.https.HttpsError('internal', err?.message || 'Order search failed');
  }
});

async function canReindexOrders(uid: string): Promise<boolean> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  const role = userDoc.exists ? userDoc.data()?.role : undefined;
  return role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations';
}

/** One-time / maintenance: full reindex of `orders` from Firestore (admin only). */
export const adminReindexOrdersTypesense = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    if (!(await canReindexOrders(context.auth.uid))) {
      throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }

    const client = getTypesenseClient();
    if (!client) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Typesense is not configured. See functions/TYPESENSE_CONFIG.md.'
      );
    }

    try {
      await ensureOrdersCollection(client);
      let batch: Record<string, unknown>[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        await client
          .collections(TYPESENSE_ORDERS_COLLECTION)
          .documents()
          .import(batch, { action: 'upsert' });
        batch = [];
      };

      const snap = await admin.firestore().collection('orders').get();
      let count = 0;
      for (const doc of snap.docs) {
        const d = firestoreDataToOrderDoc(doc.id, doc.data());
        if (d) {
          batch.push(d);
          count++;
        }
        if (batch.length >= 100) await flush();
      }
      await flush();

      return { ok: true, indexed: count, totalDocs: snap.size };
    } catch (err: unknown) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error('adminReindexOrdersTypesense failed', err);
      const message =
        err && typeof err === 'object' && typeof (err as { message?: string }).message === 'string'
          ? (err as { message: string }).message.trim()
          : String(err || 'unknown error').trim();
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Typesense unreachable or rejected the request (${message}). Verify functions:config typesense.* and server reachability, then redeploy.`
      );
    }
  });

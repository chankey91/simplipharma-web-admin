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
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getTypesenseClient } from './typesenseMedicines';

type TypesenseClient = import('typesense').Client;

export interface TypesenseSyncConfig {
  /** Firestore collection name (also used as the Typesense collection name). */
  collectionName: string;
  /** Typesense collection schema fields. */
  fields: Array<Record<string, unknown>>;
  /** Comma-separated `query_by` field list for full-text search. */
  queryBy: string;
  /** Field names the client is allowed to sort by. */
  sortableFields: string[];
  /** Default sort field when none/invalid is supplied. */
  defaultSort: string;
  /** Optional facet field used for the status filter + global counts. */
  facetField?: string;
  /** Build a Typesense document from a Firestore doc, or null to skip/delete. */
  buildDoc: (
    id: string,
    data: FirebaseFirestore.DocumentData | undefined
  ) => Record<string, unknown> | null;
}

/** Convert a Firestore Timestamp / date-ish value to epoch milliseconds. */
export function tsMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  const t = new Date(value as string | number | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function lower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

async function canReindex(uid: string): Promise<boolean> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  const role = userDoc.exists ? userDoc.data()?.role : undefined;
  return role === 'admin' || role === 'Admin' || role === 'operations' || role === 'Operations';
}

export interface TypesenseSyncFunctions {
  onWrite: functions.CloudFunction<functions.Change<functions.firestore.DocumentSnapshot>>;
  search: functions.HttpsFunction & functions.Runnable<unknown>;
  reindex: functions.HttpsFunction & functions.Runnable<unknown>;
}

export function createTypesenseSync(config: TypesenseSyncConfig): TypesenseSyncFunctions {
  const sortable = new Set(config.sortableFields);

  const ensureCollection = async (client: TypesenseClient): Promise<void> => {
    try {
      await client.collections(config.collectionName).retrieve();
    } catch (e: unknown) {
      const http = (e as { httpStatus?: number })?.httpStatus;
      if (http !== 404) throw e;
      await client.collections().create({
        name: config.collectionName,
        fields: config.fields as never,
      });
    }
  };

  const upsert = async (
    id: string,
    data: FirebaseFirestore.DocumentData | undefined
  ): Promise<void> => {
    const client = getTypesenseClient();
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

  const remove = async (id: string): Promise<void> => {
    const client = getTypesenseClient();
    if (!client) return;
    try {
      await client.collections(config.collectionName).documents(id).delete();
    } catch (e: any) {
      if (e?.httpStatus === 404) return;
      throw e;
    }
  };

  const onWrite = functions.firestore
    .document(`${config.collectionName}/{docId}`)
    .onWrite(async (change, context) => {
      const docId = context.params.docId as string;
      try {
        if (!change.after.exists) {
          await remove(docId);
          return;
        }
        await upsert(docId, change.after.data());
      } catch (err) {
        console.error(`onWrite sync failed for ${config.collectionName}/${docId}`, err);
      }
    });

  const getGlobalCounts = async (
    client: TypesenseClient
  ): Promise<{ totalAll: number; facetCounts: Record<string, number> }> => {
    const facetCounts: Record<string, number> = {};
    try {
      const res = await client
        .collections(config.collectionName)
        .documents()
        .search({
          q: '*',
          query_by: config.queryBy.split(',')[0],
          per_page: 0,
          ...(config.facetField ? { facet_by: config.facetField } : {}),
        });
      const totalAll = Number(res.found) || 0;
      if (config.facetField) {
        const facet = (res.facet_counts || []).find(
          (f: { field_name?: string }) => f.field_name === config.facetField
        );
        for (const c of facet?.counts || []) {
          facetCounts[String(c.value)] = Number(c.count) || 0;
        }
      }
      return { totalAll, facetCounts };
    } catch (e) {
      console.warn(`getGlobalCounts failed for ${config.collectionName}`, e);
      return { totalAll: 0, facetCounts };
    }
  };

  const search = functions.https.onCall(async (data, context) => {
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
    const filter = String(data?.filter || '').trim();
    const page = Math.max(1, Number(data?.page) || 1);
    const perPage = Math.min(Math.max(Number(data?.perPage) || 10, 1), 100);
    const sortFieldRaw = String(data?.sortField || config.defaultSort);
    const sortField = sortable.has(sortFieldRaw) ? sortFieldRaw : config.defaultSort;
    const sortOrder = String(data?.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    try {
      await ensureCollection(client);

      const searchParams: Record<string, unknown> = {
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

      const rows = (res.hits || []).map((h: { document?: unknown }) =>
        h.document && typeof h.document === 'object' ? (h.document as Record<string, unknown>) : {}
      );

      const { totalAll, facetCounts } = await getGlobalCounts(client);

      return {
        rows,
        found: Number(res.found) || 0,
        page,
        perPage,
        facetCounts,
        totalAll,
        source: 'typesense' as const,
      };
    } catch (err: any) {
      console.error(`search failed for ${config.collectionName}`, err?.message || err);
      throw new functions.https.HttpsError('internal', err?.message || 'Search failed');
    }
  });

  const reindex = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (_data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
      }
      if (!(await canReindex(context.auth.uid))) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Admin or operations access required'
        );
      }
      const client = getTypesenseClient();
      if (!client) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Typesense is not configured. See functions/TYPESENSE_CONFIG.md.'
        );
      }

      try {
        await ensureCollection(client);
        let batch: Record<string, unknown>[] = [];
        const flush = async () => {
          if (batch.length === 0) return;
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
          if (batch.length >= 100) await flush();
        }
        await flush();

        return { ok: true, indexed: count, totalDocs: snap.size };
      } catch (err: unknown) {
        if (err instanceof functions.https.HttpsError) throw err;
        console.error(`reindex failed for ${config.collectionName}`, err);
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

  return { onWrite, search, reindex };
}

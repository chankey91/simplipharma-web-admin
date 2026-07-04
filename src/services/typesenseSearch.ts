import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface TypesenseSearchParams {
  query?: string;
  /** Value for the collection's facet field (e.g. paymentStatus). 'All' clears it. */
  filter?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface TypesenseSearchResult<T> {
  rows: T[];
  /** Total matching the current query + filter (for pagination). */
  found: number;
  page: number;
  perPage: number;
  /** Global per-facet-value counts (ignores search/filter). */
  facetCounts: Record<string, number>;
  /** Total documents in the collection (ignores search/filter). */
  totalAll: number;
  source: 'typesense';
}

/**
 * Build a typed client wrapper around a generic Typesense search callable
 * created by `functions/src/typesenseSync.ts`. `map` converts a raw index
 * document into the row shape the page renders.
 */
export function makeTypesenseSearch<T>(
  callableName: string,
  map: (raw: Record<string, unknown>) => T
) {
  const callable = httpsCallable(functions, callableName, { timeout: 60000 });
  return async (params: TypesenseSearchParams): Promise<TypesenseSearchResult<T>> => {
    const res = await callable({
      query: params.query ?? '',
      filter: params.filter ?? 'All',
      sortField: params.sortField ?? '',
      sortOrder: params.sortOrder ?? 'desc',
      page: params.page ?? 1,
      perPage: params.perPage ?? 10,
    });
    const data = (res.data ?? {}) as Partial<TypesenseSearchResult<Record<string, unknown>>>;
    const rawRows = Array.isArray(data.rows) ? data.rows : [];
    return {
      rows: rawRows.map((r) => map(r as Record<string, unknown>)),
      found: typeof data.found === 'number' ? data.found : 0,
      page: typeof data.page === 'number' ? data.page : params.page ?? 1,
      perPage: typeof data.perPage === 'number' ? data.perPage : params.perPage ?? 10,
      facetCounts: (data.facetCounts as Record<string, number>) ?? {},
      totalAll: typeof data.totalAll === 'number' ? data.totalAll : 0,
      source: 'typesense',
    };
  };
}

/** Wrap an admin reindex callable. */
export function makeReindexCallable(callableName: string) {
  const callable = httpsCallable(functions, callableName, { timeout: 540000 });
  return async (): Promise<{ ok: boolean; indexed: number; totalDocs: number }> => {
    const res = await callable({});
    return res.data as { ok: boolean; indexed: number; totalDocs: number };
  };
}

const asString = (v: unknown): string => (v == null ? '' : String(v));
const asNumber = (v: unknown): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0;

export const rawStr = asString;
export const rawNum = asNumber;

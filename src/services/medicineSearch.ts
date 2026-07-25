import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { getMedicineById } from './inventory';
import { Medicine } from '../types';

const searchMedicinesCallable = httpsCallable(functions, 'searchMedicinesTypesense', {
  timeout: 120000,
});

function mapLiteToMedicine(raw: Record<string, unknown>): Medicine {
  const price =
    typeof raw.price === 'number' ? raw.price : parseFloat(String(raw.price ?? 0)) || 0;
  const stock =
    typeof raw.stock === 'number' ? raw.stock : parseInt(String(raw.stock ?? '0'), 10) || 0;
  const nearestRaw = raw.nearestExpiry;
  let nearestExpiry: Date | undefined;
  if (typeof nearestRaw === 'number' && nearestRaw > 0) nearestExpiry = new Date(nearestRaw);
  else if (nearestRaw != null) {
    const t = new Date(nearestRaw as string | number | Date).getTime();
    if (Number.isFinite(t) && t > 0) nearestExpiry = new Date(t);
  }
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    category: String(raw.category ?? ''),
    code: raw.code != null ? String(raw.code) : undefined,
    unit: raw.unit != null ? String(raw.unit) : undefined,
    manufacturer: String(raw.manufacturer ?? ''),
    stock,
    currentStock:
      typeof raw.currentStock === 'number'
        ? raw.currentStock
        : raw.currentStock != null && !isNaN(parseInt(String(raw.currentStock), 10))
          ? parseInt(String(raw.currentStock), 10)
          : stock,
    nearestExpiry,
    price,
    mrp:
      raw.mrp != null && !isNaN(Number(raw.mrp))
        ? Number(raw.mrp)
        : undefined,
    gstRate: typeof raw.gstRate === 'number' ? raw.gstRate : undefined,
    company: raw.company != null ? String(raw.company) : undefined,
    description: raw.description != null ? String(raw.description) : undefined,
    imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : undefined,
  };
}

export type SearchMedicinesOptions = {
  /** false = Typesense hits only (no Firestore reads) — required for autocomplete at scale. Default true. */
  hydrate?: boolean;
  /** Max results (1–120). Default 40. */
  limit?: number;
  /** Page number (1-based). Used for Inventory browse/search pagination. */
  page?: number;
  /**
   * Tighter Typesense field set + ranking. Admin pickers pass **true**.
   */
  strict?: boolean;
  matchTokenCount?: number;
  queryMode?: 'strict' | 'natural';
  /** When true (and query &lt; 2 chars), browse catalog via q:"*" — do not download Firestore masters. */
  browse?: boolean;
  category?: string;
  manufacturer?: string;
  stockFilter?: 'All' | 'In Stock' | 'Low' | 'Out' | string;
  expiryFilter?: 'expired' | 'expiring' | '';
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  includeFacets?: boolean;
  /** When aborted, the promise rejects with AbortError and results must be ignored. */
  signal?: AbortSignal;
};

export type MedicineSearchResult = {
  medicines: Medicine[];
  found: number;
  page: number;
  facet_counts: Record<string, Array<{ value: string; count: number }>>;
  source: string;
};

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
        else resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (typeof e === 'object' && e != null && (e as { name?: string }).name === 'AbortError')
  );
}

/**
 * Tokenize query aligned with retailer app + Functions `matchTokenCount` / refinement.
 */
export function deriveSearchMatchTokens(trimmedRawQuery: string): string[] {
  const r = trimmedRawQuery.trim().toLowerCase();
  if (r.length === 0) return [];
  const parts = r.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.length ? [parts[0]] : [];
  const substantive = parts.filter((p) => p.length >= 2);
  if (substantive.length > 0) return substantive;
  return [parts.join(' ')];
}

function fieldHaystackLower(m: Medicine): { n: string; c: string; f: string } {
  return {
    n: (m.name || '').toLowerCase(),
    c: String(m.code ?? '').toLowerCase(),
    f: (m.manufacturer || '').toLowerCase(),
  };
}

/** AND across substantive tokens (multi-word); single-token substring semantics. */
export function medicineMatchesSearchInput(m: Medicine, inputValue: string): boolean {
  const tokens = deriveSearchMatchTokens(inputValue);
  if (tokens.length === 0) return true;
  const { n, c, f } = fieldHaystackLower(m);
  const hitsToken = (tok: string) => n.includes(tok) || c.includes(tok) || f.includes(tok);
  return tokens.every(hitsToken);
}

export function medicineMatchesSearchInputRelaxed(m: Medicine, inputValue: string): boolean {
  const tokens = deriveSearchMatchTokens(inputValue);
  if (tokens.length <= 1) return medicineMatchesSearchInput(m, inputValue);
  const { n, c, f } = fieldHaystackLower(m);
  const hitsToken = (tok: string) => n.includes(tok) || c.includes(tok) || f.includes(tok);
  return tokens.some(hitsToken);
}

export function rankMedicinesForAutocompleteQuery(medicines: Medicine[], query: string): Medicine[] {
  const ql = query.trim().toLowerCase();
  if (ql.length === 0) return [...medicines];
  const stems = deriveSearchMatchTokens(query);

  const tier = (m: Medicine): number => {
    const n = (m.name || '').toLowerCase();
    const c = String(m.code ?? '').toLowerCase();
    const f = (m.manufacturer || '').toLowerCase();

    if (stems.length > 1) {
      const allInName = stems.every((s) => n.includes(s));
      const first = stems[0];
      if (allInName && first) {
        if (n.startsWith(first)) return 0;
        return 1;
      }
      if (stems.some((s) => n.includes(s))) return 2;
      if (stems.some((s) => c.includes(s) || f.includes(s))) return 3;
      return 4;
    }

    if (stems.length === 1) {
      const needle = stems[0];
      if (n.startsWith(needle)) return 0;
      if (n.includes(needle)) return 1;
      if (c.includes(needle) || f.includes(needle)) return 2;
      return 3;
    }

    if (n.startsWith(ql)) return 0;
    if (n.includes(ql)) return 1;
    if (c.includes(ql) || f.includes(ql)) return 2;
    return 3;
  };

  return [...medicines].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}

/**
 * Light post-filter/rank on Typesense hits only.
 * @deprecated Prefer Typesense ranking; pickers/PDF import trust hit order.
 */
export function refineMedicineSearchResults(
  typesenseHits: Medicine[],
  query: string,
  _fallbackCatalog?: Medicine[]
): Medicine[] {
  const t = query.trim();
  if (t.length < 2) return [];
  return typesenseHits;
}

/** Full Typesense search result (pagination + facets). Prefer this for Inventory. */
export async function searchMedicinesCatalog(
  query: string,
  opts?: SearchMedicinesOptions
): Promise<MedicineSearchResult> {
  const q = query.trim().toLowerCase();
  const browse = opts?.browse === true;
  if (!browse && q.length < 2) {
    return { medicines: [], found: 0, page: 1, facet_counts: {}, source: 'typesense' };
  }
  const hydrate = opts?.hydrate ?? true;
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 120);
  const page = Math.min(Math.max(opts?.page ?? 1, 1), 500);
  const strict = opts?.strict === true;
  const tc = deriveSearchMatchTokens(q);
  const matchTokenCount = opts?.matchTokenCount ?? tc.length;
  const queryMode = opts?.queryMode ?? (strict ? 'strict' : 'natural');
  try {
    const res = await abortable(
      searchMedicinesCallable({
        query: q,
        limit,
        page,
        hydrate,
        strict,
        matchTokenCount,
        queryMode,
        browse,
        category: opts?.category,
        manufacturer: opts?.manufacturer,
        stockFilter: opts?.stockFilter,
        expiryFilter: opts?.expiryFilter,
        sortKey: opts?.sortKey,
        sortDirection: opts?.sortDirection,
        includeFacets: opts?.includeFacets === true,
      }),
      opts?.signal
    );
    const data = res.data as {
      medicines?: unknown[];
      found?: number;
      page?: number;
      facet_counts?: Record<string, Array<{ value: string; count: number }>>;
      source?: string;
    };
    const rows = Array.isArray(data.medicines) ? data.medicines : [];
    return {
      medicines: rows.map((r) => mapLiteToMedicine(r as Record<string, unknown>)),
      found: Number(data.found) || rows.length,
      page: Number(data.page) || page,
      facet_counts: data.facet_counts || {},
      source: data.source || 'typesense',
    };
  } catch (e) {
    if (isAbortError(e)) throw e;
    console.warn('searchMedicinesCatalog failed', e);
    return { medicines: [], found: 0, page: 1, facet_counts: {}, source: 'error' };
  }
}

/** Typesense autocomplete helper — returns medicine rows only (back-compat). */
export async function searchMedicinesTypesenseAdmin(
  query: string,
  opts?: SearchMedicinesOptions
): Promise<Medicine[]> {
  const result = await searchMedicinesCatalog(query, {
    ...opts,
    hydrate: opts?.hydrate ?? true,
    browse: false,
  });
  return result.medicines;
}

/** Exact name match via Typesense (case-insensitive). No full-catalog scan. */
export async function findMedicineByExactName(name: string): Promise<Medicine | null> {
  const q = name.trim();
  if (q.length < 2) return null;
  const key = q.toLowerCase();
  const hits = await searchMedicinesTypesenseAdmin(q, {
    hydrate: false,
    limit: 25,
    strict: true,
  });
  return hits.find((m) => (m.name || '').toLowerCase().trim() === key) ?? null;
}

/** After picking from index-only search, load full Firestore doc (incl. batches). */
export async function resolveMedicineAfterPickerSelection(
  picked: Medicine,
  masterList: Medicine[] | undefined
): Promise<Medicine> {
  const cached = masterList?.find((m) => m.id === picked.id);
  if (cached && Array.isArray(cached.stockBatches)) return cached;
  try {
    const full = await getMedicineById(picked.id);
    if (full) return full;
  } catch {
    // ignore
  }
  if (cached) return cached;
  return { ...picked, gstRate: picked.gstRate ?? 5, category: picked.category || '' };
}

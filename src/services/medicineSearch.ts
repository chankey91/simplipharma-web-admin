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
          : undefined,
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
  /** false = Typesense hits only (no Firestore reads) — much faster for autocomplete. Default true. */
  hydrate?: boolean;
  /** Max results (1–120). Smaller = slightly faster payloads. Default 40 for admin search helper. */
  limit?: number;
  /**
   * Tighter Typesense field set + ranking (fewer fuzzies). Retail app passes **false** for multi-word.
   */
  strict?: boolean;
  /** Mirrors retailer callable — inferred from whitespace split when omitted */
  matchTokenCount?: number;
  /** `'natural'` asks Cloud Function for broader token bridging (split_join_tokens). */
  queryMode?: 'strict' | 'natural';
};

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
 * Prefer rows matching query tokens after Typesense fuzzy hits; retries relaxed OR-match when Ts returns rows but refine would erase them all.
 */
export function refineMedicineSearchResults(
  typesenseHits: Medicine[],
  query: string,
  fallbackCatalog: Medicine[]
): Medicine[] {
  const t = query.trim();
  if (t.length < 2) return [];

  let fromTs = typesenseHits.filter((m) => medicineMatchesSearchInput(m, t));
  if (fromTs.length === 0 && typesenseHits.length > 0) {
    fromTs = typesenseHits.filter((m) => medicineMatchesSearchInputRelaxed(m, t));
  }
  if (fromTs.length > 0) return rankMedicinesForAutocompleteQuery(fromTs, t);

  return rankMedicinesForAutocompleteQuery(
    fallbackCatalog.filter((m) => medicineMatchesSearchInput(m, t)).slice(0, 80),
    t
  );
}

/** Typesense search — forwards `{ matchTokenCount, queryMode }` for parity with retailer mobile callable. */
export async function searchMedicinesTypesenseAdmin(
  query: string,
  opts?: SearchMedicinesOptions
): Promise<Medicine[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hydrate = opts?.hydrate ?? true;
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 120);
  const strict = opts?.strict === true;
  const tc = deriveSearchMatchTokens(q);
  const matchTokenCount = opts?.matchTokenCount ?? tc.length;
  const queryMode = opts?.queryMode ?? (strict ? 'strict' : 'natural');
  try {
    const res = await searchMedicinesCallable({
      query: q,
      limit,
      hydrate,
      strict,
      matchTokenCount,
      queryMode,
    });
    const data = res.data as { medicines?: unknown[] };
    const rows = data.medicines;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => mapLiteToMedicine(r as Record<string, unknown>));
  } catch (e) {
    console.warn('searchMedicinesTypesenseAdmin failed', e);
    return [];
  }
}

/** After picking from index-only search, load full Firestore doc (incl. batches) when cache is master-only. */
export async function resolveMedicineAfterPickerSelection(
  picked: Medicine,
  masterList: Medicine[] | undefined
): Promise<Medicine> {
  const cached = masterList?.find((m) => m.id === picked.id);
  // Master-only catalog has no stockBatches array — always hydrate for PI / fulfillment pickers.
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

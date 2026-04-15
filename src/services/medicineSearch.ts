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
   * Tighter Typesense ranking (no prefix fan-out, fewer typos). Use for admin pickers so unrelated
   * products don’t appear when typing an exact name/code.
   */
  strict?: boolean;
};

/**
 * Prefer rows whose name, code, or manufacturer contain the query (case-insensitive).
 * Falls back to the loaded Firestore catalog when Typesense returns noisy fuzzy matches.
 */
export function refineMedicineSearchResults(
  typesenseHits: Medicine[],
  query: string,
  fallbackCatalog: Medicine[]
): Medicine[] {
  const t = query.trim().toLowerCase();
  if (t.length < 2) return typesenseHits;

  const match = (m: Medicine) => {
    const n = (m.name || '').toLowerCase();
    const c = (m.code || '').toLowerCase();
    const f = (m.manufacturer || '').toLowerCase();
    return n.includes(t) || c.includes(t) || f.includes(t);
  };

  const fromTs = typesenseHits.filter(match);
  if (fromTs.length > 0) return fromTs;

  return fallbackCatalog.filter(match).slice(0, 80);
}

/** Typesense search; use `hydrate: false` for fast purchase/autocomplete pickers. */
export async function searchMedicinesTypesenseAdmin(
  query: string,
  opts?: SearchMedicinesOptions
): Promise<Medicine[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hydrate = opts?.hydrate ?? true;
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 120);
  const strict = opts?.strict === true;
  try {
    const res = await searchMedicinesCallable({ query: q, limit, hydrate, strict });
    const data = res.data as { medicines?: unknown[] };
    const rows = data.medicines;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => mapLiteToMedicine(r as Record<string, unknown>));
  } catch (e) {
    console.warn('searchMedicinesTypesenseAdmin failed', e);
    return [];
  }
}

/** After picking from index-only search, merge with master list or one Firestore read for GST, batches, etc. */
export async function resolveMedicineAfterPickerSelection(
  picked: Medicine,
  masterList: Medicine[] | undefined
): Promise<Medicine> {
  const cached = masterList?.find((m) => m.id === picked.id);
  if (cached) return cached;
  try {
    const full = await getMedicineById(picked.id);
    if (full) return full;
  } catch {
    // ignore
  }
  return { ...picked, gstRate: picked.gstRate ?? 5, category: picked.category || '' };
}

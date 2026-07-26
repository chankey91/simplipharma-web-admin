import { useEffect, useRef, useState } from 'react';
import {
  searchMedicinesCatalog,
  SearchMedicinesOptions,
  MedicineSearchResult,
  isAbortError,
} from '../services/medicineSearch';
import { MEDICINE_SEARCH_DEBOUNCE_MS } from '../constants/medicineSearchDebounce';
import type { Medicine } from '../types';

export type UseMedicineSearchOptions = Omit<SearchMedicinesOptions, 'page' | 'signal'> & {
  /** Debounce ms before calling Typesense. Default MEDICINE_SEARCH_DEBOUNCE_MS. */
  debounceMs?: number;
  /** When false, hook does not fetch. Default true. */
  enabled?: boolean;
  /**
   * Autocomplete mode (default): requires ≥2 chars.
   * Inventory list: set browseWhenEmpty true to page the catalog with q:"*".
   */
  browseWhenEmpty?: boolean;
  page?: number;
  /**
   * When the current query equals this string (e.g. selected medicine label),
   * skip searching — same as Create Purchase Invoice picker behaviour.
   */
  skipQuery?: string;
};

export type UseMedicineSearchState = {
  medicines: Medicine[];
  found: number;
  page: number;
  facet_counts: MedicineSearchResult['facet_counts'];
  loading: boolean;
  error: boolean;
};

/**
 * Shared Typesense medicine search for admin UIs.
 * Typesense-only on the hot path — never loads the full Firestore master list.
 * When `strict` is omitted: natural mode (prefix/typos) so "test" finds "Testa…" without Firestore reads.
 * Aborts in-flight work on query change / unmount (result ignored; callable may still finish server-side).
 */
export function useMedicineSearch(
  query: string,
  opts?: UseMedicineSearchOptions
): UseMedicineSearchState {
  const [state, setState] = useState<UseMedicineSearchState>({
    medicines: [],
    found: 0,
    page: 1,
    facet_counts: {},
    loading: false,
    error: false,
  });
  const queryRef = useRef(query);
  queryRef.current = query;

  const debounceMs = opts?.debounceMs ?? MEDICINE_SEARCH_DEBOUNCE_MS;
  const enabled = opts?.enabled !== false;
  const browseWhenEmpty = opts?.browseWhenEmpty === true;
  const page = opts?.page ?? 1;
  const hydrate = opts?.hydrate;
  const limit = opts?.limit;
  const strict = opts?.strict;
  const queryMode = opts?.queryMode;
  const category = opts?.category;
  const manufacturer = opts?.manufacturer;
  const stockFilter = opts?.stockFilter;
  const expiryFilter = opts?.expiryFilter;
  const sortKey = opts?.sortKey;
  const sortDirection = opts?.sortDirection;
  const includeFacets = opts?.includeFacets;
  const refineResults = opts?.refineResults;
  const skipQuery = opts?.skipQuery;

  useEffect(() => {
    if (!enabled) return;

    const trimmed = query.trim();
    const skip = skipQuery != null && skipQuery.trim().length > 0 && trimmed === skipQuery.trim();
    const canBrowse = browseWhenEmpty && trimmed.length < 2 && !skip;
    const canSearch = trimmed.length >= 2 && !skip;

    if (!canBrowse && !canSearch) {
      setState({
        medicines: [],
        found: 0,
        page: 1,
        facet_counts: {},
        loading: false,
        error: false,
      });
      return;
    }

    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: false }));

    const t = window.setTimeout(() => {
      searchMedicinesCatalog(trimmed, {
        hydrate: hydrate ?? false,
        limit: limit ?? 40,
        page,
        // Omit strict → natural Typesense (prefix) without Firestore reads.
        ...(typeof strict === 'boolean' ? { strict } : {}),
        ...(typeof refineResults === 'boolean' ? { refineResults } : {}),
        queryMode,
        browse: canBrowse,
        category,
        manufacturer,
        stockFilter,
        expiryFilter,
        sortKey,
        sortDirection,
        includeFacets,
        signal: controller.signal,
      })
        .then((res) => {
          if (controller.signal.aborted) return;
          if (queryRef.current.trim() !== trimmed) return;
          setState({
            medicines: res.medicines,
            found: res.found,
            page: res.page,
            facet_counts: res.facet_counts,
            loading: false,
            error: res.source === 'error',
          });
        })
        .catch((e) => {
          if (isAbortError(e) || controller.signal.aborted) return;
          setState({
            medicines: [],
            found: 0,
            page: 1,
            facet_counts: {},
            loading: false,
            error: true,
          });
        });
    }, debounceMs);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [
    query,
    enabled,
    browseWhenEmpty,
    page,
    hydrate,
    limit,
    strict,
    queryMode,
    category,
    manufacturer,
    stockFilter,
    expiryFilter,
    sortKey,
    sortDirection,
    includeFacets,
    refineResults,
    debounceMs,
    skipQuery,
  ]);

  return state;
}

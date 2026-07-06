import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getAllCreditNotes,
  getCreditNotesInRange,
  getCreditNoteById,
  issueCreditNoteForReturnRequestId,
  backfillAllCreditNotes,
  backfillCreditNoteById,
} from '../services/creditNotes';

import { getAllDebitNotes } from '../services/debitNotes';
import { getCreditNoteTotals, getDebitNoteTotals, NoteTotals } from '../services/dashboardAggregations';
import {
  searchCreditNotesTypesense,
  searchDebitNotesTypesense,
  CreditNoteRow,
  DebitNoteRow,
} from '../services/creditNoteSearch';
import { TypesenseSearchParams, TypesenseSearchResult } from '../services/typesenseSearch';
import { marginPeriodRange, type MarginPeriodFilter } from '../utils/marginPeriod';

export const useDebitNotes = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['debitNotes'],
    queryFn: getAllDebitNotes,
    enabled: options?.enabled ?? true,
  });
};

/** Server-side credit note search via Typesense (search + sort + pagination). */
export const useCreditNotesSearch = (
  params: TypesenseSearchParams,
  options?: { enabled?: boolean }
) => {
  return useQuery<TypesenseSearchResult<CreditNoteRow>>({
    queryKey: ['creditNotesSearch', params],
    queryFn: () => searchCreditNotesTypesense(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

/** Server-side debit note search via Typesense (search + sort + pagination). */
export const useDebitNotesSearch = (
  params: TypesenseSearchParams,
  options?: { enabled?: boolean }
) => {
  return useQuery<TypesenseSearchResult<DebitNoteRow>>({
    queryKey: ['debitNotesSearch', params],
    queryFn: () => searchDebitNotesTypesense(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

/**
 * Aggregation-based totals for the Dashboard KPIs. `monthStartMs` is the epoch
 * ms of the current month start (kept as a number so the query key stays stable
 * across renders). Server-side aggregation avoids pulling the whole collection.
 */
export const useCreditNoteTotals = (monthStartMs: number) => {
  return useQuery<NoteTotals>({
    queryKey: ['creditNoteTotals', monthStartMs],
    queryFn: () => getCreditNoteTotals(new Date(monthStartMs)),
  });
};

export const useDebitNoteTotals = (monthStartMs: number) => {
  return useQuery<NoteTotals>({
    queryKey: ['debitNoteTotals', monthStartMs],
    queryFn: () => getDebitNoteTotals(new Date(monthStartMs)),
  });
};

export const useCreditNotes = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['creditNotes'],
    queryFn: getAllCreditNotes,
    enabled: options?.enabled ?? true,
  });
};

/** Credit notes scoped to a margin-report period (avoids full collection for this/last month). */
export const useCreditNotesInPeriod = (period: MarginPeriodFilter) => {
  const range = marginPeriodRange(period);
  return useQuery({
    queryKey: ['creditNotesInPeriod', period, range?.startMs ?? null, range?.endMs ?? null],
    queryFn: () =>
      range ? getCreditNotesInRange(range.startMs, range.endMs) : getAllCreditNotes(),
  });
};

export const useCreditNote = (creditNoteId: string | undefined) => {
  return useQuery({
    queryKey: ['creditNote', creditNoteId],
    queryFn: () => getCreditNoteById(creditNoteId!),
    enabled: Boolean(creditNoteId),
  });
};

export const useIssueCreditNoteForReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: issueCreditNoteForReturnRequestId,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
      queryClient.invalidateQueries({ queryKey: ['creditNoteTotals'] });
      queryClient.invalidateQueries({ queryKey: ['creditNotesSearch'] });
      queryClient.invalidateQueries({ queryKey: ['orderReturns'] });
    },
  });
};

export const useBackfillCreditNotes = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: backfillAllCreditNotes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
      queryClient.invalidateQueries({ queryKey: ['creditNoteTotals'] });
      queryClient.invalidateQueries({ queryKey: ['creditNotesSearch'] });
    },
  });
};

export const useBackfillCreditNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: backfillCreditNoteById,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
      queryClient.invalidateQueries({ queryKey: ['creditNoteTotals'] });
      queryClient.invalidateQueries({ queryKey: ['creditNotesSearch'] });
    },
  });
};

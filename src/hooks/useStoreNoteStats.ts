import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  searchCreditNotesTypesense,
  searchDebitNotesTypesense,
} from '../services/creditNoteSearch';

type RetailerNoteStats = Map<string, { total: number; count: number }>;

async function fetchAllNoteRows(
  kind: 'credit' | 'debit'
): Promise<Array<{ retailerId: string; totalAmount: number }>> {
  const search = kind === 'credit' ? searchCreditNotesTypesense : searchDebitNotesTypesense;
  const rows: Array<{ retailerId: string; totalAmount: number }> = [];
  let page = 1;
  let found = Infinity;

  while ((page - 1) * 250 < found && page <= 40) {
    const res = await search({ query: '', filter: 'All', page, perPage: 250 });
    for (const row of res.rows) {
      if (row.retailerId) {
        rows.push({ retailerId: row.retailerId, totalAmount: row.totalAmount ?? 0 });
      }
    }
    found = res.found;
    page += 1;
  }

  return rows;
}

function buildStats(rows: Array<{ retailerId: string; totalAmount: number }>): RetailerNoteStats {
  const map: RetailerNoteStats = new Map();
  for (const row of rows) {
    const prev = map.get(row.retailerId) ?? { total: 0, count: 0 };
    map.set(row.retailerId, {
      total: prev.total + row.totalAmount,
      count: prev.count + 1,
    });
  }
  return map;
}

/** Per-retailer credit/debit note totals via Typesense (avoids full Firestore collection reads). */
export function useStoreNoteStats() {
  const creditQuery = useQuery({
    queryKey: ['storeNoteStats', 'credit'],
    queryFn: () => fetchAllNoteRows('credit'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const debitQuery = useQuery({
    queryKey: ['storeNoteStats', 'debit'],
    queryFn: () => fetchAllNoteRows('debit'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const creditNoteStatsByRetailerId = useMemo(
    () => buildStats(creditQuery.data ?? []),
    [creditQuery.data]
  );
  const debitNoteStatsByRetailerId = useMemo(
    () => buildStats(debitQuery.data ?? []),
    [debitQuery.data]
  );

  return {
    creditNoteStatsByRetailerId,
    debitNoteStatsByRetailerId,
    isLoading: creditQuery.isLoading || debitQuery.isLoading,
    isError: creditQuery.isError || debitQuery.isError,
  };
}

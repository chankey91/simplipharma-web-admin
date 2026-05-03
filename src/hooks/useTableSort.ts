import { useCallback, useState } from 'react';
import type { SortDirection } from '../utils/tableSort';

/**
 * Column sort state for MUI tables. Call `requestSort(columnId)` from TableSortLabel.
 * First click on a column: ascending. Same column again: toggles. New column: ascending.
 */
export function useTableSort(initialKey: string, initialDirection: SortDirection = 'desc') {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialDirection);

  const requestSort = useCallback((key: string) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDirection('asc');
      return key;
    });
  }, []);

  return { sortKey, sortDirection, requestSort };
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadAwaitingFulfillmentMedicines } from '../services/awaitingOrderMedicines';
import { searchProductDemandsTypesense } from '../services/productDemandSearch';
import {
  type MedicineResolveOption,
  buildMedicineResolveOptions,
} from '../services/medicineResolution';
import type { Medicine } from '../types';

/**
 * Prefetch product labels from Pending and Picked up orders, plus pending product demands.
 * Search keystrokes only filter those labels in memory and run the Typesense medicine search.
 * Order documents and stock batches stay off this path.
 */
export function useMedicineResolutionContext(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;

  const { data: pendingMedicines, isLoading: medicinesLoading } = useQuery({
    queryKey: ['medicineResolve', 'pendingAndPickedUp'],
    queryFn: loadAwaitingFulfillmentMedicines,
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const pendingIds = useMemo(
    () => (pendingMedicines ?? []).map((medicine) => medicine.id).filter(Boolean),
    [pendingMedicines]
  );

  const { data: demandsPage, isLoading: demandsLoading } = useQuery({
    queryKey: ['productDemands', 'pendingPrefetch'],
    queryFn: async () => {
      try {
        return await searchProductDemandsTypesense({
          query: '',
          filter: 'pending',
          perPage: 100,
          page: 1,
          sortField: 'createdAt',
          sortOrder: 'desc',
        });
      } catch (error) {
        console.warn('Pending product demands unavailable:', error);
        return { rows: [], found: 0, page: 1, perPage: 100, facetCounts: {}, totalAll: 0, source: 'typesense' as const };
      }
    },
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const preferredMedicineIds = useMemo(() => new Set(pendingIds), [pendingIds]);

  return {
    pendingMedicines: pendingMedicines ?? [],
    pendingDemands: demandsPage?.rows ?? [],
    preferredMedicineIds,
    pendingOrderMedicineIds: pendingIds,
    loading: enabled && (medicinesLoading || demandsLoading),
  };
}

export function useGroupedMedicineResolveOptions(args: {
  query: string;
  inventoryHits: Medicine[];
  pendingMedicines: Medicine[];
  pendingDemands: Parameters<typeof buildMedicineResolveOptions>[0]['pendingDemands'];
  selectedMedicine?: Medicine | null;
}): MedicineResolveOption[] {
  return useMemo(
    () =>
      buildMedicineResolveOptions({
        query: args.query,
        inventoryHits: args.inventoryHits,
        pendingMedicines: args.pendingMedicines,
        pendingDemands: args.pendingDemands,
        selectedMedicine: args.selectedMedicine,
      }),
    [
      args.query,
      args.inventoryHits,
      args.pendingMedicines,
      args.pendingDemands,
      args.selectedMedicine,
    ]
  );
}

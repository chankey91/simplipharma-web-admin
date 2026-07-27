import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrdersByStatuses } from './useOrders';
import { useMedicinesByIds } from './useInventory';
import { searchProductDemandsTypesense } from '../services/productDemandSearch';
import {
  collectPendingOrderMedicineIds,
  type MedicineResolveOption,
  buildMedicineResolveOptions,
} from '../services/medicineResolution';
import type { Medicine } from '../types';

/**
 * Prefetch pending-order medicine masters + pending product demands once (cached).
 * Search keystrokes only filter in memory + existing Typesense medicine search.
 */
export function useMedicineResolutionContext(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;

  const { data: pendingOrders, isLoading: ordersLoading } = useOrdersByStatuses(['Pending'], {
    enabled,
  });

  const pendingIds = useMemo(
    () => collectPendingOrderMedicineIds(pendingOrders),
    [pendingOrders]
  );

  const idsReady = enabled && pendingOrders !== undefined;
  const { data: pendingMedicines, isLoading: medicinesLoading } = useMedicinesByIds(
    idsReady ? pendingIds : undefined,
    { enabled: idsReady }
  );

  const { data: demandsPage, isLoading: demandsLoading } = useQuery({
    queryKey: ['productDemands', 'pendingPrefetch'],
    queryFn: () =>
      searchProductDemandsTypesense({
        query: '',
        filter: 'pending',
        perPage: 100,
        page: 1,
        sortField: 'createdAt',
        sortOrder: 'desc',
      }),
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
    loading: enabled && (ordersLoading || medicinesLoading || demandsLoading),
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

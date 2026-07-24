import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllMedicines,
  getAllMedicinesMasterOnly,
  getMedicineById,
  getMedicineBatches,
  getMedicinesByIdsWithBatches,
  updateMedicineStock,
  addStockBatch,
  findMedicineByBarcode,
  getExpiringMedicines,
  getExpiredMedicines,
  createMedicine,
  updateMedicine,
} from '../services/inventory';
import { Medicine, StockBatch } from '../types';

/**
 * @deprecated Prefer useMedicinesMaster / useMedicinesByIds / Typesense search.
 * Full catalog + batch hydrate — expensive; keep only for rare admin tooling.
 */
export const useMedicines = (options?: { fresh?: boolean }) => {
  return useQuery({
    queryKey: ['medicines'],
    queryFn: getAllMedicines,
    staleTime: options?.fresh ? 0 : 30 * 1000,
    refetchOnMount: options?.fresh ? 'always' : true,
    refetchOnWindowFocus: true,
  });
};

/** Master catalog only (no batch docs). Prefer for list UIs that only need stock totals. */
export const useMedicinesMaster = (options?: { fresh?: boolean }) => {
  return useQuery({
    queryKey: ['medicines', 'master'],
    queryFn: getAllMedicinesMasterOnly,
    staleTime: options?.fresh ? 0 : 60 * 1000,
    refetchOnMount: options?.fresh ? 'always' : true,
    refetchOnWindowFocus: true,
  });
};

/** Load specific medicines with stockBatches (order fulfillment, margin for those SKUs). */
export const useMedicinesByIds = (
  medicineIds: string[] | undefined,
  options?: { fresh?: boolean; enabled?: boolean }
) => {
  const ids = [...new Set((medicineIds ?? []).filter(Boolean))].sort();
  const sortedKey = ids.join(',');
  // `undefined` = caller not ready yet (e.g. order still loading) — do not fetch [].
  // `[]` = ready, no medicine ids — resolve empty list.
  const idsReady = medicineIds !== undefined;
  return useQuery({
    queryKey: ['medicines', 'byIds', sortedKey],
    queryFn: () => getMedicinesByIdsWithBatches(ids),
    enabled: (options?.enabled ?? true) && idsReady,
    staleTime: options?.fresh ? 0 : 2 * 60 * 1000,
    refetchOnMount: options?.fresh ? 'always' : false,
    refetchOnWindowFocus: false,
  });
};

export const useMedicine = (medicineId: string | undefined) => {
  return useQuery({
    queryKey: ['medicines', medicineId],
    queryFn: () => getMedicineById(medicineId!),
    enabled: !!medicineId,
    staleTime: 30 * 1000,
  });
};

export const useMedicineBatches = (medicineId: string | undefined) => {
  return useQuery({
    queryKey: ['medicineBatches', medicineId],
    queryFn: () => getMedicineBatches(medicineId!),
    enabled: !!medicineId,
    staleTime: 15 * 1000,
  });
};

export const useUpdateStock = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      medicineId,
      updates,
    }: {
      medicineId: string;
      updates: Parameters<typeof updateMedicineStock>[1];
    }) => updateMedicineStock(medicineId, updates),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['medicineBatches', vars.medicineId] });
    },
  });
};

export const useAddStockBatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      medicineId,
      batch,
    }: {
      medicineId: string;
      batch: Omit<StockBatch, 'id'>;
    }) => addStockBatch(medicineId, batch),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['medicineBatches', vars.medicineId] });
    },
  });
};

export const useFindMedicineByBarcode = () => {
  return useMutation({
    mutationFn: (barcode: string) => findMedicineByBarcode(barcode),
  });
};

export const useExpiringMedicines = (days: number = 30) => {
  return useQuery({
    queryKey: ['expiringMedicines', days],
    queryFn: () => getExpiringMedicines(days),
  });
};

export const useExpiredMedicines = () => {
  return useQuery({
    queryKey: ['expiredMedicines'],
    queryFn: getExpiredMedicines,
  });
};

export const useCreateMedicine = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (medicineData: Omit<Medicine, 'id'>) => createMedicine(medicineData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
    },
  });
};

export const useUpdateMedicine = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ medicineId, updates }: { medicineId: string; updates: Partial<Medicine> }) =>
      updateMedicine(medicineId, updates),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['medicines', vars.medicineId] });
    },
  });
};

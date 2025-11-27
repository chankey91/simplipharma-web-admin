import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  getAllMedicines, 
  updateMedicineStock, 
  addStockBatch,
  findMedicineByBarcode,
  getExpiringMedicines,
  getExpiredMedicines
} from '../services/inventory';
import { Medicine, StockBatch } from '../types';

export const useMedicines = () => {
  return useQuery({
    queryKey: ['medicines'],
    queryFn: getAllMedicines
  });
};

export const useUpdateStock = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      medicineId, 
      updates 
    }: { 
      medicineId: string; 
      updates: Parameters<typeof updateMedicineStock>[1] 
    }) => updateMedicineStock(medicineId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
    }
  });
};

export const useAddStockBatch = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      medicineId, 
      batch 
    }: { 
      medicineId: string; 
      batch: Omit<StockBatch, 'id'> 
    }) => addStockBatch(medicineId, batch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
    }
  });
};

export const useFindMedicineByBarcode = () => {
  return useMutation({
    mutationFn: (barcode: string) => findMedicineByBarcode(barcode)
  });
};

export const useExpiringMedicines = (days: number = 30) => {
  return useQuery({
    queryKey: ['expiringMedicines', days],
    queryFn: () => getExpiringMedicines(days)
  });
};

export const useExpiredMedicines = () => {
  return useQuery({
    queryKey: ['expiredMedicines'],
    queryFn: getExpiredMedicines
  });
};


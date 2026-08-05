import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPurchaseReturn,
  createPurchaseReturnsMultiVendor,
  CreatePurchaseReturnInput,
  getAllPurchaseReturns,
  getPurchaseReturnById,
  getPurchaseReturnsByVendor,
} from '../services/purchaseReturns';

export const usePurchaseReturns = (opts?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['purchaseReturns'],
    queryFn: getAllPurchaseReturns,
    enabled: opts?.enabled !== false,
  });
};

export const usePurchaseReturn = (returnId: string) => {
  return useQuery({
    queryKey: ['purchaseReturn', returnId],
    queryFn: () => getPurchaseReturnById(returnId),
    enabled: !!returnId,
  });
};

export const useVendorPurchaseReturns = (
  vendorId: string,
  opts?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['purchaseReturns', 'vendor', vendorId],
    queryFn: () => getPurchaseReturnsByVendor(vendorId),
    enabled: !!vendorId && opts?.enabled !== false,
  });
};

export const useCreatePurchaseReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseReturnInput) => createPurchaseReturn(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchaseReturns'] });
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
};

export const useCreatePurchaseReturnsMultiVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inputs: CreatePurchaseReturnInput[]) =>
      createPurchaseReturnsMultiVendor(inputs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchaseReturns'] });
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
};

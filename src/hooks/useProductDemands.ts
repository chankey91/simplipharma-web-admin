import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllProductDemands,
  fulfillProductDemand,
  rejectProductDemand,
} from '../services/productDemands';

export const useProductDemands = () => {
  return useQuery({
    queryKey: ['productDemands'],
    queryFn: getAllProductDemands,
  });
};

export const useFulfillProductDemand = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      demandId,
      medicineId,
      quantity,
      fulfillmentNote,
      purchaseInvoiceId,
    }: {
      demandId: string;
      medicineId: string;
      quantity?: number;
      fulfillmentNote?: string;
      purchaseInvoiceId?: string;
    }) => fulfillProductDemand(demandId, medicineId, {
        quantity,
        fulfillmentNote,
        purchaseInvoiceId,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['productDemands'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      if (data?.orderId) {
        queryClient.invalidateQueries({ queryKey: ['order', data.orderId] });
      }
    },
  });
};

export const useRejectProductDemand = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ demandId, reason }: { demandId: string; reason: string }) =>
      rejectProductDemand(demandId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productDemands'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
};

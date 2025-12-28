import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  getAllPurchaseInvoices, 
  getPurchaseInvoiceById, 
  createPurchaseInvoice, 
  updatePurchaseInvoice,
  updateStockForExistingInvoice,
  updateStockForAllExistingInvoices
} from '../services/purchaseInvoices';
import { PurchaseInvoice } from '../types';

export const usePurchaseInvoices = () => {
  return useQuery({
    queryKey: ['purchaseInvoices'],
    queryFn: getAllPurchaseInvoices
  });
};

export const usePurchaseInvoice = (invoiceId: string) => {
  return useQuery({
    queryKey: ['purchaseInvoice', invoiceId],
    queryFn: () => getPurchaseInvoiceById(invoiceId),
    enabled: !!invoiceId
  });
};

export const useCreatePurchaseInvoice = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ invoiceData, updateStock }: { 
      invoiceData: Omit<PurchaseInvoice, 'id'>; 
      updateStock?: boolean;
    }) => createPurchaseInvoice(invoiceData, updateStock ?? true),
    onSuccess: async () => {
      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      // Force refetch medicines to get updated stock
      await queryClient.invalidateQueries({ queryKey: ['medicines'] });
      // Also refetch any medicine detail pages
      await queryClient.invalidateQueries({ queryKey: ['medicine'] });
    }
  });
};

export const useUpdatePurchaseInvoice = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ invoiceId, invoiceData }: { 
      invoiceId: string; 
      invoiceData: Partial<PurchaseInvoice> 
    }) => updatePurchaseInvoice(invoiceId, invoiceData),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoice', variables.invoiceId] });
    }
  });
};

export const useUpdateStockForInvoice = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (invoiceId: string) => updateStockForExistingInvoice(invoiceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['medicines'] });
      await queryClient.invalidateQueries({ queryKey: ['medicine'] });
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
    }
  });
};

export const useUpdateStockForAllInvoices = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => updateStockForAllExistingInvoices(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['medicines'] });
      await queryClient.invalidateQueries({ queryKey: ['medicine'] });
    }
  });
};


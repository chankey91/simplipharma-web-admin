import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  getAllPurchaseInvoices, 
  getPurchaseInvoiceById, 
  createPurchaseInvoice, 
  updatePurchaseInvoice 
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['medicines'] }); // Invalidate medicines to refresh stock
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


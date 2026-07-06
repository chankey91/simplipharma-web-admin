import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { 
  getAllPurchaseInvoices,
  getPayablePurchaseInvoices,
  getPurchaseInvoiceById, 
  createPurchaseInvoice, 
  updatePurchaseInvoice,
  updatePurchaseInvoicePayment,
  updateStockForExistingInvoice,
  updateStockForAllExistingInvoices
} from '../services/purchaseInvoices';
import {
  searchPurchaseInvoicesTypesense,
  PurchaseInvoiceRow,
} from '../services/purchaseInvoiceSearch';
import { TypesenseSearchParams, TypesenseSearchResult } from '../services/typesenseSearch';
import { getPurchaseInvoiceAmountTotal } from '../services/dashboardAggregations';
import { PurchaseInvoice } from '../types';

export const usePurchaseInvoices = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['purchaseInvoices'],
    queryFn: getAllPurchaseInvoices,
    enabled: options?.enabled ?? true,
  });
};

/** Payable purchase bills only (Unpaid/Partial) — vendor ledger. */
export const usePayablePurchaseInvoices = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['payablePurchaseInvoices'],
    queryFn: getPayablePurchaseInvoices,
    enabled: options?.enabled ?? true,
    staleTime: 2 * 60 * 1000,
  });
};

/** Server-side purchase invoice search via Typesense (search + filter + sort + pagination). */
export const usePurchaseInvoicesSearch = (
  params: TypesenseSearchParams,
  options?: { enabled?: boolean }
) => {
  return useQuery<TypesenseSearchResult<PurchaseInvoiceRow>>({
    queryKey: ['purchaseInvoicesSearch', params],
    queryFn: () => searchPurchaseInvoicesTypesense(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

/** Server-side sum of all purchase invoice amounts (Firestore aggregation). */
export const usePurchaseInvoiceAmountTotal = (options?: { enabled?: boolean }) => {
  return useQuery<number>({
    queryKey: ['purchaseInvoiceAmountTotal'],
    queryFn: getPurchaseInvoiceAmountTotal,
    enabled: options?.enabled ?? true,
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
      await queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoicesSearch'] });
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoiceAmountTotal'] });
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
      queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoicesSearch'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoiceAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoice', variables.invoiceId] });
    }
  });
};

export const useUpdatePurchaseInvoicePayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      invoiceId,
      paymentStatus,
      paymentMethod,
      paidAmount,
    }: {
      invoiceId: string;
      paymentStatus: 'Paid' | 'Unpaid' | 'Partial';
      paymentMethod?: 'Cash' | 'Online';
      paidAmount?: number;
    }) => updatePurchaseInvoicePayment(invoiceId, paymentStatus, paymentMethod, paidAmount),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoicesSearch'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoiceAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoice', variables.invoiceId] });
    },
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
      await queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoicesSearch'] });
      await queryClient.invalidateQueries({ queryKey: ['purchaseInvoiceAmountTotal'] });
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


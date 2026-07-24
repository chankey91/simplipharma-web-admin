import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { 
  getAllPurchaseInvoices,
  getPayablePurchaseInvoices,
  getPurchaseInvoicesByVendor,
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
import { buildLastPurchaseByMedicineId } from '../utils/vendorLastPurchase';

export const usePurchaseInvoices = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['purchaseInvoices'],
    queryFn: getAllPurchaseInvoices,
    enabled: options?.enabled ?? true,
    // Full PI catalog is large — keep warm so Order Details does not re-download every visit.
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
};

export const useVendorPurchaseInvoices = (vendorId: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['vendorPurchaseInvoices', vendorId],
    queryFn: () => getPurchaseInvoicesByVendor(vendorId),
    enabled: (options?.enabled ?? true) && !!vendorId,
    staleTime: 0,
  });
};

/**
 * Last purchase line per medicineId across all vendors
 * (scheme, discount, rate, etc.). Used on Create / Purchase Invoice Details.
 */
export const useVendorLastPurchases = (
  _vendorId?: string | undefined,
  excludeInvoiceId?: string,
  options?: { enabled?: boolean }
) => {
  const query = useQuery({
    queryKey: ['purchaseLastByMedicine'],
    queryFn: () => getAllPurchaseInvoices(),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
  const lastPurchaseByMedicineId = useMemo(
    () => buildLastPurchaseByMedicineId(query.data ?? [], excludeInvoiceId),
    [query.data, excludeInvoiceId]
  );
  return { ...query, lastPurchaseByMedicineId };
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
      vendorId,
      paymentStatus,
      paymentMethod,
      paidAmount,
      transactionId,
    }: {
      invoiceId: string;
      vendorId?: string;
      paymentStatus: 'Paid' | 'Unpaid' | 'Partial';
      paymentMethod?: 'Cash' | 'Online';
      paidAmount?: number;
      transactionId?: string;
    }) =>
      updatePurchaseInvoicePayment(
        invoiceId,
        paymentStatus,
        paymentMethod,
        paidAmount,
        undefined,
        transactionId
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoicesSearch'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoiceAmountTotal'] });
      if (variables.vendorId) {
        queryClient.invalidateQueries({ queryKey: ['vendorPurchaseInvoices', variables.vendorId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['vendorPurchaseInvoices'] });
      }
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


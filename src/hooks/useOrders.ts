import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { startOfMonth, subMonths } from 'date-fns';
import {
  searchOrdersTypesense,
  OrderSearchParams,
  OrderSearchResult,
} from '../services/orderSearch';
import { 
  getAllOrders, 
  getOrdersByStatuses,
  getOrdersInRange,
  getOrderPaymentStatuses,
  getReceivableOrders,
  getRecentOrders,
  updateOrderStatus, 
  updateOrderDispatch, 
  markOrderDelivered, 
  cancelOrder, 
  fulfillOrder,
  unfulfillOrder,
  recalculateOrderPricing,
  getOrderById,
  getOrdersByRetailer,
  updatePaymentStatus
} from '../services/orders';
import { getCreditNotesByRetailer } from '../services/creditNotes';
import { getDebitNotesByRetailer } from '../services/debitNotes';
import { getOrderDashboardStats, getOrderInvoicedAmountTotal } from '../services/orderAggregations';
import { OrderStatus } from '../types';

export const useOrders = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['orders'],
    queryFn: getAllOrders,
    enabled: options?.enabled ?? true,
  });
};

/**
 * Orders in the given statuses only (default: pre-dispatch statuses that still
 * hold stock reservations). Avoids pulling the whole collection.
 */
export const useOrdersByStatuses = (
  statuses: OrderStatus[] = ['Pending', 'Order Fulfillment'],
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['ordersByStatuses', [...statuses].sort()],
    queryFn: () => getOrdersByStatuses(statuses),
    enabled: options?.enabled ?? true,
  });
};

/**
 * Orders scoped to a reporting period. "this month"/"last month" run a
 * date-range query so the Margin report doesn't scan the entire orders history;
 * "all" still loads everything (unavoidable for an all-time report).
 */
export const useOrdersInPeriod = (period: 'this_month' | 'last_month' | 'all') => {
  const range = useMemo(() => {
    const now = new Date();
    if (period === 'this_month') {
      return { startMs: startOfMonth(now).getTime(), endMs: undefined as number | undefined };
    }
    if (period === 'last_month') {
      return {
        startMs: startOfMonth(subMonths(now, 1)).getTime(),
        endMs: startOfMonth(now).getTime(),
      };
    }
    return null;
  }, [period]);

  return useQuery({
    queryKey: ['ordersInPeriod', period, range?.startMs ?? null, range?.endMs ?? null],
    queryFn: () => (range ? getOrdersInRange(range.startMs, range.endMs) : getAllOrders()),
  });
};

/** Orders with outstanding balance (Unpaid/Partial) for the Store Receivables page. */
export const useReceivableOrders = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['receivableOrders'],
    queryFn: getReceivableOrders,
    enabled: options?.enabled ?? true,
  });
};

/** Orders, credit notes, and debit notes for a retailer ledger. */
export const useRetailerLedgerData = (
  retailerId: string,
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['retailerLedgerData', retailerId],
    queryFn: async () => {
      const [orders, creditNotes, debitNotes] = await Promise.all([
        getOrdersByRetailer(retailerId),
        getCreditNotesByRetailer(retailerId),
        getDebitNotesByRetailer(retailerId),
      ]);
      return { orders, creditNotes, debitNotes };
    },
    enabled: (options?.enabled ?? true) && !!retailerId,
    staleTime: 0,
  });
};

/** Live payment status for a bounded set of orders (Payment Requests page). */
export const useOrderPaymentStatuses = (orderIds: string[]) => {
  const key = [...new Set(orderIds)].sort();
  return useQuery({
    queryKey: ['orderPaymentStatuses', key],
    queryFn: () => getOrderPaymentStatuses(orderIds),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
};

/** Server-side order KPI aggregation for the Dashboard (no full-collection read). */
export const useOrderDashboardStats = (monthStartMs: number) => {
  return useQuery({
    queryKey: ['orderDashboardStats', monthStartMs],
    queryFn: () => getOrderDashboardStats(new Date(monthStartMs)),
  });
};

/** The N most recent orders (small limit query) for the Dashboard panel. */
export const useRecentOrders = (max = 6) => {
  return useQuery({
    queryKey: ['recentOrders', max],
    queryFn: () => getRecentOrders(max),
  });
};

/** Server-side sum of invoiced-order amounts for the Invoices "Total Amount" KPI. */
export const useOrderInvoicedAmountTotal = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['orderInvoicedAmountTotal'],
    queryFn: getOrderInvoicedAmountTotal,
    enabled: options?.enabled ?? true,
  });
};

/**
 * Server-side order search via Typesense (search + filter + sort + pagination).
 * Avoids downloading the whole `orders` collection. `keepPreviousData` keeps the
 * current page visible while the next page/query loads.
 */
export const useOrdersSearch = (
  params: OrderSearchParams,
  options?: { enabled?: boolean }
) => {
  return useQuery<OrderSearchResult>({
    queryKey: ['ordersSearch', params],
    queryFn: () => searchOrdersTypesense(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

export const useOrder = (orderId: string) => {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrderById(orderId),
    enabled: !!orderId
  });
};

export const useUpdateOrderStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      orderId, 
      status, 
      updatedBy, 
      note 
    }: { 
      orderId: string; 
      status: OrderStatus; 
      updatedBy: string; 
      note?: string 
    }) => updateOrderStatus(orderId, status, updatedBy, note),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    }
  });
};

export const useCancelOrder = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      orderId, 
      cancelledBy, 
      reason 
    }: { 
      orderId: string; 
      cancelledBy: string; 
      reason: string 
    }) => cancelOrder(orderId, cancelledBy, reason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    }
  });
};

export const useFulfillOrder = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      orderId, 
      fulfilledBy, 
      fulfillmentData 
    }: { 
      orderId: string; 
      fulfilledBy: string; 
      fulfillmentData: any 
    }) => fulfillOrder(orderId, fulfilledBy, fulfillmentData),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ['medicines'] }); // Invalidate medicines to reflect stock changes
      queryClient.invalidateQueries({ queryKey: ['traysInUse'] }); // Refresh tray availability
    }
  });
};

export const useUnfulfillOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      unfulfilledBy,
      note,
    }: {
      orderId: string;
      unfulfilledBy: string;
      note?: string;
    }) => unfulfillOrder(orderId, unfulfilledBy, note),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['traysInUse'] });
    },
  });
};

export const useRecalculateOrderPricing = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      medicinesCatalog,
      purchaseInvoices,
    }: {
      orderId: string;
      medicinesCatalog: Parameters<typeof recalculateOrderPricing>[1];
      purchaseInvoices: Parameters<typeof recalculateOrderPricing>[2];
    }) => recalculateOrderPricing(orderId, medicinesCatalog, purchaseInvoices),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    },
  });
};

export const useUpdateOrderDispatch = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, dispatchData }: { 
      orderId: string; 
      dispatchData: Parameters<typeof updateOrderDispatch>[1] 
    }) => updateOrderDispatch(orderId, dispatchData),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ['traysInUse'] }); // Refresh tray availability when dispatched
    }
  });
};

export const useMarkOrderDelivered = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, deliveredBy }: { orderId: string; deliveredBy: string }) =>
      markOrderDelivered(orderId, deliveredBy),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    }
  });
};

export const useUpdatePaymentStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      paymentStatus,
      paidAmount,
      totalAmount,
      paymentMethod,
      transactionId,
    }: {
      orderId: string;
      paymentStatus: 'Paid' | 'Unpaid' | 'Partial';
      paidAmount?: number;
      totalAmount?: number;
      paymentMethod?: 'Cash' | 'Online';
      transactionId?: string;
    }) => updatePaymentStatus(orderId, paymentStatus, paidAmount, totalAmount, paymentMethod, transactionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByStatuses'] });
      queryClient.invalidateQueries({ queryKey: ['orderDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['recentOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orderInvoicedAmountTotal'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['retailerLedgerData'] });
      queryClient.invalidateQueries({ queryKey: ['ordersInPeriod'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    }
  });
};

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  getAllOrders, 
  updateOrderStatus, 
  updateOrderDispatch, 
  markOrderDelivered, 
  cancelOrder, 
  fulfillOrder,
  getOrderById,
  updatePaymentStatus
} from '../services/orders';
import { OrderStatus } from '../types';

export const useOrders = () => {
  return useQuery({
    queryKey: ['orders'],
    queryFn: getAllOrders
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
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ['medicines'] }); // Invalidate medicines to reflect stock changes
    }
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
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
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
      totalAmount 
    }: { 
      orderId: string; 
      paymentStatus: 'Paid' | 'Unpaid' | 'Partial';
      paidAmount?: number;
      totalAmount?: number;
    }) => updatePaymentStatus(orderId, paymentStatus, paidAmount, totalAmount),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
    }
  });
};

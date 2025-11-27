import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllOrders, updateOrderStatus, updateOrderDispatch, markOrderDelivered } from '../services/orders';
import { OrderStatus } from '../types';

export const useOrders = () => {
  return useQuery({
    queryKey: ['orders'],
    queryFn: getAllOrders
  });
};

export const useUpdateOrderStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      updateOrderStatus(orderId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    }
  });
};

export const useMarkOrderDelivered = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, deliveredBy }: { orderId: string; deliveredBy: string }) =>
      markOrderDelivered(orderId, deliveredBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    }
  });
};


import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOrderTradeDiscountSettings,
  saveOrderTradeDiscountSettings,
  type OrderTradeDiscountSettings,
} from '../services/orderTradeDiscountSettings';
import { setOrderTradeDiscountBands } from '../utils/orderFulfillmentDiscount';

export function useOrderTradeDiscountSettings() {
  const query = useQuery({
    queryKey: ['orderTradeDiscountSettings'],
    queryFn: getOrderTradeDiscountSettings,
  });

  useEffect(() => {
    if (query.data?.bands) setOrderTradeDiscountBands(query.data.bands);
  }, [query.data]);

  return query;
}

export function useSaveOrderTradeDiscountSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: OrderTradeDiscountSettings) => saveOrderTradeDiscountSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['orderTradeDiscountSettings'], saved);
      setOrderTradeDiscountBands(saved.bands);
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllStores, updateStore, toggleStoreStatus } from '../services/stores';
import { User } from '../types';

export const useStores = () => {
  return useQuery({
    queryKey: ['stores'],
    queryFn: getAllStores
  });
};

export const useUpdateStore = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ storeId, data }: { storeId: string; data: Partial<User> }) =>
      updateStore(storeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    }
  });
};

export const useToggleStoreStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ storeId, isActive }: { storeId: string; isActive: boolean }) =>
      toggleStoreStatus(storeId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    }
  });
};


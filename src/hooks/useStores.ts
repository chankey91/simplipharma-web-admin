import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllStores,
  updateStore,
  toggleStoreStatus,
  createStore,
  assignRetailerToSalesOfficer,
  sendRetailerPasswordResetEmail,
} from '../services/stores';
import { User } from '../types';

export const useStores = (enabled = true) => {
  return useQuery({
    queryKey: ['stores'],
    queryFn: getAllStores,
    enabled,
    // Reference data that changes rarely — cache longer so navigation/refetch
    // doesn't re-read the whole collection. Mutations invalidate ['stores'].
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

export const useUpdateStore = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      storeId,
      data,
      previousEmail,
    }: {
      storeId: string;
      data: Partial<User>;
      previousEmail?: string;
    }) => updateStore(storeId, data, { previousEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    }
  });
};

export const useCreateStore = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (storeData: Partial<User>) => createStore(storeData),
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

export const useSendRetailerPasswordResetEmail = () => {
  return useMutation({
    mutationFn: (email: string) => sendRetailerPasswordResetEmail(email),
  });
};

export const useAssignRetailerToSalesOfficer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { retailerUserId: string; salesOfficerId: string | null }) =>
      assignRetailerToSalesOfficer(args.retailerUserId, args.salesOfficerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
    },
  });
};

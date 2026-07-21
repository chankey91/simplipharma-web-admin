import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPurchaseOfficers,
  createPurchaseOfficer,
  updatePurchaseOfficerProfile,
  sendPurchaseOfficerPasswordResetEmail,
} from '../services/purchaseOfficers';
import { User } from '../types';

export const usePurchaseOfficers = () => {
  return useQuery({
    queryKey: ['purchaseOfficers'],
    queryFn: getPurchaseOfficers,
    staleTime: 60_000,
  });
};

export const useCreatePurchaseOfficer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      data: Partial<User> & {
        email: string;
        initialPassword?: string;
        firstName?: string;
        lastName?: string;
      }
    ) => createPurchaseOfficer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOfficers'] });
    },
  });
};

export const useUpdatePurchaseOfficerProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      purchaseOfficerId: string;
      data: { displayName?: string; phoneNumber?: string; firstName?: string; lastName?: string };
    }) => updatePurchaseOfficerProfile(args.purchaseOfficerId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOfficers'] });
    },
  });
};

export const useSendPurchaseOfficerPasswordResetEmail = () => {
  return useMutation({
    mutationFn: (email: string) => sendPurchaseOfficerPasswordResetEmail(email),
  });
};

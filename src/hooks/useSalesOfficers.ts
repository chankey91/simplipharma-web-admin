import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSalesOfficers, createSalesOfficer, updateSalesOfficerProfile, sendSalesOfficerPasswordResetEmail } from '../services/salesOfficers';
import { User } from '../types';

export const useSalesOfficers = () => {
  return useQuery({
    queryKey: ['salesOfficers'],
    queryFn: getSalesOfficers,
    // Reference data — cache longer; mutations invalidate ['salesOfficers'].
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

export const useCreateSalesOfficer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<User> & { email: string; initialPassword: string }) =>
      createSalesOfficer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
    },
  });
};

export const useUpdateSalesOfficerProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      salesOfficerId: string;
      data: { displayName?: string; phoneNumber?: string };
    }) => updateSalesOfficerProfile(args.salesOfficerId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
    },
  });
};

export const useSendSalesOfficerPasswordResetEmail = () => {
  return useMutation({
    mutationFn: (email: string) => sendSalesOfficerPasswordResetEmail(email),
  });
};

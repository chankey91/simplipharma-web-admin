import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSalesOfficers, createSalesOfficer } from '../services/salesOfficers';
import { User } from '../types';

export const useSalesOfficers = () => {
  return useQuery({
    queryKey: ['salesOfficers'],
    queryFn: getSalesOfficers,
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

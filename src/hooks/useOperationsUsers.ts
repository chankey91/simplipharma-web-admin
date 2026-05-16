import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOperationsUsers,
  createOperationsUser,
  updateOperationsUserProfile,
} from '../services/operationsUsers';
import { User } from '../types';

export const useOperationsUsers = () => {
  return useQuery({
    queryKey: ['operationsUsers'],
    queryFn: getOperationsUsers,
  });
};

export const useCreateOperationsUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<User> & { email: string; initialPassword: string }) =>
      createOperationsUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationsUsers'] });
    },
  });
};

export const useUpdateOperationsUserProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      userId: string;
      data: { displayName?: string; phoneNumber?: string; isActive?: boolean };
    }) => updateOperationsUserProfile(args.userId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationsUsers'] });
    },
  });
};

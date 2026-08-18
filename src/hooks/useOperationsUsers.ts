import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOperationsUsers,
  createOperationsUser,
  updateOperationsUserProfile,
  type CreatePanelUserInput,
} from '../services/operationsUsers';
import type { UpdatePanelUserProfile } from '../services/operationsUsers';

export const useOperationsUsers = () => {
  return useQuery({
    queryKey: ['operationsUsers'],
    queryFn: getOperationsUsers,
    // Reference data — cache longer; mutations invalidate ['operationsUsers'].
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

export const useCreateOperationsUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePanelUserInput) => createOperationsUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationsUsers'] });
    },
  });
};

export const useUpdateOperationsUserProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; data: UpdatePanelUserProfile }) =>
      updateOperationsUserProfile(args.userId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationsUsers'] });
    },
  });
};

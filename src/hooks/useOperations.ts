import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTrays,
  getOperators,
  getTraysInUse,
  addTray,
  addOperator,
  deleteTray,
  deleteOperator,
} from '../services/operations';

export const useTrays = () => {
  return useQuery({
    queryKey: ['trays'],
    queryFn: getTrays,
  });
};

export const useOperators = () => {
  return useQuery({
    queryKey: ['operators'],
    queryFn: getOperators,
  });
};

export const useTraysInUse = (excludeOrderId?: string) => {
  return useQuery({
    queryKey: ['traysInUse', excludeOrderId],
    queryFn: () => getTraysInUse(excludeOrderId),
  });
};

export const useAddTray = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => addTray(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trays'] });
    },
  });
};

export const useAddOperator = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => addOperator(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
    },
  });
};

export const useDeleteTray = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTray(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trays'] });
    },
  });
};

export const useDeleteOperator = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOperator(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
    },
  });
};

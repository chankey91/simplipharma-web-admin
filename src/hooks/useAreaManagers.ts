import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAreaManagers,
  createAreaManager,
  updateAreaManagerProfile,
  assignSalesOfficerToAreaManager,
  syncSalesOfficersForAreaManagerDistricts,
  sendAreaManagerPasswordResetEmail,
  type AreaManagerProfileUpdate,
} from '../services/areaManagers';
import { User } from '../types';

export const useAreaManagers = () => {
  return useQuery({
    queryKey: ['areaManagers'],
    queryFn: getAreaManagers,
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

export const useCreateAreaManager = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<User> & { email: string; initialPassword: string }) =>
      createAreaManager(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areaManagers'] });
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
    },
  });
};

export const useUpdateAreaManagerProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { areaManagerId: string; data: AreaManagerProfileUpdate }) =>
      updateAreaManagerProfile(args.areaManagerId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areaManagers'] });
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
    },
  });
};

export const useSyncSalesOfficersForAreaManagerDistricts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      areaManagerId: string;
      managedDistricts: string[];
      salesOfficers: User[];
    }) =>
      syncSalesOfficersForAreaManagerDistricts(
        args.areaManagerId,
        args.managedDistricts,
        args.salesOfficers
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
      queryClient.invalidateQueries({ queryKey: ['areaManagers'] });
    },
  });
};

export const useAssignSalesOfficerToAreaManager = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { salesOfficerId: string; areaManagerId: string | null }) =>
      assignSalesOfficerToAreaManager(args.salesOfficerId, args.areaManagerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOfficers'] });
      queryClient.invalidateQueries({ queryKey: ['areaManagers'] });
    },
  });
};

export const useSendAreaManagerPasswordResetEmail = () => {
  return useMutation({
    mutationFn: (email: string) => sendAreaManagerPasswordResetEmail(email),
  });
};

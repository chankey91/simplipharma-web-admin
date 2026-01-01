import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllVendors, getVendorById, createVendor, updateVendor, toggleVendorStatus } from '../services/vendors';
import { Vendor } from '../types';

export const useVendors = () => {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: getAllVendors
  });
};

export const useVendor = (vendorId: string) => {
  return useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: () => getVendorById(vendorId),
    enabled: !!vendorId
  });
};

export const useCreateVendor = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (vendorData: Omit<Vendor, 'id'> & { password?: string }) => createVendor(vendorData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    }
  });
};

export const useUpdateVendor = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ vendorId, vendorData }: { vendorId: string; vendorData: Partial<Vendor> }) =>
      updateVendor(vendorId, vendorData),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', variables.vendorId] });
    }
  });
};

export const useToggleVendorStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ vendorId, isActive }: { vendorId: string; isActive: boolean }) =>
      toggleVendorStatus(vendorId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    }
  });
};


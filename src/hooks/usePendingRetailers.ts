import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPendingRetailerRequests,
  approveRetailerRequest,
  rejectRetailerRequest,
  RetailerRegistrationRequest,
} from '../services/pendingRetailers';

export const usePendingRetailerRequests = () => {
  return useQuery({
    queryKey: ['pendingRetailerRequests'],
    queryFn: getPendingRetailerRequests,
  });
};

export const useApproveRetailerRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => approveRetailerRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingRetailerRequests'] });
    },
  });
};

export const useRejectRetailerRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }) =>
      rejectRetailerRequest(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingRetailerRequests'] });
    },
  });
};

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPendingRetailerRequests,
  approveRetailerRequest,
  rejectRetailerRequest,
  RejectRetailerRequestResult,
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
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }): Promise<RejectRetailerRequestResult> =>
      rejectRetailerRequest(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingRetailerRequests'] });
    },
  });
};

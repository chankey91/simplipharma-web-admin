import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePaymentRequest,
  getAllPaymentRequests,
  getPendingPaymentRequests,
  rejectPaymentRequest,
} from '../services/paymentRequests';

export const usePaymentRequests = () => {
  return useQuery({
    queryKey: ['paymentRequests'],
    queryFn: getAllPaymentRequests,
  });
};

export const usePendingPaymentRequests = () => {
  return useQuery({
    queryKey: ['paymentRequests', 'pending'],
    queryFn: getPendingPaymentRequests,
  });
};

export const useApprovePaymentRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      reviewedBy,
      approvedAmount,
      reviewNote,
    }: {
      requestId: string;
      reviewedBy: string;
      approvedAmount?: number;
      reviewNote?: string;
    }) => approvePaymentRequest(requestId, { reviewedBy, approvedAmount, reviewNote }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['paymentRequests'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      if (result?.orderId) {
        queryClient.invalidateQueries({ queryKey: ['order', result.orderId] });
      }
    },
  });
};

export const useRejectPaymentRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      reviewedBy,
      rejectionReason,
    }: {
      requestId: string;
      reviewedBy: string;
      rejectionReason: string;
    }) => rejectPaymentRequest(requestId, { reviewedBy, rejectionReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentRequests'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
};

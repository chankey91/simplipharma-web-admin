import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  approvePaymentRequest,
  getPaymentRequestsByStatus,
  getPaymentRequestStatusCounts,
  rejectPaymentRequest,
} from '../services/paymentRequests';
import { getOrderPaymentStatuses } from '../services/orders';
import { PaymentRequestStatus } from '../types';

export const usePaymentRequestStatusCounts = () => {
  return useQuery({
    queryKey: ['paymentRequestStatusCounts'],
    queryFn: getPaymentRequestStatusCounts,
  });
};

/** Payment requests for one status tab (avoids downloading the whole collection). */
export const usePaymentRequestsByStatus = (status: PaymentRequestStatus) => {
  return useQuery({
    queryKey: ['paymentRequests', status],
    queryFn: () => getPaymentRequestsByStatus(status),
  });
};

/** Payment status for orders referenced by the current tab's payment requests. */
export const useOrderPaymentStatuses = (orderIds: string[]) => {
  const key = [...orderIds].sort().join(',');
  return useQuery({
    queryKey: ['orderPaymentStatuses', key],
    queryFn: () => getOrderPaymentStatuses(orderIds),
    enabled: orderIds.length > 0,
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
      queryClient.invalidateQueries({ queryKey: ['paymentRequestStatusCounts'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['orderPaymentStatuses'] });
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
      queryClient.invalidateQueries({ queryKey: ['paymentRequestStatusCounts'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['orderPaymentStatuses'] });
    },
  });
};

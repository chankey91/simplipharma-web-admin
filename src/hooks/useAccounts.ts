import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccountLedger,
  createAccountVoucher,
  deleteAccountVoucher,
  getAccountLedgers,
  getAccountVouchers,
  getAccountVouchersUpTo,
  updateAccountLedgerOpening,
  type CreateAccountVoucherInput,
} from '../services/accounts';

export const useAccountLedgers = () =>
  useQuery({
    queryKey: ['accountLedgers'],
    queryFn: getAccountLedgers,
    staleTime: 5 * 60 * 1000,
  });

export const useAccountVouchers = (fromDate: Date, toDate: Date, enabled = true) =>
  useQuery({
    queryKey: ['accountVouchers', fromDate.toISOString().slice(0, 10), toDate.toISOString().slice(0, 10)],
    queryFn: () => getAccountVouchers(fromDate, toDate),
    enabled,
    staleTime: 30 * 1000,
  });

export const useAccountVouchersUpTo = (toDate: Date, enabled = true) =>
  useQuery({
    queryKey: ['accountVouchersUpTo', toDate.toISOString().slice(0, 10)],
    queryFn: () => getAccountVouchersUpTo(toDate),
    enabled,
    staleTime: 30 * 1000,
  });

export const useCreateAccountLedger = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAccountLedger,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountLedgers'] });
    },
  });
};

export const useUpdateAccountLedgerOpening = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ledgerId, openingBalance }: { ledgerId: string; openingBalance: number }) =>
      updateAccountLedgerOpening(ledgerId, openingBalance),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountLedgers'] });
    },
  });
};

export const useCreateAccountVoucher = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountVoucherInput) => createAccountVoucher(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountVouchers'] });
      queryClient.invalidateQueries({ queryKey: ['accountVouchersUpTo'] });
      queryClient.invalidateQueries({ queryKey: ['payablePurchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseInvoice'] });
      queryClient.invalidateQueries({ queryKey: ['vendorPurchaseInvoices'] });
      queryClient.invalidateQueries({ queryKey: ['receivableOrders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useDeleteAccountVoucher = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAccountVoucher,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountVouchers'] });
      queryClient.invalidateQueries({ queryKey: ['accountVouchersUpTo'] });
    },
  });
};

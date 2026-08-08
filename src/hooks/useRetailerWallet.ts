import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRetailerWalletSummary } from '../services/retailerWallet';

export function useRetailerWallet(retailerId: string | null | undefined, open: boolean) {
  const rid = retailerId?.trim() || '';
  return useQuery({
    queryKey: ['retailerWallet', rid],
    queryFn: () => getRetailerWalletSummary(rid),
    enabled: open && !!rid,
    staleTime: 0,
  });
}

export function useInvalidateRetailerWallet() {
  const queryClient = useQueryClient();
  return (retailerId?: string) => {
    if (retailerId) {
      void queryClient.invalidateQueries({ queryKey: ['retailerWallet', retailerId] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ['retailerWallet'] });
    }
    void queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
    void queryClient.invalidateQueries({ queryKey: ['debitNotes'] });
    void queryClient.invalidateQueries({ queryKey: ['creditNotesSearch'] });
    void queryClient.invalidateQueries({ queryKey: ['debitNotesSearch'] });
    void queryClient.invalidateQueries({ queryKey: ['creditNoteTotals'] });
    void queryClient.invalidateQueries({ queryKey: ['debitNoteTotals'] });
    void queryClient.invalidateQueries({ queryKey: ['storeNoteStats'] });
  };
}

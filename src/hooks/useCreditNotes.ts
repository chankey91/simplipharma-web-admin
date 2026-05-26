import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllCreditNotes,
  getCreditNoteById,
  issueCreditNoteForReturnRequestId,
} from '../services/creditNotes';

import { getAllDebitNotes } from '../services/debitNotes';

export const useDebitNotes = () => {
  return useQuery({
    queryKey: ['debitNotes'],
    queryFn: getAllDebitNotes,
  });
};

export const useCreditNotes = () => {
  return useQuery({
    queryKey: ['creditNotes'],
    queryFn: getAllCreditNotes,
  });
};

export const useCreditNote = (creditNoteId: string | undefined) => {
  return useQuery({
    queryKey: ['creditNote', creditNoteId],
    queryFn: () => getCreditNoteById(creditNoteId!),
    enabled: Boolean(creditNoteId),
  });
};

export const useIssueCreditNoteForReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: issueCreditNoteForReturnRequestId,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditNotes'] });
      queryClient.invalidateQueries({ queryKey: ['orderReturns'] });
    },
  });
};

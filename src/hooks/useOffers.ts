import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addOffer, deleteOffer, getAllOffers, updateOffer, type OfferInput } from '../services/offers';

export const useOffers = () => {
  return useQuery({
    queryKey: ['offers'],
    queryFn: getAllOffers,
    staleTime: 5 * 60 * 1000,
  });
};

export const useAddOffer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OfferInput) => addOffer(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
};

export const useUpdateOffer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, input }: { offerId: string; input: OfferInput }) =>
      updateOffer(offerId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
};

export const useDeleteOffer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => deleteOffer(offerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
};

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPendingOrderEmailSettings,
  savePendingOrderEmailSettings,
  type PendingOrderEmailSettings,
} from '../services/pendingOrderEmailSettings';

export function usePendingOrderEmailSettings() {
  return useQuery({
    queryKey: ['pendingOrderEmailSettings'],
    queryFn: getPendingOrderEmailSettings,
  });
}

export function useSavePendingOrderEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: PendingOrderEmailSettings) => savePendingOrderEmailSettings(settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pendingOrderEmailSettings'] });
    },
  });
}

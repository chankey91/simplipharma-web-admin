import { useQuery } from '@tanstack/react-query';
import { getExpiryReturnRequests } from '../services/expiryReturns';

export const useExpiryReturns = () => {
  return useQuery({
    queryKey: ['expiryReturns', 'all'],
    queryFn: () => getExpiryReturnRequests(),
  });
};

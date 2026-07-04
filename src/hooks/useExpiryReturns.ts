import { useQuery } from '@tanstack/react-query';
import { getExpiryReturnRequests, getExpiryReturnsInRange } from '../services/expiryReturns';
import { marginPeriodRange, type MarginPeriodFilter } from '../utils/marginPeriod';

export const useExpiryReturns = () => {
  return useQuery({
    queryKey: ['expiryReturns', 'all'],
    queryFn: () => getExpiryReturnRequests(),
  });
};

/** Approved/paid expiry returns in a margin-report period. */
export const useExpiryReturnsInPeriod = (period: MarginPeriodFilter) => {
  const range = marginPeriodRange(period);
  return useQuery({
    queryKey: ['expiryReturnsInPeriod', period, range?.startMs ?? null, range?.endMs ?? null],
    queryFn: () =>
      range ? getExpiryReturnsInRange(range.startMs, range.endMs) : getExpiryReturnRequests(),
  });
};

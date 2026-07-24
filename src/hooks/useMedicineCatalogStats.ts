import { useCallback, useEffect, useState } from 'react';
import { searchMedicinesCatalog } from '../services/medicineSearch';

export type MedicineCatalogStats = {
  productCount: number;
  lowStock: number;
  expiredCount: number;
  expiringCount: number;
};

const emptyStats: MedicineCatalogStats = {
  productCount: 0,
  lowStock: 0,
  expiredCount: 0,
  expiringCount: 0,
};

/**
 * Dashboard / summary counts via Typesense — never downloads the medicine master list.
 */
export function useMedicineCatalogStats() {
  const [stats, setStats] = useState<MedicineCatalogStats>(emptyStats);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const [all, low, expired, expiring] = await Promise.all([
        searchMedicinesCatalog('', { browse: true, hydrate: false, limit: 1, page: 1 }),
        searchMedicinesCatalog('', {
          browse: true,
          hydrate: false,
          limit: 1,
          page: 1,
          stockFilter: 'Low',
        }),
        searchMedicinesCatalog('', {
          browse: true,
          hydrate: false,
          limit: 1,
          page: 1,
          expiryFilter: 'expired',
        }),
        searchMedicinesCatalog('', {
          browse: true,
          hydrate: false,
          limit: 1,
          page: 1,
          expiryFilter: 'expiring',
        }),
      ]);
      setStats({
        productCount: all.found,
        lowStock: low.found,
        expiredCount: expired.found,
        expiringCount: expiring.found,
      });
      if (all.source === 'error') setIsError(true);
    } catch {
      setIsError(true);
      setStats(emptyStats);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data: stats, isLoading, isError, refetch };
}

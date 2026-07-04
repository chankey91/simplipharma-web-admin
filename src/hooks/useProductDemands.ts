import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  getAllProductDemands,
  getProductDemandById,
  getProductDemandsPage,
  getProductDemandsForOrder,
  getProductDemandsByIds,
  fulfillProductDemand,
  rejectProductDemand,
  migrateProductDemandsToMedicines,
  ProductDemandsPageParams,
} from '../services/productDemands';
import {
  searchProductDemandsTypesense,
  ProductDemandRow,
} from '../services/productDemandSearch';
import { TypesenseSearchParams, TypesenseSearchResult } from '../services/typesenseSearch';
import { ProductDemandStatus } from '../types';

/** Full collection load — only for explicit fallback / one-off admin actions. */
export const useProductDemands = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['productDemands'],
    queryFn: getAllProductDemands,
    enabled: options?.enabled ?? true,
  });
};

/** Server-side search via Typesense (search + filter + sort + pagination). */
export const useProductDemandsSearch = (
  params: TypesenseSearchParams,
  options?: { enabled?: boolean }
) => {
  return useQuery<TypesenseSearchResult<ProductDemandRow>>({
    queryKey: ['productDemandsSearch', params],
    queryFn: () => searchProductDemandsTypesense(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

/** Status-scoped paginated Firestore fallback when Typesense is unavailable. */
export const useProductDemandsPage = (
  params: ProductDemandsPageParams,
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['productDemandsPage', params],
    queryFn: () => getProductDemandsPage(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
};

export const useProductDemand = (demandId: string) => {
  return useQuery({
    queryKey: ['productDemand', demandId],
    queryFn: () => getProductDemandById(demandId),
    enabled: !!demandId,
  });
};

/** Scoped to one order (+ line demand ids) for OrderDetails instead of full collection. */
export const useProductDemandsForOrder = (orderId: string, lineDemandIds: string[]) => {
  const key = [...lineDemandIds].sort().join(',');
  return useQuery({
    queryKey: ['productDemands', 'order', orderId, key],
    queryFn: () => getProductDemandsForOrder(orderId, lineDemandIds),
    enabled: !!orderId || lineDemandIds.length > 0,
  });
};

/** Fetch full demand docs (imageUrl, notes, etc.) for visible Typesense row ids. */
export const useProductDemandDetailsByIds = (ids: string[]) => {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['productDemandDetails', key],
    queryFn: () => getProductDemandsByIds(ids),
    enabled: ids.length > 0,
  });
};

const invalidateProductDemandQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ['productDemands'] });
  queryClient.invalidateQueries({ queryKey: ['productDemandsSearch'] });
  queryClient.invalidateQueries({ queryKey: ['productDemandsPage'] });
  queryClient.invalidateQueries({ queryKey: ['productDemand'] });
  queryClient.invalidateQueries({ queryKey: ['productDemandDetails'] });
};

export const useFulfillProductDemand = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      demandId,
      medicineId,
      quantity,
      fulfillmentNote,
      purchaseInvoiceId,
    }: {
      demandId: string;
      medicineId?: string;
      quantity?: number;
      fulfillmentNote?: string;
      purchaseInvoiceId?: string;
    }) =>
      fulfillProductDemand(demandId, {
        medicineId,
        quantity,
        fulfillmentNote,
        purchaseInvoiceId,
      }),
    onSuccess: (data) => {
      invalidateProductDemandQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['ordersSearch'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      if (data?.orderId) {
        queryClient.invalidateQueries({ queryKey: ['order', data.orderId] });
        queryClient.invalidateQueries({ queryKey: ['productDemands', 'order', data.orderId] });
      }
    },
  });
};

export const useMigrateProductDemandsToMedicines = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options?: { includePending?: boolean; repairOrders?: boolean }) =>
      migrateProductDemandsToMedicines(options),
    onSuccess: () => {
      invalidateProductDemandQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['medicines'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
};

export const useRejectProductDemand = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ demandId, reason }: { demandId: string; reason: string }) =>
      rejectProductDemand(demandId, reason),
    onSuccess: () => {
      invalidateProductDemandQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
};

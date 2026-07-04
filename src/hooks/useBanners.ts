import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllBanners,
  addBanner,
  updateBanner,
  deleteBanner,
  Banner,
} from '../services/banners';

export const useBanners = () => {
  return useQuery({
    queryKey: ['banners'],
    queryFn: getAllBanners,
    // Reference data — cache longer; mutations invalidate ['banners'].
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

export const useAddBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bannerData: Omit<Banner, 'id'>) => addBanner(bannerData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

export const useUpdateBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      bannerId,
      bannerData,
      removeImageUrl,
    }: {
      bannerId: string;
      bannerData: Partial<Banner>;
      removeImageUrl?: boolean;
    }) => updateBanner(bannerId, bannerData, { removeImageUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

export const useDeleteBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bannerId: string) => deleteBanner(bannerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

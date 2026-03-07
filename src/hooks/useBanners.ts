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
    mutationFn: ({ bannerId, bannerData }: { bannerId: string; bannerData: Partial<Banner> }) =>
      updateBanner(bannerId, bannerData),
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

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Grid,
  Chip,
  Alert,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Campaign,
} from '@mui/icons-material';
import { useBanners, useAddBanner, useUpdateBanner, useDeleteBanner } from '../hooks/useBanners';
import { Banner } from '../services/banners';
import { Loading } from '../components/Loading';

const COLOR_OPTIONS = [
  { name: 'Red', value: '#FF6B6B' },
  { name: 'Teal', value: '#4ECDC4' },
  { name: 'Yellow', value: '#FFD93D' },
  { name: 'Green', value: '#95E1D3' },
  { name: 'Purple', value: '#9B59B6' },
  { name: 'Orange', value: '#E67E22' },
  { name: 'Blue', value: '#3498DB' },
  { name: 'Pink', value: '#FFC0CB' },
];

const ICON_OPTIONS = [
  'gift', 'flash', 'star', 'heart', 'rocket', 'trophy',
  'medal', 'flame', 'sparkles', 'notifications', 'megaphone',
];

const ICON_MAP: Record<string, string> = {
  gift: '🎁',
  flash: '⚡',
  star: '⭐',
  heart: '❤️',
  rocket: '🚀',
  trophy: '🏆',
  medal: '🏅',
  flame: '🔥',
  sparkles: '✨',
  notifications: '🔔',
  megaphone: '📢',
};

export const BannersPage: React.FC = () => {
  const { data: banners, isLoading, error } = useBanners();
  const addBannerMutation = useAddBanner();
  const updateBannerMutation = useUpdateBanner();
  const deleteBannerMutation = useDeleteBanner();

  const [openDialog, setOpenDialog] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    color: '#FF6B6B',
    icon: 'gift',
    isActive: true,
    order: 1,
    linkTo: '',
  });

  const handleOpenCreate = () => {
    setEditingBanner(null);
    setFormData({
      title: '',
      subtitle: '',
      color: '#FF6B6B',
      icon: 'gift',
      isActive: true,
      order: (banners?.length ?? 0) + 1,
      linkTo: '',
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (banner: Banner) => {
    setEditingBanner(banner);
    setFormData({
      title: banner.title,
      subtitle: banner.subtitle,
      color: banner.color,
      icon: banner.icon,
      isActive: banner.isActive,
      order: banner.order ?? 1,
      linkTo: banner.linkTo ?? '',
    });
    setOpenDialog(true);
  };

  const handleClose = () => {
    setOpenDialog(false);
    setEditingBanner(null);
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.subtitle.trim()) {
      alert('Please fill in title and subtitle');
      return;
    }

    const bannerData = {
      title: formData.title.trim(),
      subtitle: formData.subtitle.trim(),
      color: formData.color,
      icon: formData.icon,
      isActive: formData.isActive,
      order: formData.order,
      linkTo: formData.linkTo.trim() || undefined,
    };

    try {
      if (editingBanner) {
        await updateBannerMutation.mutateAsync({
          bannerId: editingBanner.id,
          bannerData,
        });
        alert('Banner updated successfully');
      } else {
        await addBannerMutation.mutateAsync(bannerData);
        alert('Banner added successfully');
      }
      handleClose();
    } catch (err: any) {
      alert(err.message || 'Failed to save banner');
    }
  };

  const handleDelete = async (banner: Banner) => {
    if (!confirm(`Are you sure you want to delete "${banner.title}"?`)) return;
    try {
      await deleteBannerMutation.mutateAsync(banner.id);
      alert('Banner deleted successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to delete banner');
    }
  };

  if (isLoading) return <Loading message="Loading banners..." />;
  if (error) return <Alert severity="error">Failed to load banners</Alert>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold">
            Banner Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {banners?.length ?? 0} total banners
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleOpenCreate}
        >
          Add Banner
        </Button>
      </Box>

      {(!banners || banners.length === 0) ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <Campaign sx={{ fontSize: 60, color: 'grey.400', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              No banners yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Create your first promotional banner for the mobile app home screen
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleOpenCreate}
              sx={{ mt: 2 }}
            >
              Add Banner
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {banners?.map((banner) => (
            <Grid item xs={12} sm={6} md={4} key={banner.id}>
              <Card
                sx={{
                  borderLeft: 4,
                  borderLeftColor: banner.color,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{ICON_MAP[banner.icon] || '📢'}</span>
                      {banner.title}
                    </Typography>
                    {banner.isActive && (
                      <Chip label="Active" color="success" size="small" />
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {banner.subtitle}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Order: {banner.order}
                  </Typography>
                </CardContent>
                <CardActions>
                  <IconButton size="small" onClick={() => handleOpenEdit(banner)} color="primary">
                    <Edit />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(banner)} color="error">
                    <Delete />
                  </IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={openDialog} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editingBanner ? 'Edit Banner' : 'Add New Banner'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Title *"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Flash Sale!"
              fullWidth
            />
            <TextField
              label="Subtitle *"
              value={formData.subtitle}
              onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
              placeholder="e.g., Up to 50% OFF on selected items"
              fullWidth
            />

            <Typography variant="subtitle2" sx={{ mt: 2 }}>Background Color</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {COLOR_OPTIONS.map((opt) => (
                <Box
                  key={opt.value}
                  onClick={() => setFormData({ ...formData, color: opt.value })}
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: opt.value,
                    border: formData.color === opt.value ? 3 : 1,
                    borderColor: formData.color === opt.value ? 'primary.main' : 'grey.300',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Box>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>Icon</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {ICON_OPTIONS.map((icon) => (
                <Box
                  key={icon}
                  onClick={() => setFormData({ ...formData, icon })}
                  sx={{
                    width: 44,
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 1,
                    bgcolor: formData.icon === icon ? 'primary.light' : 'grey.100',
                    border: formData.icon === icon ? 2 : 1,
                    borderColor: formData.icon === icon ? 'primary.main' : 'grey.300',
                    cursor: 'pointer',
                    fontSize: 24,
                  }}
                >
                  {ICON_MAP[icon] || '📢'}
                </Box>
              ))}
            </Box>

            <TextField
              label="Display Order"
              type="number"
              value={formData.order}
              onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 1 })}
              inputProps={{ min: 1 }}
              fullWidth
            />
            <TextField
              label="Link To (Optional)"
              value={formData.linkTo}
              onChange={(e) => setFormData({ ...formData, linkTo: e.target.value })}
              placeholder="e.g., MedicineList"
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  color="primary"
                />
              }
              label={formData.isActive ? 'Visible on home screen' : 'Hidden from users'}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={
              addBannerMutation.isPending ||
              updateBannerMutation.isPending ||
              !formData.title.trim() ||
              !formData.subtitle.trim()
            }
          >
            {editingBanner ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

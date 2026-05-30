import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  CardMedia,
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
  CircularProgress,
  Collapse,
  Link,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Campaign,
  PhotoCamera,
} from '@mui/icons-material';
import { useBanners, useAddBanner, useUpdateBanner, useDeleteBanner } from '../hooks/useBanners';
import { Banner } from '../services/banners';
import { uploadBannerImage } from '../services/bannerImages';
import { Loading } from '../components/Loading';
import { useAppDialog } from '../context/AppDialogProvider';

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
  const { alert, confirm, prompt } = useAppDialog();

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
    imageUrl: '',
  });
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [showTextStyleFields, setShowTextStyleFields] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageUrlTrim = formData.imageUrl.trim();
  const hasImageSource = Boolean(pendingImageFile || imageUrlTrim);

  useEffect(() => {
    if (!pendingImageFile) {
      setFilePreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(pendingImageFile);
    setFilePreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pendingImageFile]);

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
      imageUrl: '',
    });
    setPendingImageFile(null);
    setShowTextStyleFields(true);
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
      imageUrl: banner.imageUrl ?? '',
    });
    setPendingImageFile(null);
    const hasImg = Boolean(banner.imageUrl?.trim());
    const hasText = Boolean(banner.title?.trim() || banner.subtitle?.trim());
    setShowTextStyleFields(!hasImg || hasText);
    setOpenDialog(true);
  };

  const handleClose = () => {
    setOpenDialog(false);
    setEditingBanner(null);
    setPendingImageFile(null);
    setShowTextStyleFields(false);
  };

  const handleSave = async () => {
    const trimmedTitle = formData.title.trim();
    const trimmedSubtitle = formData.subtitle.trim();
    const trimmedUrl = formData.imageUrl.trim();
    const willHaveImage =
      Boolean(pendingImageFile || trimmedUrl) ||
      Boolean(
        editingBanner?.imageUrl &&
          trimmedUrl.length > 0 &&
          trimmedUrl === (editingBanner.imageUrl ?? '').trim()
      );

    if (!willHaveImage && (!trimmedTitle || !trimmedSubtitle)) {
      await alert('Add a banner image, or fill in both title and subtitle for a text-only banner.', { severity: 'warning' });
      return;
    }

    let removeImageUrl = false;
    const bannerData: Omit<Banner, 'id'> = {
      title: trimmedTitle,
      subtitle: trimmedSubtitle,
      color: formData.color,
      icon: formData.icon,
      isActive: formData.isActive,
      order: formData.order,
      linkTo: formData.linkTo.trim() || undefined,
    };

    try {
      if (pendingImageFile) {
        setUploadingImage(true);
        try {
          bannerData.imageUrl = await uploadBannerImage(pendingImageFile);
        } finally {
          setUploadingImage(false);
        }
      } else if (trimmedUrl) {
        bannerData.imageUrl = trimmedUrl;
      } else if (editingBanner?.imageUrl) {
        removeImageUrl = true;
      }

      if (editingBanner) {
        await updateBannerMutation.mutateAsync({
          bannerId: editingBanner.id,
          bannerData,
          removeImageUrl,
        });
        await alert('Banner updated successfully', { severity: 'success' });
      } else {
        await addBannerMutation.mutateAsync(bannerData);
        await alert('Banner added successfully', { severity: 'success' });
      }
      handleClose();
    } catch (err: any) {
      await alert(err.message || 'Failed to save banner', { severity: 'error' });
    }
  };

  const handleDelete = async (banner: Banner) => {
    const label = banner.title.trim() || (banner.imageUrl ? 'this image banner' : 'this banner');
    if (!(await confirm(`Are you sure you want to delete "${label}"?`, { destructive: true }))) return;
    try {
      await deleteBannerMutation.mutateAsync(banner.id);
      await alert('Banner deleted successfully', { severity: 'success' });
    } catch (err: any) {
      await alert(err.message || 'Failed to delete banner', { severity: 'error' });
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
                {banner.imageUrl ? (
                  <CardMedia
                    component="img"
                    height="140"
                    image={banner.imageUrl}
                    alt=""
                    sx={{ objectFit: 'cover' }}
                  />
                ) : null}
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{ICON_MAP[banner.icon] || '📢'}</span>
                      {banner.title.trim() || (banner.imageUrl ? 'Image banner' : 'Untitled')}
                    </Typography>
                    {banner.isActive && (
                      <Chip label="Active" color="success" size="small" />
                    )}
                  </Box>
                  {Boolean(banner.subtitle.trim() || !banner.imageUrl) && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {banner.subtitle.trim() || 'No subtitle'}
                    </Typography>
                  )}
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
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Banner image
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Upload a file (max 5&nbsp;MB) or paste an HTTPS URL. When an image is set, title, subtitle, color, and icon are optional—the app shows your artwork full width.
              </Typography>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPendingImageFile(f);
                    setShowTextStyleFields(false);
                  }
                  e.target.value = '';
                }}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PhotoCamera />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload image
                </Button>
                {pendingImageFile ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setPendingImageFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      if (!formData.imageUrl.trim()) setShowTextStyleFields(true);
                    }}
                  >
                    Clear file
                  </Button>
                ) : null}
              </Box>
              <TextField
                label="Image URL (optional)"
                value={formData.imageUrl}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData({ ...formData, imageUrl: v });
                  const t = v.trim();
                  if (!t && !pendingImageFile) setShowTextStyleFields(true);
                  else if (t) setShowTextStyleFields(false);
                }}
                placeholder="https://..."
                fullWidth
                size="small"
                sx={{ mt: 1.5 }}
                disabled={Boolean(pendingImageFile)}
                helperText={pendingImageFile ? 'Remove the selected file to edit URL instead.' : undefined}
              />
              {(filePreviewUrl || formData.imageUrl.trim()) && (
                <Box
                  sx={{
                    mt: 1.5,
                    borderRadius: 1,
                    overflow: 'hidden',
                    border: 1,
                    borderColor: 'divider',
                    maxHeight: 200,
                    bgcolor: 'grey.100',
                  }}
                >
                  <Box
                    component="img"
                    src={filePreviewUrl || formData.imageUrl.trim()}
                    alt="Banner preview"
                    sx={{ width: '100%', maxHeight: 200, objectFit: 'contain', display: 'block' }}
                  />
                </Box>
              )}
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

            {hasImageSource ? (
              <Box>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => setShowTextStyleFields((v) => !v)}
                  sx={{ cursor: 'pointer', textAlign: 'left' }}
                >
                  {showTextStyleFields ? 'Hide optional title & styling' : 'Add optional title, subtitle, or colors'}
                </Link>
                <Collapse in={showTextStyleFields}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                    <TextField
                      label="Title (optional)"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Shown on top of the image if set"
                      fullWidth
                    />
                    <TextField
                      label="Subtitle (optional)"
                      value={formData.subtitle}
                      onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                      fullWidth
                    />
                    <Typography variant="subtitle2">Background Color (fallback / overlay)</Typography>
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
                    <Typography variant="subtitle2">Icon</Typography>
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
                  </Box>
                </Collapse>
              </Box>
            ) : (
              <>
                <TextField
                  label="Title"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Flash Sale!"
                  fullWidth
                />
                <TextField
                  label="Subtitle"
                  required
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                  placeholder="e.g., Up to 50% OFF on selected items"
                  fullWidth
                />
                <Typography variant="subtitle2">Background Color</Typography>
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
                <Typography variant="subtitle2">Icon</Typography>
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
              </>
            )}

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
              uploadingImage ||
              (!hasImageSource && (!formData.title.trim() || !formData.subtitle.trim()))
            }
            startIcon={uploadingImage ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {editingBanner ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

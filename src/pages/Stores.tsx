import React, { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  FormControlLabel,
  Alert,
  Grid,
  Divider,
} from '@mui/material';
import {
  Edit,
  Search,
  Add,
  CheckCircle,
  Cancel,
  Save,
  VpnKey,
  MyLocation,
  PhotoCamera,
} from '@mui/icons-material';
import { useStores, useUpdateStore, useToggleStoreStatus, useCreateStore } from '../hooks/useStores';
import { User } from '../types';
import { Loading } from '../components/Loading';

const generatePassword = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

export const StoresPage: React.FC = () => {
  const { data: stores, isLoading, error } = useStores();
  const updateStoreMutation = useUpdateStore();
  const createStoreMutation = useCreateStore();
  const toggleStatusMutation = useToggleStoreStatus();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [editingStore, setEditingStore] = useState<User | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  
  const [formData, setFormData] = useState({
    displayName: '',
    shopName: '',
    phoneNumber: '',
    address: '',
    email: '',
    licenceNumber: '',
    ownerName: '',
    licenceHolderName: '',
    pan: '',
    gst: '',
    isActive: true,
    latitude: '',
    longitude: '',
    shopImage: ''
  });

  const filteredStores = stores?.filter(store =>
    store.shopName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleOpenCreate = () => {
    setEditingStore(null);
    const newPassword = generatePassword();
    setGeneratedPassword(newPassword);
    setFormData({
      displayName: '',
      shopName: '',
      phoneNumber: '',
      address: '',
      email: '',
      licenceNumber: '',
      ownerName: '',
      licenceHolderName: '',
      pan: '',
      gst: '',
      isActive: true,
      latitude: '',
      longitude: '',
      shopImage: ''
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (store: User) => {
    setEditingStore(store);
    setGeneratedPassword('');
    setFormData({
      displayName: store.displayName || '',
      shopName: store.shopName || '',
      phoneNumber: store.phoneNumber || '',
      address: store.address || '',
      email: store.email || '',
      licenceNumber: store.licenceNumber || '',
      ownerName: store.ownerName || '',
      licenceHolderName: store.licenceHolderName || '',
      pan: store.pan || '',
      gst: store.gst || '',
      isActive: store.isActive !== false,
      latitude: store.location?.latitude?.toString() || '',
      longitude: store.location?.longitude?.toString() || '',
      shopImage: store.shopImage || ''
    });
    setOpenDialog(true);
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setFormData({
          ...formData,
          latitude: position.coords.latitude.toString(),
          longitude: position.coords.longitude.toString()
        });
      });
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size (max 2MB)
      if (file.size > 2 * 1024 * 1024) {
        alert('Image size should be less than 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setFormData({ ...formData, shopImage: base64String });
      };
      reader.onerror = () => {
        alert('Error reading image file');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    const storeData: any = {
      displayName: formData.displayName,
      shopName: formData.shopName,
      phoneNumber: formData.phoneNumber,
      address: formData.address,
      email: formData.email,
      licenceNumber: formData.licenceNumber,
      ownerName: formData.ownerName,
      licenceHolderName: formData.licenceHolderName,
      pan: formData.pan,
      gst: formData.gst,
      isActive: formData.isActive,
      shopImage: formData.shopImage,
      location: formData.latitude && formData.longitude ? {
        latitude: parseFloat(formData.latitude),
        longitude: parseFloat(formData.longitude)
      } : undefined
    };

    try {
      if (editingStore) {
        await updateStoreMutation.mutateAsync({
          storeId: editingStore.id,
          data: storeData
        });
      } else {
        // In creation, we'd also include the password to be sent to email
        // For now we just add it to the data or log it
        console.log('Sending password to store email:', formData.email, generatedPassword);
        await createStoreMutation.mutateAsync({
          ...storeData,
          initialPassword: generatedPassword // This would be used by a Cloud Function
        });
      }
      setOpenDialog(false);
    } catch (error) {
      console.error('Error saving store:', error);
    }
  };

  if (isLoading) return <Loading message="Loading stores..." />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Store Management</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add Store
        </Button>
      </Box>

      <TextField
        fullWidth
        placeholder="Search stores..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Shop Name</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>Licence No.</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredStores.map((store) => (
              <TableRow key={store.id}>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">{store.shopName}</Typography>
                  <Typography variant="caption" color="textSecondary">{store.email}</Typography>
                </TableCell>
                <TableCell>{store.ownerName || store.displayName || 'N/A'}</TableCell>
                <TableCell>{store.licenceNumber || 'N/A'}</TableCell>
                <TableCell>{store.phoneNumber || 'N/A'}</TableCell>
                <TableCell>
                  {store.location ? (
                    <Chip label="Geo-tagged" size="small" color="primary" variant="outlined" />
                  ) : (
                    <Chip label="No Location" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={store.isActive !== false ? 'Active' : 'Inactive'}
                    color={store.isActive !== false ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpenEdit(store)} color="primary">
                    <Edit />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => toggleStatusMutation.mutate({ storeId: store.id, isActive: !store.isActive })}
                    color={store.isActive !== false ? 'success' : 'default'}
                  >
                    {store.isActive !== false ? <CheckCircle /> : <Cancel />}
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingStore ? 'Edit Store' : 'Add New Store'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {!editingStore && (
              <Alert severity="info" sx={{ mb: 3 }} icon={<VpnKey />}>
                A default password will be generated automatically: <strong>{generatedPassword}</strong>
              </Alert>
            )}
            
            <Typography variant="subtitle2" gutterBottom>Basic Information</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Store Name"
                  required
                  value={formData.shopName}
                  onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Email Address"
                  required
                  disabled={!!editingStore}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Number"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Owner Name"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                />
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Licence & Tax Information</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Licence Number"
                  value={formData.licenceNumber}
                  onChange={(e) => setFormData({ ...formData, licenceNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Licence Holder Name"
                  value={formData.licenceHolderName}
                  onChange={(e) => setFormData({ ...formData, licenceHolderName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="PAN"
                  value={formData.pan}
                  onChange={(e) => setFormData({ ...formData, pan: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="GST Number"
                  value={formData.gst}
                  onChange={(e) => setFormData({ ...formData, gst: e.target.value })}
                />
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Location & Media</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Shop Address"
                  multiline
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Latitude"
                  value={formData.latitude}
                  onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Longitude"
                  value={formData.longitude}
                  onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<MyLocation />}
                  onClick={handleGetCurrentLocation}
                  sx={{ height: '56px' }}
                >
                  Get Current Location
                </Button>
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="outlined"
                  component="label"
                  startIcon={<PhotoCamera />}
                  fullWidth
                >
                  Upload Shop Image
                  <input 
                    type="file" 
                    hidden 
                    accept="image/*" 
                    onChange={handleImageUpload}
                  />
                </Button>
                {formData.shopImage && (
                  <Box sx={{ mt: 2, textAlign: 'center' }}>
                    <img 
                      src={formData.shopImage} 
                      alt="Shop preview" 
                      style={{ 
                        maxWidth: '100%', 
                        maxHeight: 200, 
                        borderRadius: 8,
                        border: '1px solid #ddd'
                      }} 
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => setFormData({ ...formData, shopImage: '' })}
                      sx={{ mt: 1 }}
                    >
                      Remove Image
                    </Button>
                  </Box>
                )}
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={createStoreMutation.isPending || updateStoreMutation.isPending}
          >
            {editingStore ? 'Update Store' : 'Create Store'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

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
} from '@mui/material';
import { Edit, Search, Add, CheckCircle, Cancel, Save } from '@mui/icons-material';
import { useStores, useUpdateStore, useToggleStoreStatus } from '../hooks/useStores';
import { User } from '../types';
import { Loading } from '../components/Loading';

export const StoresPage: React.FC = () => {
  const { data: stores, isLoading, error } = useStores();
  const updateStore = useUpdateStore();
  const toggleStatus = useToggleStoreStatus();
  const [searchTerm, setSearchTerm] = useState('');
  const [editingStore, setEditingStore] = useState<User | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    shopName: '',
    phoneNumber: '',
    address: '',
    email: '',
    isActive: true,
  });

  const filteredStores = stores?.filter(store =>
    store.shopName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleToggleStatus = async (storeId: string, isActive: boolean) => {
    try {
      await toggleStatus.mutateAsync({ storeId, isActive });
    } catch (error) {
      console.error('Error toggling status:', error);
    }
  };

  const handleOpenEdit = (store: User) => {
    setEditingStore(store);
    setFormData({
      displayName: store.displayName || '',
      shopName: store.shopName || '',
      phoneNumber: store.phoneNumber || '',
      address: store.address || '',
      email: store.email || '',
      isActive: store.isActive !== false,
    });
    setOpenDialog(true);
  };

  const handleOpenCreate = () => {
    setEditingStore(null);
    setFormData({
      displayName: '',
      shopName: '',
      phoneNumber: '',
      address: '',
      email: '',
      isActive: true,
    });
    setOpenDialog(true);
  };

  const handleSave = async () => {
    if (!editingStore) {
      // Create new store - Note: This requires Firebase Admin SDK for user creation
      alert('Store creation requires Firebase Admin SDK. Please use the mobile app to create stores.');
      return;
    }

    try {
      await updateStore.mutateAsync({
        storeId: editingStore.id,
        data: {
          displayName: formData.displayName,
          shopName: formData.shopName,
          phoneNumber: formData.phoneNumber,
          address: formData.address,
          isActive: formData.isActive,
        },
      });
      setOpenDialog(false);
    } catch (error) {
      console.error('Error saving store:', error);
    }
  };

  if (isLoading) {
    return <Loading message="Loading stores..." />;
  }

  if (error) {
    return <Alert severity="error">Error loading stores. Please try again.</Alert>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Medical Stores</Typography>
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
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredStores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary">No stores found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredStores.map((store) => (
                <TableRow key={store.id}>
                  <TableCell>{store.shopName || 'N/A'}</TableCell>
                  <TableCell>{store.displayName || 'N/A'}</TableCell>
                  <TableCell>{store.email}</TableCell>
                  <TableCell>{store.phoneNumber || 'N/A'}</TableCell>
                  <TableCell>{store.address || 'N/A'}</TableCell>
                  <TableCell>
                    <Chip
                      label={store.isActive !== false ? 'Active' : 'Inactive'}
                      color={store.isActive !== false ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => handleToggleStatus(store.id, !store.isActive)}
                      title={store.isActive !== false ? 'Deactivate' : 'Activate'}
                    >
                      {store.isActive !== false ? <CheckCircle /> : <Cancel />}
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleOpenEdit(store)}
                      title="Edit"
                    >
                      <Edit />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit/Create Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingStore ? 'Edit Store' : 'Create New Store'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={!!editingStore}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Display Name"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Shop Name"
                value={formData.shopName}
                onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Phone Number"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                multiline
                rows={3}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  />
                }
                label="Active"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={updateStore.isPending}
            startIcon={<Save />}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};


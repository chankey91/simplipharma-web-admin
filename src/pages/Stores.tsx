import React, { useEffect, useMemo, useState } from 'react';
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
  Pagination,
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
  History,
  LockReset,
} from '@mui/icons-material';
import { RetailerVisitLogDialog } from '../components/RetailerVisitLogDialog';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useStores, useUpdateStore, useToggleStoreStatus, useCreateStore, useSendRetailerPasswordResetEmail } from '../hooks/useStores';
import { useCreditNotes, useDebitNotes } from '../hooks/useCreditNotes';
import { getSalesOfficers } from '../services/salesOfficers';
import { User } from '../types';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function NoteTotalCell({ stats }: { stats?: { total: number; count: number } }) {
  const total = stats?.total ?? 0;
  const count = stats?.count ?? 0;
  return (
    <Box>
      <Typography variant="body2" fontWeight={600}>
        {formatCurrency(total)}
      </Typography>
      {count > 0 ? (
        <Typography variant="caption" color="text.secondary">
          {count} note{count !== 1 ? 's' : ''}
        </Typography>
      ) : null}
    </Box>
  );
}

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
  const { data: creditNotes } = useCreditNotes();
  const { data: debitNotes } = useDebitNotes();
  const updateStoreMutation = useUpdateStore();
  const createStoreMutation = useCreateStore();
  const toggleStatusMutation = useToggleStoreStatus();
  const resetPasswordMutation = useSendRetailerPasswordResetEmail();
  const { alert, confirm, prompt } = useAppDialog();

  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [editingStore, setEditingStore] = useState<User | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  
  const [salesOfficers, setSalesOfficers] = useState<User[]>([]);
  const [visitLogStore, setVisitLogStore] = useState<User | null>(null);
  const { sortKey, sortDirection, requestSort } = useTableSort('shopName', 'asc');

  const salesOfficerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    salesOfficers.forEach((so) => {
      m[so.id] = so.displayName || so.email || so.id;
    });
    return m;
  }, [salesOfficers]);

  const creditNoteStatsByRetailerId = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const note of creditNotes ?? []) {
      const prev = map.get(note.retailerId) ?? { total: 0, count: 0 };
      map.set(note.retailerId, {
        total: prev.total + (note.totalAmount ?? 0),
        count: prev.count + 1,
      });
    }
    return map;
  }, [creditNotes]);

  const debitNoteStatsByRetailerId = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const note of debitNotes ?? []) {
      const prev = map.get(note.retailerId) ?? { total: 0, count: 0 };
      map.set(note.retailerId, {
        total: prev.total + (note.totalAmount ?? 0),
        count: prev.count + 1,
      });
    }
    return map;
  }, [debitNotes]);
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
    shopImage: '',
    salesOfficerId: '',
  });

  const filteredStores = stores?.filter(store =>
    store.shopName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    store.storeCode?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const sortedStores = useMemo(() => {
    const list = [...filteredStores];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'storeCode':
          return applyDirection(compareAsc(a.storeCode || '', b.storeCode || ''), sortDirection);
        case 'shopName':
          return applyDirection(compareAsc((a.shopName || '').toLowerCase(), (b.shopName || '').toLowerCase()), sortDirection);
        case 'owner':
          return applyDirection(
            compareAsc(
              (a.ownerName || a.displayName || '').toLowerCase(),
              (b.ownerName || b.displayName || '').toLowerCase()
            ),
            sortDirection
          );
        case 'salesOfficer':
          return applyDirection(compareAsc(a.salesOfficerId || '', b.salesOfficerId || ''), sortDirection);
        case 'licenceNumber':
          return applyDirection(compareAsc(a.licenceNumber || '', b.licenceNumber || ''), sortDirection);
        case 'phoneNumber':
          return applyDirection(compareAsc(a.phoneNumber || '', b.phoneNumber || ''), sortDirection);
        case 'location':
          return applyDirection(compareAsc(a.location ? 1 : 0, b.location ? 1 : 0), sortDirection);
        case 'creditNoteTotal':
          return applyDirection(
            compareAsc(
              creditNoteStatsByRetailerId.get(a.id)?.total ?? 0,
              creditNoteStatsByRetailerId.get(b.id)?.total ?? 0
            ),
            sortDirection
          );
        case 'debitNoteTotal':
          return applyDirection(
            compareAsc(
              debitNoteStatsByRetailerId.get(a.id)?.total ?? 0,
              debitNoteStatsByRetailerId.get(b.id)?.total ?? 0
            ),
            sortDirection
          );
        case 'isActive':
          return applyDirection(compareAsc(a.isActive !== false ? 1 : 0, b.isActive !== false ? 1 : 0), sortDirection);
        default:
          return applyDirection(compareAsc((a.shopName || '').toLowerCase(), (b.shopName || '').toLowerCase()), 'asc');
      }
    });
    return list;
  }, [filteredStores, sortKey, sortDirection, creditNoteStatsByRetailerId, debitNoteStatsByRetailerId]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  // Pagination
  const totalPages = Math.ceil(sortedStores.length / rowsPerPage);
  const paginatedStores = sortedStores.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  useEffect(() => {
    getSalesOfficers()
      .then(setSalesOfficers)
      .catch(() => setSalesOfficers([]));
  }, []);

  const handleOpenVisitLog = (store: User) => {
    setVisitLogStore(store);
  };

  const handleOpenCreate = async () => {
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
      shopImage: '',
      salesOfficerId: '',
    });
    try {
      const so = await getSalesOfficers();
      setSalesOfficers(so);
    } catch {
      setSalesOfficers([]);
    }
    setOpenDialog(true);
  };

  const handleOpenEdit = async (store: User) => {
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
      shopImage: store.shopImage || '',
      salesOfficerId: store.salesOfficerId || '',
    });
    try {
      const so = await getSalesOfficers();
      setSalesOfficers(so);
    } catch {
      setSalesOfficers([]);
    }
    setOpenDialog(true);
  };

  const handleSendPasswordReset = async () => {
    const email = (editingStore?.email || '').trim();
    if (!email) return;
    if (
      !(await confirm(
        `Send a password reset link to ${email}? The retailer will use it to set a new password for the SimpliPharma mobile app.`
      ))
    ) {
      return;
    }
    try {
      const res = await resetPasswordMutation.mutateAsync(email);
      await alert(res.message, { severity: 'success' });
    } catch (err: any) {
      await alert(err.message || 'Failed to send reset email', { severity: 'error' });
    }
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
        void alert('Image size should be less than 2MB', { severity: 'warning' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setFormData({ ...formData, shopImage: base64String });
      };
      reader.onerror = () => {
        void alert('Error reading image file', { severity: 'error' });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    const email = formData.email.trim();

    if (!editingStore) {
      if (!formData.shopName.trim()) {
        await alert('Store name is required', { severity: 'warning' });
        return;
      }
      if (!email) {
        await alert('Email address is required', { severity: 'warning' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await alert('Please enter a valid email address', { severity: 'warning' });
        return;
      }
    }

    const storeData: any = {
      displayName: formData.displayName,
      shopName: formData.shopName,
      phoneNumber: formData.phoneNumber,
      address: formData.address,
      email,
      licenceNumber: formData.licenceNumber,
      ownerName: formData.ownerName,
      licenceHolderName: formData.licenceHolderName,
      pan: formData.pan,
      gst: formData.gst,
      isActive: formData.isActive,
      shopImage: formData.shopImage,
      salesOfficerId: formData.salesOfficerId || undefined,
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
        await alert('Store updated successfully!', { severity: 'success' });
      } else {
        // In creation, we'd also include the password to be sent to email
        console.log('Creating store with email:', formData.email, 'Password:', generatedPassword);
        try {
          const result = await createStoreMutation.mutateAsync({
            ...storeData,
            initialPassword: generatedPassword // This would be used by a Cloud Function
          });
          
          const emailSent = result && typeof result === 'object' && 'emailSent' in result && result.emailSent;
          if (emailSent) {
            await alert(`Store created successfully!\n\nEmail: ${formData.email}\nPassword: ${generatedPassword}\n\nAn email with the password has been sent to ${formData.email}.`, { severity: 'success' });
          } else {
            await alert(`Store created successfully!\n\n⚠️ Email could not be sent (SMTP authentication failed). Please share these credentials with the store owner:\n\nEmail: ${formData.email}\nPassword: ${generatedPassword}\n\nTo fix email sending: Generate a new Gmail App Password and run:\nfirebase functions:config:set smtp.password="NEW_APP_PASSWORD"\nfirebase deploy --only functions`, { severity: 'warning' });
          }
        } catch (createError: any) {
          // Check if store was created but email failed
          if (createError.storeCreated) {
            // Store was created but email failed
            await alert(`Store created successfully, but email could not be sent.\n\nPlease share these credentials with the store owner:\n\nEmail: ${createError.email || formData.email}\nPassword: ${createError.password || generatedPassword}\n\nNote: Cloud Function for email sending is not configured or failed. Please set up Firebase Cloud Functions with SMTP to enable email notifications.\n\nError: ${createError.message}`, { severity: 'warning' });
          } else {
            // Complete failure
            throw createError; // Re-throw to be caught by outer catch
          }
        }
      }
      setOpenDialog(false);
      // Reset form
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
        shopImage: '',
        salesOfficerId: '',
      });
      setGeneratedPassword('');
    } catch (error: any) {
      console.error('Error saving store:', error);
      await alert(`Failed to save store: ${error.message || 'Unknown error'}`, { severity: 'error' });
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
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setPage(1);
        }}
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
              <SortableTableHeadCell columnId="storeCode" label="Store Code" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="shopName" label="Shop Name" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="owner" label="Owner" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="salesOfficer" label="Sales Officer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="licenceNumber" label="Licence No." sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="phoneNumber" label="Contact" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="location" label="Location" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="creditNoteTotal" label="Credit notes" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="debitNoteTotal" label="Debit notes" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="isActive" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedStores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No stores found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedStores.map((store) => (
              <TableRow key={store.id}>
                <TableCell>
                  <Chip
                    label={store.storeCode || 'N/A'}
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ fontWeight: 'bold' }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">{store.shopName}</Typography>
                  <Typography variant="caption" color="textSecondary">{store.email}</Typography>
                </TableCell>
                <TableCell>{store.ownerName || store.displayName || 'N/A'}</TableCell>
                <TableCell>
                  {store.salesOfficerId
                    ? salesOfficerNameById[store.salesOfficerId] || store.salesOfficerId
                    : '—'}
                </TableCell>
                <TableCell>{store.licenceNumber || 'N/A'}</TableCell>
                <TableCell>{store.phoneNumber || 'N/A'}</TableCell>
                <TableCell>
                  {store.location ? (
                    <Chip label="Geo-tagged" size="small" color="primary" variant="outlined" />
                  ) : (
                    <Chip label="No Location" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right">
                  <NoteTotalCell stats={creditNoteStatsByRetailerId.get(store.id)} />
                </TableCell>
                <TableCell align="right">
                  <NoteTotalCell stats={debitNoteStatsByRetailerId.get(store.id)} />
                </TableCell>
                <TableCell>
                  <Chip
                    label={store.isActive !== false ? 'Active' : 'Inactive'}
                    color={store.isActive !== false ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => handleOpenVisitLog(store)}
                    color="secondary"
                    title="Visit log"
                  >
                    <History />
                  </IconButton>
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
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {sortedStores.length > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, sortedStores.length)} of {sortedStores.length} stores
          </Typography>
        </Box>
      )}

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
                  type="email"
                  required
                  disabled={!!editingStore}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  helperText={editingStore ? 'Email cannot be changed after creation' : 'Required — login credentials are sent to this address'}
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

            <Grid container spacing={2} mb={3}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Assign to Sales Officer</InputLabel>
                  <Select
                    value={formData.salesOfficerId}
                    label="Assign to Sales Officer"
                    onChange={(e) => setFormData({ ...formData, salesOfficerId: e.target.value })}
                  >
                    <MenuItem value="">Unassigned</MenuItem>
                    {salesOfficers.map((so: User) => (
                      <MenuItem key={so.id} value={so.id}>
                        {so.displayName || so.shopName || so.email}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
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
        <DialogActions sx={{ p: 3, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          {editingStore && (
            <Button
              variant="outlined"
              startIcon={<LockReset />}
              onClick={handleSendPasswordReset}
              disabled={resetPasswordMutation.isPending || !editingStore?.email}
            >
              {resetPasswordMutation.isPending ? 'Sending…' : 'Send password reset link'}
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={
              createStoreMutation.isPending ||
              updateStoreMutation.isPending ||
              (!editingStore && !formData.email.trim())
            }
          >
            {editingStore ? 'Update Store' : 'Create Store'}
          </Button>
        </DialogActions>
      </Dialog>

      <RetailerVisitLogDialog
        open={Boolean(visitLogStore)}
        store={visitLogStore}
        salesOfficerNameById={salesOfficerNameById}
        onClose={() => setVisitLogStore(null)}
      />
    </Box>
  );
};

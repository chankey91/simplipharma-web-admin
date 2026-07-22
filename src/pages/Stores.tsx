import React, { useMemo, useState } from 'react';
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
import { useStores, useUpdateStore, useToggleStoreStatus, useCreateStore, useSendRetailerPasswordResetEmail, useGrantOrderBlockOverride } from '../hooks/useStores';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { useStoreNoteStats } from '../hooks/useStoreNoteStats';
import { useOrderPlacementBlockedRetailerIds } from '../hooks/useOrders';
import { User } from '../types';
import { Loading } from '../components/Loading';
import { OrderPlacementStatusChip } from '../components/OrderPlacementStatusChip';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  checkLicenseAndAadharUnique,
  resolveRetailerImageUrl,
} from '../services/retailerDocuments';
import { format } from 'date-fns';
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
  const { data: salesOfficers = [] } = useSalesOfficers();
  const {
    creditNoteStatsByRetailerId,
    debitNoteStatsByRetailerId,
    isLoading: noteStatsLoading,
  } = useStoreNoteStats();
  const { blockedRetailerIds, overdueRetailerIds } = useOrderPlacementBlockedRetailerIds();
  const updateStoreMutation = useUpdateStore();
  const createStoreMutation = useCreateStore();
  const toggleStatusMutation = useToggleStoreStatus();
  const resetPasswordMutation = useSendRetailerPasswordResetEmail();
  const grantOverrideMutation = useGrantOrderBlockOverride();
  const { alert, confirm, prompt } = useAppDialog();

  const [searchTerm, setSearchTerm] = useState('');
  const [orderBlockedOnly, setOrderBlockedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [editingStore, setEditingStore] = useState<User | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [shopImageFile, setShopImageFile] = useState<File | null>(null);
  const [licenceImageFile, setLicenceImageFile] = useState<File | null>(null);
  const [aadharImageFile, setAadharImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [visitLogStore, setVisitLogStore] = useState<User | null>(null);
  const { sortKey, sortDirection, requestSort } = useTableSort('shopName', 'asc');

  const salesOfficerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    salesOfficers.forEach((so) => {
      m[so.id] = so.displayName || so.email || so.id;
    });
    return m;
  }, [salesOfficers]);

  const emptyFormData = () => ({
    displayName: '',
    shopName: '',
    phoneNumber: '',
    address: '',
    email: '',
    licenceNumber: '',
    aadharNumber: '',
    ownerName: '',
    licenceHolderName: '',
    pan: '',
    gst: '',
    storeCode: '',
    isActive: true,
    latitude: '',
    longitude: '',
    shopImage: '',
    licenceImageUrl: '',
    aadharImageUrl: '',
    salesOfficerId: '',
  });

  const [formData, setFormData] = useState(emptyFormData());

  const resetImageFiles = () => {
    setShopImageFile(null);
    setLicenceImageFile(null);
    setAadharImageFile(null);
  };

  const filteredStores = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return (
      stores?.filter((store) => {
        if (orderBlockedOnly && !blockedRetailerIds.has(store.id)) return false;
        if (!q) return true;
        return (
          store.shopName?.toLowerCase().includes(q) ||
          store.email.toLowerCase().includes(q) ||
          store.displayName?.toLowerCase().includes(q) ||
          store.storeCode?.toLowerCase().includes(q)
        );
      }) || []
    );
  }, [stores, searchTerm, orderBlockedOnly, blockedRetailerIds]);

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
        case 'orderBlocked':
          return applyDirection(
            compareAsc(blockedRetailerIds.has(a.id) ? 1 : 0, blockedRetailerIds.has(b.id) ? 1 : 0),
            sortDirection
          );
        default:
          return applyDirection(compareAsc((a.shopName || '').toLowerCase(), (b.shopName || '').toLowerCase()), 'asc');
      }
    });
    return list;
  }, [
    filteredStores,
    sortKey,
    sortDirection,
    creditNoteStatsByRetailerId,
    debitNoteStatsByRetailerId,
    blockedRetailerIds,
  ]);

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

  const handleOpenVisitLog = (store: User) => {
    setVisitLogStore(store);
  };

  const handleGrantOrderOverride = async (retailerId: string) => {
    const store = stores?.find((s) => s.id === retailerId);
    const name = store?.shopName || store?.displayName || 'this store';
    const ok = await confirm(
      `Enable ordering for ${name} for the next 6 hours? The retailer will be able to place orders even if payment is overdue.`,
      { title: 'Unlock ordering (6 hours)', confirmLabel: 'Enable 6 hours' }
    );
    if (!ok) return;
    try {
      const until = await grantOverrideMutation.mutateAsync(retailerId);
      await alert(
        `Ordering unlocked until ${format(until, 'MMM dd, h:mm a')}.`,
        { severity: 'success' }
      );
    } catch (e: any) {
      await alert(e?.message || 'Failed to unlock ordering', { severity: 'error' });
    }
  };

  const handleOpenCreate = async () => {
    setEditingStore(null);
    const newPassword = generatePassword();
    setGeneratedPassword(newPassword);
    setFormData(emptyFormData());
    resetImageFiles();
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
      aadharNumber: store.aadharNumber || '',
      ownerName: store.ownerName || '',
      licenceHolderName: store.licenceHolderName || '',
      pan: store.pan || '',
      gst: store.gst || '',
      storeCode: store.storeCode || '',
      isActive: store.isActive !== false,
      latitude: store.location?.latitude?.toString() || '',
      longitude: store.location?.longitude?.toString() || '',
      shopImage: store.shopImage || store.shopImageUrl || '',
      licenceImageUrl: store.licenceImageUrl || '',
      aadharImageUrl: store.aadharImageUrl || '',
      salesOfficerId: store.salesOfficerId || '',
    });
    resetImageFiles();
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

  const pickImageFile = (
    kind: 'shop' | 'licence' | 'aadhar',
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      void alert('Image must be 5 MB or smaller', { severity: 'warning' });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    if (kind === 'shop') {
      setShopImageFile(file);
      setFormData((prev) => ({ ...prev, shopImage: previewUrl }));
    } else if (kind === 'licence') {
      setLicenceImageFile(file);
      setFormData((prev) => ({ ...prev, licenceImageUrl: previewUrl }));
    } else {
      setAadharImageFile(file);
      setFormData((prev) => ({ ...prev, aadharImageUrl: previewUrl }));
    }
    event.target.value = '';
  };

  const clearImage = (kind: 'shop' | 'licence' | 'aadhar') => {
    if (kind === 'shop') {
      setShopImageFile(null);
      setFormData((prev) => ({ ...prev, shopImage: '' }));
    } else if (kind === 'licence') {
      setLicenceImageFile(null);
      setFormData((prev) => ({ ...prev, licenceImageUrl: '' }));
    } else {
      setAadharImageFile(null);
      setFormData((prev) => ({ ...prev, aadharImageUrl: '' }));
    }
  };

  const handleSave = async () => {
    const email = formData.email.trim();
    const lic = formData.licenceNumber.trim();
    const aad = formData.aadharNumber.trim();

    if (!formData.shopName.trim()) {
      await alert('Shop name is required', { severity: 'warning' });
      return;
    }
    if (!lic || !aad) {
      await alert('Licence and Aadhar numbers are required', { severity: 'warning' });
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

    if (editingStore) {
      const emailChanged =
        email.toLowerCase() !== (editingStore.email || '').trim().toLowerCase();
      if (
        emailChanged &&
        !(await confirm(
          `Change login email from ${editingStore.email} to ${email}?\n\nThe retailer will sign in with the new email. Password reset links will also go to the new address.`
        ))
      ) {
        return;
      }
    }

    const { licenceTaken, aadharTaken } = await checkLicenseAndAadharUnique(
      lic,
      aad,
      editingStore?.id
    );
    if (licenceTaken) {
      await alert('This licence is already registered or pending', { severity: 'warning' });
      return;
    }
    if (aadharTaken) {
      await alert('This Aadhar is already registered or pending', { severity: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const previousShop = editingStore?.shopImage || editingStore?.shopImageUrl;
      const shopImage = await resolveRetailerImageUrl(
        formData.shopImage,
        'shop',
        'shop.jpg',
        shopImageFile,
        previousShop
      );
      const licenceImageUrl = await resolveRetailerImageUrl(
        formData.licenceImageUrl,
        'licence',
        'licence.jpg',
        licenceImageFile,
        editingStore?.licenceImageUrl
      );
      const aadharImageUrl = await resolveRetailerImageUrl(
        formData.aadharImageUrl,
        'aadhar',
        'aadhar.jpg',
        aadharImageFile,
        editingStore?.aadharImageUrl
      );

      const storeData: any = {
        displayName: formData.displayName.trim() || undefined,
        shopName: formData.shopName.trim(),
        phoneNumber: formData.phoneNumber.trim() || undefined,
        address: formData.address.trim() || undefined,
        email,
        licenceNumber: lic,
        aadharNumber: aad,
        ownerName: formData.ownerName.trim() || undefined,
        licenceHolderName: formData.licenceHolderName.trim() || undefined,
        pan: formData.pan.trim() || undefined,
        gst: formData.gst.trim() || undefined,
        storeCode: formData.storeCode.trim() || undefined,
        isActive: formData.isActive,
        shopImage: shopImage,
        shopImageUrl: shopImage,
        licenceImageUrl,
        aadharImageUrl,
        salesOfficerId: formData.salesOfficerId || undefined,
        location:
          formData.latitude && formData.longitude
            ? {
                latitude: parseFloat(formData.latitude),
                longitude: parseFloat(formData.longitude),
              }
            : undefined,
      };

      if (editingStore) {
        await updateStoreMutation.mutateAsync({
          storeId: editingStore.id,
          data: storeData,
          previousEmail: editingStore.email,
        });
        await alert('Store updated successfully!', { severity: 'success' });
      } else {
        console.log('Creating store with email:', formData.email, 'Password:', generatedPassword);
        try {
          const result = await createStoreMutation.mutateAsync({
            ...storeData,
            initialPassword: generatedPassword,
          });

          const emailSent =
            result && typeof result === 'object' && 'emailSent' in result && result.emailSent;
          if (emailSent) {
            await alert(
              `Store created successfully!\n\nEmail: ${formData.email}\nPassword: ${generatedPassword}\n\nAn email with the password has been sent to ${formData.email}.`,
              { severity: 'success' }
            );
          } else {
            await alert(
              `Store created successfully!\n\n⚠️ Email could not be sent (SMTP authentication failed). Please share these credentials with the store owner:\n\nEmail: ${formData.email}\nPassword: ${generatedPassword}\n\nTo fix email sending: Generate a new Gmail App Password and run:\nfirebase functions:config:set smtp.password="NEW_APP_PASSWORD"\nfirebase deploy --only functions`,
              { severity: 'warning' }
            );
          }
        } catch (createError: any) {
          if (createError.storeCreated) {
            await alert(
              `Store document was saved, but the login account or email could not be completed.\n\nPlease share these credentials manually if needed:\n\nEmail: ${createError.email || formData.email}\nPassword: ${createError.password || generatedPassword}\n\nError: ${createError.message}`,
              { severity: 'warning' }
            );
          } else if (/already in use|already registered/i.test(createError.message || '')) {
            await alert(createError.message || 'This email is already registered.', {
              severity: 'error',
            });
          } else {
            throw createError;
          }
        }
      }
      setOpenDialog(false);
      setFormData(emptyFormData());
      resetImageFiles();
      setGeneratedPassword('');
    } catch (error: any) {
      console.error('Error saving store:', error);
      await alert(`Failed to save store: ${error.message || 'Unknown error'}`, { severity: 'error' });
    } finally {
      setSaving(false);
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

      <Box
        display="flex"
        flexWrap="wrap"
        gap={2}
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <TextField
          fullWidth
          placeholder="Search stores..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          sx={{ flex: '1 1 280px', minWidth: 0 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={orderBlockedOnly}
              onChange={(e) => {
                setOrderBlockedOnly(e.target.checked);
                setPage(1);
              }}
              color="warning"
            />
          }
          label={`Order blocked only${blockedRetailerIds.size ? ` (${blockedRetailerIds.size})` : ''}`}
        />
      </Box>

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
              <SortableTableHeadCell columnId="orderBlocked" label="Ordering" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedStores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} align="center">
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
                <TableCell>
                  <OrderPlacementStatusChip
                    retailerId={store.id}
                    overdue={overdueRetailerIds.has(store.id)}
                    overrideUntil={store.orderBlockOverrideUntil}
                    onGrantOverride={handleGrantOrderOverride}
                    disabled={grantOverrideMutation.isPending}
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
            <Typography variant="subtitle2" gutterBottom>Account</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Email Address"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  helperText={
                    editingStore
                      ? 'Updates the retailer login email in Firebase Auth'
                      : 'Required — login credentials are sent to this address'
                  }
                />
              </Grid>
              {!editingStore && (
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Password"
                    value={generatedPassword}
                    disabled
                    helperText="Auto-generated; sent to the retailer by email when SMTP is configured"
                  />
                </Grid>
              )}
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Basic Information</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Display Name"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Shop Name"
                  required
                  value={formData.shopName}
                  onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
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
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Identity Documents</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Licence Number"
                  required
                  value={formData.licenceNumber}
                  onChange={(e) => setFormData({ ...formData, licenceNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Aadhar Number"
                  required
                  value={formData.aadharNumber}
                  onChange={(e) => setFormData({ ...formData, aadharNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth>
                  Shop Photo
                  <input type="file" hidden accept="image/*" onChange={(e) => pickImageFile('shop', e)} />
                </Button>
                {formData.shopImage && (
                  <Box sx={{ mt: 1, textAlign: 'center' }}>
                    <img
                      src={formData.shopImage}
                      alt="Shop preview"
                      style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    <Button size="small" color="error" onClick={() => clearImage('shop')} sx={{ mt: 0.5 }}>
                      Remove
                    </Button>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} md={4}>
                <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth>
                  Licence Photo
                  <input type="file" hidden accept="image/*" onChange={(e) => pickImageFile('licence', e)} />
                </Button>
                {formData.licenceImageUrl && (
                  <Box sx={{ mt: 1, textAlign: 'center' }}>
                    <img
                      src={formData.licenceImageUrl}
                      alt="Licence preview"
                      style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    <Button size="small" color="error" onClick={() => clearImage('licence')} sx={{ mt: 0.5 }}>
                      Remove
                    </Button>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} md={4}>
                <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth>
                  Aadhar Photo
                  <input type="file" hidden accept="image/*" onChange={(e) => pickImageFile('aadhar', e)} />
                </Button>
                {formData.aadharImageUrl && (
                  <Box sx={{ mt: 1, textAlign: 'center' }}>
                    <img
                      src={formData.aadharImageUrl}
                      alt="Aadhar preview"
                      style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    <Button size="small" color="error" onClick={() => clearImage('aadhar')} sx={{ mt: 0.5 }}>
                      Remove
                    </Button>
                  </Box>
                )}
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Location</Typography>
            <Grid container spacing={2} mb={3}>
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
                  Capture Shop Location
                </Button>
              </Grid>
            </Grid>

            <Divider sx={{ mb: 3 }} />
            <Typography variant="subtitle2" gutterBottom>Owner & Tax</Typography>
            <Grid container spacing={2} mb={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Owner Name"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
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
            <Typography variant="subtitle2" gutterBottom>Other</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Store Code"
                  value={formData.storeCode}
                  onChange={(e) => setFormData({ ...formData, storeCode: e.target.value })}
                  helperText="Leave blank to auto-generate (e.g. MS001)"
                  disabled={!!editingStore}
                />
              </Grid>
              <Grid item xs={12} md={6}>
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
              saving ||
              createStoreMutation.isPending ||
              updateStoreMutation.isPending ||
              (!editingStore && !formData.email.trim())
            }
          >
            {saving || createStoreMutation.isPending || updateStoreMutation.isPending
              ? 'Saving…'
              : editingStore
                ? 'Update Store'
                : 'Create Store'}
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

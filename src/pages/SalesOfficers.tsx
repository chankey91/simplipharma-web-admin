import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Collapse,
  Grid,
  Autocomplete,
} from '@mui/material';
import {
  Add,
  ExpandMore,
  ExpandLess,
  Person,
  Store,
  Edit,
  PersonAddAlt,
  LockReset,
  Place,
  PhotoCamera,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  useSalesOfficers,
  useCreateSalesOfficer,
  useUpdateSalesOfficerProfile,
  useSendSalesOfficerPasswordResetEmail,
} from '../hooks/useSalesOfficers';
import { useAreaManagers } from '../hooks/useAreaManagers';
import { useStores, useAssignRetailerToSalesOfficer } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { User } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import { MADHYA_PRADESH_DISTRICTS } from '../constants/madhyaPradeshDistricts';
import { uploadSalesOfficerDevicePhoto, uploadSalesOfficerPhoto } from '../services/salesOfficers';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const emptyOfficerForm = () => ({
  email: '',
  displayName: '',
  phoneNumber: '',
  town: '',
  district: '',
  deviceId: '',
  devicePhoto: '',
  officerPhoto: '',
  aadharNumber: '',
  pan: '',
  password: generatePassword(),
});

const emptyEditOfficerForm = () => ({
  displayName: '',
  phoneNumber: '',
  town: '',
  district: '',
  deviceId: '',
  devicePhoto: '',
  officerPhoto: '',
  aadharNumber: '',
  pan: '',
});

function filled(value: string | undefined | null): boolean {
  return String(value ?? '').trim().length > 0;
}

function retailerLocationLabel(r: User): string {
  return [r.town, r.district].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
}

function retailerOptionLabel(r: User): string {
  const name = r.shopName || r.displayName || r.email || r.id;
  const loc = retailerLocationLabel(r);
  const code = r.storeCode?.trim();
  return [code, name, loc].filter(Boolean).join(' · ');
}

export const SalesOfficersPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: salesOfficers, isLoading, error } = useSalesOfficers();
  const { data: areaManagers = [] } = useAreaManagers();
  const { data: allRetailers } = useStores();
  const createMutation = useCreateSalesOfficer();
  const updateProfileMutation = useUpdateSalesOfficerProfile();
  const assignMutation = useAssignRetailerToSalesOfficer();
  const { alert, confirm, prompt } = useAppDialog();

  const [openDialog, setOpenDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyOfficerForm);

  const resetPasswordMutation = useSendSalesOfficerPasswordResetEmail();

  const [editOpen, setEditOpen] = useState(false);
  const [editOfficer, setEditOfficer] = useState<User | null>(null);
  const [editForm, setEditForm] = useState(emptyEditOfficerForm);
  const [createDevicePhotoFile, setCreateDevicePhotoFile] = useState<File | null>(null);
  const [editDevicePhotoFile, setEditDevicePhotoFile] = useState<File | null>(null);
  const [createOfficerPhotoFile, setCreateOfficerPhotoFile] = useState<File | null>(null);
  const [editOfficerPhotoFile, setEditOfficerPhotoFile] = useState<File | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForSoId, setAssignForSoId] = useState<string | null>(null);
  const [assignPicks, setAssignPicks] = useState<User[]>([]);

  const soNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (salesOfficers || []).forEach((so) => {
      m[so.id] = so.displayName || so.email || so.id;
    });
    return m;
  }, [salesOfficers]);

  const amNameById = useMemo(() => {
    const m: Record<string, string> = {};
    areaManagers.forEach((am) => {
      m[am.id] = am.displayName || am.email || am.id;
    });
    return m;
  }, [areaManagers]);

  const { sortKey, sortDirection, requestSort } = useTableSort('displayName', 'asc');

  const sortedOfficers = useMemo(() => {
    const list = [...(salesOfficers || [])];
    list.sort((a, b) => {
      const countA = (allRetailers || []).filter((r) => r.salesOfficerId === a.id).length;
      const countB = (allRetailers || []).filter((r) => r.salesOfficerId === b.id).length;
      switch (sortKey) {
        case 'displayName':
          return applyDirection(
            compareAsc(
              (a.displayName || a.email || '').toLowerCase(),
              (b.displayName || b.email || '').toLowerCase()
            ),
            sortDirection
          );
        case 'email':
          return applyDirection(compareAsc((a.email || '').toLowerCase(), (b.email || '').toLowerCase()), sortDirection);
        case 'phoneNumber':
          return applyDirection(compareAsc(a.phoneNumber || '', b.phoneNumber || ''), sortDirection);
        case 'retailers':
          return applyDirection(compareAsc(countA, countB), sortDirection);
        default:
          return applyDirection(
            compareAsc(
              (a.displayName || a.email || '').toLowerCase(),
              (b.displayName || b.email || '').toLowerCase()
            ),
            'asc'
          );
      }
    });
    return list;
  }, [salesOfficers, allRetailers, sortKey, sortDirection]);

  const handleOpenCreate = () => {
    setFormData(emptyOfficerForm());
    setCreateDevicePhotoFile(null);
    setCreateOfficerPhotoFile(null);
    setOpenDialog(true);
  };

  const handleOpenEdit = (officer: User) => {
    setEditOfficer(officer);
    setEditDevicePhotoFile(null);
    setEditOfficerPhotoFile(null);
    setEditForm({
      displayName: officer.displayName || '',
      phoneNumber: officer.phoneNumber || '',
      town: officer.town || '',
      district: officer.district || '',
      deviceId: officer.deviceId || '',
      devicePhoto: officer.devicePhoto || '',
      officerPhoto: officer.officerPhoto || '',
      aadharNumber: officer.aadharNumber || '',
      pan: officer.pan || '',
    });
    setEditOpen(true);
  };

  const pickSoPhoto = (
    kind: 'create' | 'edit',
    field: 'devicePhoto' | 'officerPhoto',
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const label = field === 'devicePhoto' ? 'Device photo' : 'Sales Officer photo';
    if (file.size > 5 * 1024 * 1024) {
      void alert(`${label} must be 5 MB or smaller`, { severity: 'warning' });
      event.target.value = '';
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    if (kind === 'create') {
      if (field === 'devicePhoto') setCreateDevicePhotoFile(file);
      else setCreateOfficerPhotoFile(file);
      setFormData((prev) => ({ ...prev, [field]: previewUrl }));
    } else {
      if (field === 'devicePhoto') setEditDevicePhotoFile(file);
      else setEditOfficerPhotoFile(file);
      setEditForm((prev) => ({ ...prev, [field]: previewUrl }));
    }
    event.target.value = '';
  };

  const clearSoPhoto = (kind: 'create' | 'edit', field: 'devicePhoto' | 'officerPhoto') => {
    if (kind === 'create') {
      if (field === 'devicePhoto') setCreateDevicePhotoFile(null);
      else setCreateOfficerPhotoFile(null);
      setFormData((prev) => ({ ...prev, [field]: '' }));
    } else {
      if (field === 'devicePhoto') setEditDevicePhotoFile(null);
      else setEditOfficerPhotoFile(null);
      setEditForm((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleSaveEdit = async () => {
    if (!editOfficer) return;
    if (!filled(editForm.phoneNumber)) {
      await alert('Sales Officer phone is required', { severity: 'warning' });
      return;
    }
    if (!filled(editForm.town)) {
      await alert('Town is required', { severity: 'warning' });
      return;
    }
    if (!filled(editForm.district)) {
      await alert('District is required', { severity: 'warning' });
      return;
    }
    if (!filled(editForm.deviceId)) {
      await alert('Device ID is required', { severity: 'warning' });
      return;
    }
    if (!filled(editForm.aadharNumber)) {
      await alert('Aadhar number is required', { severity: 'warning' });
      return;
    }
    if (!filled(editForm.pan)) {
      await alert('PAN number is required', { severity: 'warning' });
      return;
    }
    try {
      let devicePhoto = editForm.devicePhoto.trim();
      if (editDevicePhotoFile) {
        devicePhoto = await uploadSalesOfficerDevicePhoto(editDevicePhotoFile);
      }
      let officerPhoto = editForm.officerPhoto.trim();
      if (editOfficerPhotoFile) {
        officerPhoto = await uploadSalesOfficerPhoto(editOfficerPhotoFile);
      }
      await updateProfileMutation.mutateAsync({
        salesOfficerId: editOfficer.id,
        data: {
          displayName: editForm.displayName.trim(),
          phoneNumber: editForm.phoneNumber.trim(),
          town: editForm.town.trim(),
          district: editForm.district.trim(),
          deviceId: editForm.deviceId.trim(),
          devicePhoto,
          officerPhoto,
          aadharNumber: editForm.aadharNumber.trim(),
          pan: editForm.pan.trim(),
        },
      });
      await alert('Sales Officer updated.', { severity: 'success' });
      setEditOpen(false);
      setEditOfficer(null);
      setEditDevicePhotoFile(null);
      setEditOfficerPhotoFile(null);
    } catch (err: any) {
      await alert(err.message || 'Failed to update', { severity: 'error' });
    }
  };

  const handleSendPasswordReset = async () => {
    if (!editOfficer?.email) return;
    if (
      !(await confirm(
        `Send a password reset link to ${editOfficer.email}? The Sales Officer will use it to set a new password for the mobile app.`
      ))
    ) {
      return;
    }
    try {
      const res = await resetPasswordMutation.mutateAsync(editOfficer.email);
      await alert(res.message, { severity: 'success' });
    } catch (err: any) {
      await alert(err.message || 'Failed to send reset email', { severity: 'error' });
    }
  };

  const handleOpenAssign = (soId: string) => {
    setAssignForSoId(soId);
    setAssignPicks([]);
    setAssignOpen(true);
  };

  const handleConfirmAssign = async () => {
    if (!assignForSoId || assignPicks.length === 0) return;
    try {
      await assignMutation.mutateAsync({
        retailerUserId: assignPicks.map((r) => r.id),
        salesOfficerId: assignForSoId,
      });
      const names = assignPicks
        .slice(0, 3)
        .map((r) => r.shopName || r.displayName || r.email)
        .join(', ');
      const extra = assignPicks.length > 3 ? ` and ${assignPicks.length - 3} more` : '';
      await alert(`${names}${extra} assigned to this Sales Officer.`, { severity: 'success' });
      setAssignOpen(false);
      setAssignForSoId(null);
      setAssignPicks([]);
    } catch (err: any) {
      await alert(err.message || 'Failed to assign retailer', { severity: 'error' });
    }
  };

  const handleRemoveRetailer = async (retailer: User, officerLabel: string) => {
    const label = retailer.shopName || retailer.displayName || retailer.email;
    if (
      !(await confirm(
        `Remove "${label}" from ${officerLabel}? They will be unassigned from this Sales Officer.`,
        { destructive: true }
      ))
    ) {
      return;
    }
    try {
      await assignMutation.mutateAsync({
        retailerUserId: retailer.id,
        salesOfficerId: null,
      });
    } catch (err: any) {
      await alert(err.message || 'Failed to remove assignment', { severity: 'error' });
    }
  };

  const handleCreate = async () => {
    if (!filled(formData.email)) {
      await alert('Email is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.phoneNumber)) {
      await alert('Sales Officer phone is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.town)) {
      await alert('Town is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.district)) {
      await alert('District is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.deviceId)) {
      await alert('Device ID is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.aadharNumber)) {
      await alert('Aadhar number is required', { severity: 'warning' });
      return;
    }
    if (!filled(formData.pan)) {
      await alert('PAN number is required', { severity: 'warning' });
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      await alert('Password must be at least 6 characters', { severity: 'warning' });
      return;
    }
    try {
      let devicePhoto: string | undefined;
      if (createDevicePhotoFile) {
        devicePhoto = await uploadSalesOfficerDevicePhoto(createDevicePhotoFile);
      }
      let officerPhoto: string | undefined;
      if (createOfficerPhotoFile) {
        officerPhoto = await uploadSalesOfficerPhoto(createOfficerPhotoFile);
      }
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        displayName: formData.displayName.trim() || undefined,
        phoneNumber: formData.phoneNumber.trim(),
        town: formData.town.trim(),
        district: formData.district.trim(),
        deviceId: formData.deviceId.trim(),
        devicePhoto,
        officerPhoto,
        aadharNumber: formData.aadharNumber.trim(),
        pan: formData.pan.trim(),
        initialPassword: formData.password,
      });
      await alert('Sales Officer created successfully! Credentials have been sent via email (if SMTP is configured).', { severity: 'success' });
      setOpenDialog(false);
      setCreateDevicePhotoFile(null);
      setCreateOfficerPhotoFile(null);
    } catch (err: any) {
      const message =
        err?.message ||
        err?.details ||
        (typeof err === 'string' ? err : 'Failed to create Sales Officer');
      await alert(message, { severity: 'error' });
    }
  };

  /** Retailers not currently assigned to this Sales Officer (unassigned or under another SO). */
  const assignOptions = useMemo(() => {
    if (!assignForSoId || !allRetailers) return [];
    return allRetailers.filter((r) => r.salesOfficerId !== assignForSoId);
  }, [assignForSoId, allRetailers]);

  if (isLoading) return <Loading message="Loading Sales Officers..." />;
  if (error) return <Typography color="error">Failed to load Sales Officers</Typography>;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Sales Officers</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add Sales Officer
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Edit officer contact details here. Assign or remove retailers (medical store accounts) per Sales Officer.
        Changing assignment updates the retailer&apos;s profile immediately.
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <SortableTableHeadCell columnId="displayName" label="Name" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="email" label="Email" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="phoneNumber" label="Contact" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
              <SortableTableHeadCell columnId="retailers" label="Retailers" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} align="right" />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!sortedOfficers.length ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="textSecondary">No Sales Officers yet</Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                    Create one to manage retailers and deliveries
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedOfficers.map((so) => (
                <SalesOfficerRow
                  key={so.id}
                  officer={so}
                  areaManagerName={
                    so.areaManagerId ? amNameById[so.areaManagerId] || so.areaManagerId : null
                  }
                  retailers={
                    allRetailers?.filter((r) => r.salesOfficerId === so.id) || []
                  }
                  expanded={expandedId === so.id}
                  onToggle={() => setExpandedId(expandedId === so.id ? null : so.id)}
                  onEdit={() => handleOpenEdit(so)}
                  onAssign={() => handleOpenAssign(so.id)}
                  onRemoveRetailer={(retailer) =>
                    handleRemoveRetailer(retailer, so.displayName || so.email || 'this officer')
                  }
                  assignBusy={assignMutation.isPending}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Sales Officer</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Email"
                required
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Town"
                required
                value={formData.town}
                onChange={(e) => setFormData({ ...formData, town: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={[...MADHYA_PRADESH_DISTRICTS]}
                value={formData.district || null}
                onChange={(_, value) => setFormData({ ...formData, district: value || '' })}
                renderInput={(params) => (
                  <TextField {...params} label="District (Madhya Pradesh)" required placeholder="Search district…" />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Device ID"
                required
                value={formData.deviceId}
                onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                helperText="IMEI or device identifier used by the Sales Officer app"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Sales Officer phone"
                required
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Aadhar number"
                required
                value={formData.aadharNumber}
                onChange={(e) => setFormData({ ...formData, aadharNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="PAN number"
                required
                value={formData.pan}
                onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth sx={{ height: 56 }}>
                Device photo (optional)
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => pickSoPhoto('create', 'devicePhoto', e)}
                />
              </Button>
              {formData.devicePhoto && (
                <Box sx={{ mt: 1, textAlign: 'center' }}>
                  <img
                    src={formData.devicePhoto}
                    alt="Device preview"
                    style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                  />
                  <Button size="small" color="error" onClick={() => clearSoPhoto('create', 'devicePhoto')} sx={{ mt: 0.5 }}>
                    Remove
                  </Button>
                </Box>
              )}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth sx={{ height: 56 }}>
                Sales Officer photo (optional)
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => pickSoPhoto('create', 'officerPhoto', e)}
                />
              </Button>
              {formData.officerPhoto && (
                <Box sx={{ mt: 1, textAlign: 'center' }}>
                  <img
                    src={formData.officerPhoto}
                    alt="Sales Officer preview"
                    style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                  />
                  <Button size="small" color="error" onClick={() => clearSoPhoto('create', 'officerPhoto')} sx={{ mt: 0.5 }}>
                    Remove
                  </Button>
                </Box>
              )}
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                helperText="Min 6 characters. Share with the Sales Officer securely."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Sales Officer</DialogTitle>
        <DialogContent>
          {editOfficer && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Email"
                  value={editOfficer.email}
                  disabled
                  helperText="Login email for the SimpliPharma mobile app. Use “Send password reset email” to help if they forgot their password."
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Display Name"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Town"
                  required
                  value={editForm.town}
                  onChange={(e) => setEditForm({ ...editForm, town: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  options={[...MADHYA_PRADESH_DISTRICTS]}
                  value={editForm.district || null}
                  onChange={(_, value) => setEditForm({ ...editForm, district: value || '' })}
                  renderInput={(params) => (
                    <TextField {...params} label="District (Madhya Pradesh)" required placeholder="Search district…" />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Device ID"
                  required
                  value={editForm.deviceId}
                  onChange={(e) => setEditForm({ ...editForm, deviceId: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Sales Officer phone"
                  required
                  value={editForm.phoneNumber}
                  onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Aadhar number"
                  required
                  value={editForm.aadharNumber}
                  onChange={(e) => setEditForm({ ...editForm, aadharNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="PAN number"
                  required
                  value={editForm.pan}
                  onChange={(e) => setEditForm({ ...editForm, pan: e.target.value.toUpperCase() })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth sx={{ height: 56 }}>
                  Device photo (optional)
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => pickSoPhoto('edit', 'devicePhoto', e)}
                  />
                </Button>
                {editForm.devicePhoto && (
                  <Box sx={{ mt: 1, textAlign: 'center' }}>
                    <img
                      src={editForm.devicePhoto}
                      alt="Device preview"
                      style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    <Button size="small" color="error" onClick={() => clearSoPhoto('edit', 'devicePhoto')} sx={{ mt: 0.5 }}>
                      Remove
                    </Button>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Button variant="outlined" component="label" startIcon={<PhotoCamera />} fullWidth sx={{ height: 56 }}>
                  Sales Officer photo (optional)
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => pickSoPhoto('edit', 'officerPhoto', e)}
                  />
                </Button>
                {editForm.officerPhoto && (
                  <Box sx={{ mt: 1, textAlign: 'center' }}>
                    <img
                      src={editForm.officerPhoto}
                      alt="Sales Officer preview"
                      style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, border: '1px solid #ddd' }}
                    />
                    <Button size="small" color="error" onClick={() => clearSoPhoto('edit', 'officerPhoto')} sx={{ mt: 0.5 }}>
                      Remove
                    </Button>
                  </Box>
                )}
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="outlined"
            startIcon={<LockReset />}
            onClick={handleSendPasswordReset}
            disabled={resetPasswordMutation.isPending || !editOfficer?.email}
          >
            {resetPasswordMutation.isPending ? 'Sending…' : 'Send password reset email'}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="contained"
            onClick={handleSaveEdit}
            disabled={updateProfileMutation.isPending}
          >
            {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign retailer to Sales Officer</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Search and select one or more medical stores. Town and district are shown in the list.
            Stores already linked to this officer are not listed. Assigning a store that has another
            Sales Officer will move it here.
          </Typography>
          <Autocomplete
            multiple
            options={assignOptions}
            value={assignPicks}
            onChange={(_, v) => setAssignPicks(v)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(options, state) => {
              const q = state.inputValue.trim().toLowerCase();
              if (!q) return options;
              return options.filter((r) =>
                [
                  r.shopName,
                  r.displayName,
                  r.email,
                  r.town,
                  r.district,
                  r.storeCode,
                ].some((v) => String(v || '').toLowerCase().includes(q))
              );
            }}
            getOptionLabel={(r) => retailerOptionLabel(r)}
            renderOption={(props, r) => {
              const other = Boolean(r.salesOfficerId && r.salesOfficerId !== assignForSoId);
              const loc = retailerLocationLabel(r);
              return (
                <li {...props} key={r.id}>
                  <Box>
                    <Typography variant="body2">{r.shopName || r.displayName || r.email}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {loc || 'Town / district not set'}
                      {r.storeCode ? ` · ${r.storeCode}` : ''}
                    </Typography>
                    {other ? (
                      <Typography variant="caption" color="warning.main">
                        Currently: {soNameById[r.salesOfficerId!] || 'another Sales Officer'}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Unassigned
                      </Typography>
                    )}
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField {...params} label="Search retailers" placeholder="Name, town, district…" />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PersonAddAlt />}
            onClick={handleConfirmAssign}
            disabled={assignPicks.length === 0 || assignMutation.isPending}
          >
            {assignMutation.isPending
              ? 'Assigning…'
              : assignPicks.length > 1
                ? `Assign ${assignPicks.length} retailers`
                : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const SalesOfficerRow: React.FC<{
  officer: User;
  areaManagerName: string | null;
  retailers: User[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onRemoveRetailer: (retailer: User) => void;
  assignBusy: boolean;
}> = ({
  officer,
  areaManagerName,
  retailers,
  expanded,
  onToggle,
  onEdit,
  onAssign,
  onRemoveRetailer,
  assignBusy,
}) => {
  const navigate = useNavigate();
  return (
    <>
      <TableRow>
        <TableCell>
          <IconButton size="small" onClick={onToggle}>
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Box display="flex" alignItems="center" gap={1}>
            <Person color="secondary" fontSize="small" />
            <Box>
              <Typography fontWeight="medium">{officer.displayName || officer.email}</Typography>
              {(officer.town || officer.district) && (
                <Typography variant="caption" color="text.secondary" display="block">
                  {[officer.town, officer.district].filter(Boolean).join(', ')}
                </Typography>
              )}
              {areaManagerName && (
                <Typography variant="caption" color="text.secondary" display="block">
                  AM: {areaManagerName}
                </Typography>
              )}
            </Box>
          </Box>
        </TableCell>
        <TableCell>{officer.email}</TableCell>
        <TableCell>{officer.phoneNumber || '—'}</TableCell>
        <TableCell align="right">
          <Chip label={retailers.length} size="small" color="primary" variant="outlined" />
        </TableCell>
        <TableCell align="right">
          <IconButton
            size="small"
            aria-label="View SO visits"
            title="View visits"
            onClick={() => navigate(`/so-visits?so=${encodeURIComponent(officer.id)}`)}
            color="secondary"
          >
            <Place fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="Edit Sales Officer" onClick={onEdit} color="primary">
            <Edit fontSize="small" />
          </IconButton>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, borderBottom: 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2, pl: 4, pr: 2, backgroundColor: 'action.hover' }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={1}>
                <Typography variant="subtitle2">Retailers under this Sales Officer</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PersonAddAlt />}
                  onClick={onAssign}
                  disabled={assignBusy}
                >
                  Assign retailer
                </Button>
              </Box>
              {!retailers.length ? (
                <Typography variant="body2" color="text.secondary">
                  No retailers assigned — use Assign retailer to attach a medical store account.
                </Typography>
              ) : (
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {[...retailers]
                    .sort((a, b) =>
                      (a.shopName || a.displayName || a.email || '').localeCompare(
                        b.shopName || b.displayName || b.email || '',
                        undefined,
                        { sensitivity: 'base' }
                      )
                    )
                    .map((r) => (
                    <Chip
                      key={r.id}
                      icon={<Store fontSize="small" />}
                      label={
                        retailerLocationLabel(r)
                          ? `${r.shopName || r.displayName || r.email} (${retailerLocationLabel(r)})`
                          : r.shopName || r.displayName || r.email
                      }
                      size="small"
                      variant="outlined"
                      onDelete={() => onRemoveRetailer(r)}
                      disabled={assignBusy}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

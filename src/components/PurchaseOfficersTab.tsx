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
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
} from '@mui/material';
import { Add, Edit, LockReset } from '@mui/icons-material';
import {
  usePurchaseOfficers,
  useCreatePurchaseOfficer,
  useUpdatePurchaseOfficerProfile,
  useSendPurchaseOfficerPasswordResetEmail,
} from '../hooks/usePurchaseOfficers';
import { Loading } from './Loading';
import { User } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from './SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

export const PurchaseOfficersTab: React.FC = () => {
  const { data: officers, isLoading, error } = usePurchaseOfficers();
  const createMutation = useCreatePurchaseOfficer();
  const updateMutation = useUpdatePurchaseOfficerProfile();
  const resetMutation = useSendPurchaseOfficerPasswordResetEmail();
  const { alert, confirm } = useAppDialog();

  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editOfficer, setEditOfficer] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('displayName', 'asc');

  const sorted = useMemo(() => {
    const list = [...(officers || [])];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'email':
          return applyDirection(
            compareAsc((a.email || '').toLowerCase(), (b.email || '').toLowerCase()),
            sortDirection
          );
        case 'phoneNumber':
          return applyDirection(compareAsc(a.phoneNumber || '', b.phoneNumber || ''), sortDirection);
        default:
          return applyDirection(
            compareAsc(
              (a.displayName || a.email || '').toLowerCase(),
              (b.displayName || b.email || '').toLowerCase()
            ),
            sortDirection
          );
      }
    });
    return list;
  }, [officers, sortKey, sortDirection]);

  const handleOpenCreate = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phoneNumber: '',
      password: generatePassword(),
    });
    setOpenDialog(true);
  };

  const handleCreate = async () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      await alert('First name and last name are required', { severity: 'warning' });
      return;
    }
    if (!formData.email.trim()) {
      await alert('Email is required', { severity: 'warning' });
      return;
    }
    if (!formData.phoneNumber.trim()) {
      await alert('Contact number is required', { severity: 'warning' });
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      await alert('Password must be at least 6 characters', { severity: 'warning' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        initialPassword: formData.password,
      });
      await alert(
        'Purchase Officer created. Credentials were emailed if SMTP is configured — otherwise share the password manually.',
        { severity: 'success' }
      );
      setOpenDialog(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create Purchase Officer';
      await alert(message, { severity: 'error' });
    }
  };

  const handleOpenEdit = (officer: User) => {
    setEditOfficer(officer);
    setEditForm({
      firstName: officer.firstName || '',
      lastName: officer.lastName || '',
      phoneNumber: officer.phoneNumber || '',
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editOfficer) return;
    const displayName = [editForm.firstName, editForm.lastName].filter(Boolean).join(' ').trim();
    try {
      await updateMutation.mutateAsync({
        purchaseOfficerId: editOfficer.id,
        data: {
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
          displayName: displayName || editOfficer.displayName,
          phoneNumber: editForm.phoneNumber.trim(),
        },
      });
      await alert('Purchase Officer updated.', { severity: 'success' });
      setEditOpen(false);
      setEditOfficer(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update';
      await alert(message, { severity: 'error' });
    }
  };

  const handleSendPasswordReset = async () => {
    if (!editOfficer?.email) return;
    if (
      !(await confirm(
        `Send a password reset link to ${editOfficer.email}? The Purchase Officer will use it to set a new password.`
      ))
    ) {
      return;
    }
    try {
      const res = await resetMutation.mutateAsync(editOfficer.email);
      await alert(res.message, { severity: 'success' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      await alert(message, { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading purchase officers..." />;
  if (error) return <Typography color="error">Failed to load purchase officers</Typography>;

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Purchase Officers
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Accounts for the purchase PWA. They work published product summaries and update found
            quantities in real time.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add Purchase Officer
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="displayName"
                label="Name"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="email"
                label="Email"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="phoneNumber"
                label="Contact"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography color="textSecondary" sx={{ py: 2 }}>
                    No purchase officers yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((po) => (
                <TableRow key={po.id}>
                  <TableCell>{po.displayName || [po.firstName, po.lastName].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell>{po.email}</TableCell>
                  <TableCell>{po.phoneNumber || '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="primary" aria-label="Edit" onClick={() => handleOpenEdit(po)}>
                      <Edit />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Purchase Officer</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="First name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="Last name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Contact number"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                helperText="Min 6 characters. Emailed if SMTP is set; otherwise share manually."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleCreate()} disabled={createMutation.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Purchase Officer</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First name"
                value={editForm.firstName}
                onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last name"
                value={editForm.lastName}
                onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Contact number"
                value={editForm.phoneNumber}
                onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
              />
            </Grid>
            {editOfficer?.email ? (
              <Grid item xs={12}>
                <Typography variant="body2" color="textSecondary">
                  Email: {editOfficer.email} (login email cannot be changed here)
                </Typography>
              </Grid>
            ) : null}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Button
            startIcon={<LockReset />}
            onClick={() => void handleSendPasswordReset()}
            disabled={resetMutation.isPending}
          >
            Send password reset
          </Button>
          <Box>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleSaveEdit()} disabled={updateMutation.isPending}>
              Save
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

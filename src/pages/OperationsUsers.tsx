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
  Grid,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { Add, Edit, Engineering } from '@mui/icons-material';
import {
  useOperationsUsers,
  useCreateOperationsUser,
  useUpdateOperationsUserProfile,
} from '../hooks/useOperationsUsers';
import { Loading } from '../components/Loading';
import { User } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
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

export const OperationsUsersPage: React.FC = () => {
  const { data: operationsUsers, isLoading, error } = useOperationsUsers();
  const createMutation = useCreateOperationsUser();
  const updateMutation = useUpdateOperationsUserProfile();
  const { alert, confirm, prompt } = useAppDialog();

  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    phoneNumber: '',
    password: '',
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    phoneNumber: '',
    isActive: true,
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('displayName', 'asc');

  const sortedUsers = useMemo(() => {
    const list = [...(operationsUsers || [])];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'email':
          return applyDirection(compareAsc((a.email || '').toLowerCase(), (b.email || '').toLowerCase()), sortDirection);
        case 'phoneNumber':
          return applyDirection(compareAsc(a.phoneNumber || '', b.phoneNumber || ''), sortDirection);
        case 'status':
          return applyDirection(
            compareAsc(a.isActive === false ? 0 : 1, b.isActive === false ? 0 : 1),
            sortDirection
          );
        case 'displayName':
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
  }, [operationsUsers, sortKey, sortDirection]);

  const handleOpenCreate = () => {
    setFormData({
      email: '',
      displayName: '',
      phoneNumber: '',
      password: generatePassword(),
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditUser(user);
    setEditForm({
      displayName: user.displayName || '',
      phoneNumber: user.phoneNumber || '',
      isActive: user.isActive !== false,
    });
    setEditOpen(true);
  };

  const handleCreate = async () => {
    if (!formData.email.trim()) {
      await alert('Email is required', { severity: 'warning' });
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      await alert('Password must be at least 6 characters', { severity: 'warning' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        displayName: formData.displayName.trim() || undefined,
        phoneNumber: formData.phoneNumber.trim() || undefined,
        initialPassword: formData.password,
      });
      await alert(
        'Operations user created. Credentials have been sent via email if SMTP is configured; otherwise share the password securely.',
        { severity: 'success' }
      );
      setOpenDialog(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create operations user';
      await alert(message, { severity: 'error' });
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    try {
      await updateMutation.mutateAsync({
        userId: editUser.id,
        data: {
          displayName: editForm.displayName.trim(),
          phoneNumber: editForm.phoneNumber.trim(),
          isActive: editForm.isActive,
        },
      });
      await alert('Operations user updated.', { severity: 'success' });
      setEditOpen(false);
      setEditUser(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update';
      await alert(message, { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading operations users..." />;
  if (error) return <Typography color="error">Failed to load operations users</Typography>;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4">Panel users</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Staff who process orders, inventory, purchases, and daily warehouse work.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add operations user
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
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
              <SortableTableHeadCell
                columnId="status"
                label="Status"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="center"
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!sortedUsers.length ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Engineering sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                  <Typography color="textSecondary">No operations users yet</Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                    Create accounts for warehouse and fulfillment staff
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.displayName || '—'}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phoneNumber || '—'}</TableCell>
                  <TableCell align="center">
                    <Chip
                      label={user.isActive === false ? 'Inactive' : 'Active'}
                      color={user.isActive === false ? 'default' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit(user)} aria-label="Edit">
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
        <DialogTitle>Add operations user</DialogTitle>
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
                label="Display name"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Phone number"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                helperText="Min 6 characters. User can log in to the Operations panel with this email and password."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createMutation.isPending || !formData.email || !formData.password}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit operations user</DialogTitle>
        <DialogContent>
          {editUser && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Email"
                  value={editUser.email}
                  disabled
                  helperText="Email is tied to login; change it in Firebase Auth if needed."
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Display name"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Phone number"
                  value={editForm.phoneNumber}
                  onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editForm.isActive}
                      onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                    />
                  }
                  label="Account active (can sign in)"
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

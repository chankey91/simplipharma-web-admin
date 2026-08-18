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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormGroup,
  Divider,
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
import {
  MENU_CATALOG,
  WRITE_MODULES,
  defaultHomePath,
  defaultMenuPaths,
  defaultWriteAccess,
  type WriteAccess,
} from '../auth/permissions';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

type StaffRole = 'operations' | 'office';

function applyPreset(role: StaffRole): { menuPaths: string[]; writeAccess: WriteAccess; homePath: string } {
  return {
    menuPaths: defaultMenuPaths(role),
    writeAccess: defaultWriteAccess(role),
    homePath: defaultHomePath(role),
  };
}

export const OperationsUsersPage: React.FC = () => {
  const { data: operationsUsers, isLoading, error } = useOperationsUsers();
  const createMutation = useCreateOperationsUser();
  const updateMutation = useUpdateOperationsUserProfile();
  const { alert } = useAppDialog();

  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    phoneNumber: '',
    password: '',
    role: 'office' as StaffRole,
    menuPaths: defaultMenuPaths('office'),
    writeAccess: defaultWriteAccess('office'),
    homePath: defaultHomePath('office'),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    phoneNumber: '',
    isActive: true,
    role: 'operations' as StaffRole,
    menuPaths: defaultMenuPaths('operations'),
    writeAccess: defaultWriteAccess('operations'),
    homePath: defaultHomePath('operations'),
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('displayName', 'asc');

  const sortedUsers = useMemo(() => {
    const list = [...(operationsUsers || [])];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'email':
          return applyDirection(
            compareAsc((a.email || '').toLowerCase(), (b.email || '').toLowerCase()),
            sortDirection
          );
        case 'phoneNumber':
          return applyDirection(compareAsc(a.phoneNumber || '', b.phoneNumber || ''), sortDirection);
        case 'status':
          return applyDirection(
            compareAsc(a.isActive === false ? 0 : 1, b.isActive === false ? 0 : 1),
            sortDirection
          );
        case 'role':
          return applyDirection(compareAsc(a.role || '', b.role || ''), sortDirection);
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
    const preset = applyPreset('office');
    setFormData({
      email: '',
      displayName: '',
      phoneNumber: '',
      password: generatePassword(),
      role: 'office',
      ...preset,
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (user: User) => {
    const role: StaffRole = user.role === 'office' ? 'office' : 'operations';
    const preset = applyPreset(role);
    setEditUser(user);
    setEditForm({
      displayName: user.displayName || '',
      phoneNumber: user.phoneNumber || '',
      isActive: user.isActive !== false,
      role,
      menuPaths: user.menuPaths?.length ? user.menuPaths : preset.menuPaths,
      writeAccess: { ...preset.writeAccess, ...(user.writeAccess || {}) },
      homePath: user.homePath || preset.homePath,
    });
    setEditOpen(true);
  };

  const toggleMenu = (
    paths: string[],
    path: string,
    setPaths: (next: string[]) => void
  ) => {
    setPaths(paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path]);
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
    if (formData.menuPaths.length === 0) {
      await alert('Select at least one menu', { severity: 'warning' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        displayName: formData.displayName.trim() || undefined,
        phoneNumber: formData.phoneNumber.trim() || undefined,
        initialPassword: formData.password,
        role: formData.role,
        menuPaths: formData.menuPaths,
        writeAccess: formData.writeAccess,
        homePath: formData.homePath,
      });
      await alert(
        'Panel user created. Credentials have been sent via email if SMTP is configured; otherwise share the password securely.',
        { severity: 'success' }
      );
      setOpenDialog(false);
    } catch (err: unknown) {
      const fb = err as { message?: string; details?: unknown; code?: string };
      const detail = typeof fb.details === 'string' ? fb.details : '';
      const message =
        detail ||
        (fb.message && fb.message !== 'internal' ? fb.message : '') ||
        'Failed to create panel user';
      await alert(message, { severity: 'error' });
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    if (editForm.menuPaths.length === 0) {
      await alert('Select at least one menu', { severity: 'warning' });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        userId: editUser.id,
        data: {
          displayName: editForm.displayName.trim(),
          phoneNumber: editForm.phoneNumber.trim(),
          isActive: editForm.isActive,
          role: editForm.role,
          menuPaths: editForm.menuPaths,
          writeAccess: editForm.writeAccess,
          homePath: editForm.homePath,
        },
      });
      await alert('Panel user updated.', { severity: 'success' });
      setEditOpen(false);
      setEditUser(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update';
      await alert(message, { severity: 'error' });
    }
  };

  if (isLoading) return <Loading message="Loading panel users..." />;
  if (error) return <Typography color="error">Failed to load panel users</Typography>;

  const accessFields = (
    role: StaffRole,
    menuPaths: string[],
    writeAccess: WriteAccess,
    homePath: string,
    onRole: (role: StaffRole) => void,
    onMenus: (paths: string[]) => void,
    onWrite: (next: WriteAccess) => void,
    onHome: (path: string) => void
  ) => (
    <>
      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>Role preset</InputLabel>
          <Select
            label="Role preset"
            value={role}
            onChange={(e) => {
              const next = e.target.value as StaffRole;
              const preset = applyPreset(next);
              onRole(next);
              onMenus(preset.menuPaths);
              onWrite(preset.writeAccess);
              onHome(preset.homePath);
            }}
          >
            <MenuItem value="office">Office (stores, receivables, orders, purchases, inventory)</MenuItem>
            <MenuItem value="operations">Operations (warehouse / fulfillment)</MenuItem>
          </Select>
        </FormControl>
      </Grid>
      <Grid item xs={12}>
        <Typography variant="subtitle2" gutterBottom>
          Menus
        </Typography>
        <FormGroup row>
          {MENU_CATALOG.map((item) => (
            <FormControlLabel
              key={item.path}
              sx={{ width: { xs: '100%', sm: '48%' }, mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={menuPaths.includes(item.path)}
                  onChange={() => toggleMenu(menuPaths, item.path, onMenus)}
                />
              }
              label={item.label}
            />
          ))}
        </FormGroup>
      </Grid>
      <Grid item xs={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" gutterBottom>
          Write access
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Unticked = view only. Print Invoice stays available on orders even when order edit is off.
        </Typography>
        <FormGroup>
          {WRITE_MODULES.map((mod) => (
            <FormControlLabel
              key={mod.id}
              control={
                <Checkbox
                  size="small"
                  checked={writeAccess[mod.id]}
                  onChange={(e) => onWrite({ ...writeAccess, [mod.id]: e.target.checked })}
                />
              }
              label={mod.label}
            />
          ))}
        </FormGroup>
      </Grid>
      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>Land on</InputLabel>
          <Select
            label="Land on"
            value={menuPaths.includes(homePath) ? homePath : menuPaths[0] || ''}
            onChange={(e) => onHome(e.target.value)}
          >
            {MENU_CATALOG.filter((m) => menuPaths.includes(m.path)).map((m) => (
              <MenuItem key={m.path} value={m.path}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>
    </>
  );

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4">Panel users</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Operations and office staff. Admin can choose menus and write access per user.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate}>
          Add panel user
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
                columnId="role"
                label="Role"
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
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Engineering sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                  <Typography color="textSecondary">No panel users yet</Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                    Create office or operations accounts
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.displayName || '—'}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={user.role === 'office' ? 'Office' : 'Operations'}
                      color={user.role === 'office' ? 'info' : 'secondary'}
                      variant="outlined"
                    />
                  </TableCell>
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

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add panel user</DialogTitle>
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Display name"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
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
                helperText="Min 6 characters. User signs in to the admin portal with this email."
              />
            </Grid>
            {accessFields(
              formData.role,
              formData.menuPaths,
              formData.writeAccess,
              formData.homePath,
              (role) => setFormData((p) => ({ ...p, role })),
              (menuPaths) => setFormData((p) => ({ ...p, menuPaths })),
              (writeAccess) => setFormData((p) => ({ ...p, writeAccess })),
              (homePath) => setFormData((p) => ({ ...p, homePath }))
            )}
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

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit panel user</DialogTitle>
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
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Display name"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
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
              {accessFields(
                editForm.role,
                editForm.menuPaths,
                editForm.writeAccess,
                editForm.homePath,
                (role) => setEditForm((p) => ({ ...p, role })),
                (menuPaths) => setEditForm((p) => ({ ...p, menuPaths })),
                (writeAccess) => setEditForm((p) => ({ ...p, writeAccess })),
                (homePath) => setEditForm((p) => ({ ...p, homePath }))
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

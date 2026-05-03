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
} from '@mui/icons-material';
import {
  useSalesOfficers,
  useCreateSalesOfficer,
  useUpdateSalesOfficerProfile,
} from '../hooks/useSalesOfficers';
import { useStores, useAssignRetailerToSalesOfficer } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { User } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

export const SalesOfficersPage: React.FC = () => {
  const { data: salesOfficers, isLoading, error } = useSalesOfficers();
  const { data: allRetailers } = useStores();
  const createMutation = useCreateSalesOfficer();
  const updateProfileMutation = useUpdateSalesOfficerProfile();
  const assignMutation = useAssignRetailerToSalesOfficer();

  const [openDialog, setOpenDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    phoneNumber: '',
    password: '',
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editOfficer, setEditOfficer] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', phoneNumber: '' });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForSoId, setAssignForSoId] = useState<string | null>(null);
  const [assignPick, setAssignPick] = useState<User | null>(null);

  const soNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (salesOfficers || []).forEach((so) => {
      m[so.id] = so.displayName || so.email || so.id;
    });
    return m;
  }, [salesOfficers]);

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
    setFormData({
      email: '',
      displayName: '',
      phoneNumber: '',
      password: generatePassword(),
    });
    setOpenDialog(true);
  };

  const handleOpenEdit = (officer: User) => {
    setEditOfficer(officer);
    setEditForm({
      displayName: officer.displayName || '',
      phoneNumber: officer.phoneNumber || '',
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editOfficer) return;
    try {
      await updateProfileMutation.mutateAsync({
        salesOfficerId: editOfficer.id,
        data: {
          displayName: editForm.displayName.trim(),
          phoneNumber: editForm.phoneNumber.trim(),
        },
      });
      alert('Sales Officer updated.');
      setEditOpen(false);
      setEditOfficer(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    }
  };

  const handleOpenAssign = (soId: string) => {
    setAssignForSoId(soId);
    setAssignPick(null);
    setAssignOpen(true);
  };

  const handleConfirmAssign = async () => {
    if (!assignForSoId || !assignPick) return;
    try {
      await assignMutation.mutateAsync({
        retailerUserId: assignPick.id,
        salesOfficerId: assignForSoId,
      });
      alert(
        `${assignPick.shopName || assignPick.displayName || assignPick.email} assigned to this Sales Officer.`
      );
      setAssignOpen(false);
      setAssignForSoId(null);
      setAssignPick(null);
    } catch (err: any) {
      alert(err.message || 'Failed to assign retailer');
    }
  };

  const handleRemoveRetailer = async (retailer: User, officerLabel: string) => {
    const label = retailer.shopName || retailer.displayName || retailer.email;
    if (
      !window.confirm(
        `Remove "${label}" from ${officerLabel}? They will be unassigned from this Sales Officer.`
      )
    ) {
      return;
    }
    try {
      await assignMutation.mutateAsync({
        retailerUserId: retailer.id,
        salesOfficerId: null,
      });
    } catch (err: any) {
      alert(err.message || 'Failed to remove assignment');
    }
  };

  const handleCreate = async () => {
    if (!formData.email.trim()) {
      alert('Email is required');
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        displayName: formData.displayName.trim() || undefined,
        phoneNumber: formData.phoneNumber.trim() || undefined,
        initialPassword: formData.password,
      });
      alert('Sales Officer created successfully! Credentials have been sent via email (if SMTP is configured).');
      setOpenDialog(false);
    } catch (err: any) {
      alert(err.message || 'Failed to create Sales Officer');
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
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
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

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
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
            disabled={createMutation.isPending || !formData.email || !formData.password}
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
                <TextField fullWidth label="Email" value={editOfficer.email} disabled helperText="Email is tied to login; change it in Firebase Auth if needed." />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Display Name"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Phone Number"
                  value={editForm.phoneNumber}
                  onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={updateProfileMutation.isPending}>
            {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign retailer to Sales Officer</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose a medical store (retailer account) to attach. Stores already linked to this officer are not listed.
            Assigning a store that has another Sales Officer will move it here.
          </Typography>
          <Autocomplete
            options={assignOptions}
            value={assignPick}
            onChange={(_, v) => setAssignPick(v)}
            getOptionLabel={(r) =>
              `${r.shopName || r.displayName || r.email || r.id}${r.email ? ` (${r.email})` : ''}`
            }
            renderOption={(props, r) => {
              const other = Boolean(r.salesOfficerId && r.salesOfficerId !== assignForSoId);
              return (
                <li {...props} key={r.id}>
                  <Box>
                    <Typography variant="body2">{r.shopName || r.displayName || r.email}</Typography>
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
              <TextField {...params} label="Search retailer / store" placeholder="Type to filter" />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PersonAddAlt />}
            onClick={handleConfirmAssign}
            disabled={!assignPick || assignMutation.isPending}
          >
            Assign
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const SalesOfficerRow: React.FC<{
  officer: User;
  retailers: User[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAssign: () => void;
  onRemoveRetailer: (retailer: User) => void;
  assignBusy: boolean;
}> = ({
  officer,
  retailers,
  expanded,
  onToggle,
  onEdit,
  onAssign,
  onRemoveRetailer,
  assignBusy,
}) => {
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
            <Typography fontWeight="medium">{officer.displayName || officer.email}</Typography>
          </Box>
        </TableCell>
        <TableCell>{officer.email}</TableCell>
        <TableCell>{officer.phoneNumber || '—'}</TableCell>
        <TableCell align="right">
          <Chip label={retailers.length} size="small" color="primary" variant="outlined" />
        </TableCell>
        <TableCell align="right">
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
                  {retailers.map((r) => (
                    <Chip
                      key={r.id}
                      icon={<Store fontSize="small" />}
                      label={r.shopName || r.displayName || r.email}
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

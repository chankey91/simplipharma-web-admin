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
  Autocomplete,
} from '@mui/material';
import {
  Add,
  ExpandMore,
  ExpandLess,
  Edit,
  PersonAddAlt,
  LockReset,
  Group,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  useAreaManagers,
  useCreateAreaManager,
  useUpdateAreaManagerProfile,
  useAssignSalesOfficerToAreaManager,
  useSendAreaManagerPasswordResetEmail,
} from '../hooks/useAreaManagers';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { Loading } from '../components/Loading';
import { User } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import { MADHYA_PRADESH_DISTRICTS } from '../constants/madhyaPradeshDistricts';

const generatePassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const emptyCreateForm = () => ({
  email: '',
  displayName: '',
  phoneNumber: '',
  managedDistricts: [] as string[],
  managedTowns: '',
  password: generatePassword(),
});

const emptyEditForm = () => ({
  displayName: '',
  phoneNumber: '',
  managedDistricts: [] as string[],
  managedTowns: '',
});

function soOptionLabel(so: User): string {
  const name = so.displayName || so.email || so.id;
  const loc = [so.town, so.district].filter(Boolean).join(', ');
  return loc ? `${name} · ${loc}` : name;
}

export const AreaManagersPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert, confirm } = useAppDialog();
  const { data: areaManagers, isLoading, error } = useAreaManagers();
  const { data: salesOfficers = [] } = useSalesOfficers();
  const createMutation = useCreateAreaManager();
  const updateMutation = useUpdateAreaManagerProfile();
  const assignMutation = useAssignSalesOfficerToAreaManager();
  const resetPasswordMutation = useSendAreaManagerPasswordResetEmail();

  const [openDialog, setOpenDialog] = useState(false);
  const [formData, setFormData] = useState(emptyCreateForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editManager, setEditManager] = useState<User | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForAmId, setAssignForAmId] = useState<string | null>(null);
  const [assignPicks, setAssignPicks] = useState<User[]>([]);

  const { sortKey, sortDirection, requestSort } = useTableSort('displayName', 'asc');

  const soByAmId = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const so of salesOfficers) {
      const amId = String(so.areaManagerId || '').trim();
      if (!amId) continue;
      const list = map.get(amId) ?? [];
      list.push(so);
      map.set(amId, list);
    }
    return map;
  }, [salesOfficers]);

  const sortedManagers = useMemo(() => {
    const list = [...(areaManagers || [])];
    list.sort((a, b) => {
      const countA = soByAmId.get(a.id)?.length ?? 0;
      const countB = soByAmId.get(b.id)?.length ?? 0;
      switch (sortKey) {
        case 'displayName':
          return applyDirection(
            compareAsc(
              (a.displayName || a.email || '').toLowerCase(),
              (b.displayName || b.email || '').toLowerCase()
            ),
            sortDirection
          );
        case 'phone':
          return applyDirection(
            compareAsc(a.phoneNumber || '', b.phoneNumber || ''),
            sortDirection
          );
        case 'soCount':
          return applyDirection(compareAsc(countA, countB), sortDirection);
        case 'districts':
          return applyDirection(
            compareAsc((a.managedDistricts || []).join(','), (b.managedDistricts || []).join(',')),
            sortDirection
          );
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
  }, [areaManagers, soByAmId, sortKey, sortDirection]);

  const parseTowns = (raw: string): string[] =>
    raw
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

  const handleCreate = async () => {
    if (!formData.email.trim() || !formData.displayName.trim() || !formData.phoneNumber.trim()) {
      await alert('Name, email, and phone are required.', { severity: 'warning' });
      return;
    }
    if (formData.managedDistricts.length === 0) {
      await alert('Select at least one managed district.', { severity: 'warning' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        email: formData.email.trim(),
        displayName: formData.displayName.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        managedDistricts: formData.managedDistricts,
        managedTowns: parseTowns(formData.managedTowns),
        initialPassword: formData.password,
      });
      await alert(
        `Area Manager created.\n\nEmail: ${formData.email.trim()}\nPassword: ${formData.password}`,
        { severity: 'success' }
      );
      setOpenDialog(false);
      setFormData(emptyCreateForm());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create Area Manager';
      await alert(msg, { severity: 'error' });
    }
  };

  const openEdit = (am: User) => {
    setEditManager(am);
    setEditForm({
      displayName: am.displayName || '',
      phoneNumber: am.phoneNumber || '',
      managedDistricts: [...(am.managedDistricts || [])],
      managedTowns: (am.managedTowns || []).join(', '),
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editManager) return;
    if (!editForm.displayName.trim() || !editForm.phoneNumber.trim()) {
      await alert('Name and phone are required.', { severity: 'warning' });
      return;
    }
    if (editForm.managedDistricts.length === 0) {
      await alert('Select at least one managed district.', { severity: 'warning' });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        areaManagerId: editManager.id,
        data: {
          displayName: editForm.displayName.trim(),
          phoneNumber: editForm.phoneNumber.trim(),
          managedDistricts: editForm.managedDistricts,
          managedTowns: parseTowns(editForm.managedTowns),
        },
      });
      setEditOpen(false);
      setEditManager(null);
      await alert('Area Manager updated.', { severity: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      await alert(msg, { severity: 'error' });
    }
  };

  const openAssignSos = (am: User) => {
    setAssignForAmId(am.id);
    setAssignPicks([...(soByAmId.get(am.id) || [])]);
    setAssignOpen(true);
  };

  const handleSaveAssign = async () => {
    if (!assignForAmId) return;
    const current = new Set((soByAmId.get(assignForAmId) || []).map((s) => s.id));
    const next = new Set(assignPicks.map((s) => s.id));

    const toAdd = [...next].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !next.has(id));

    try {
      for (const salesOfficerId of toAdd) {
        await assignMutation.mutateAsync({
          salesOfficerId,
          areaManagerId: assignForAmId,
        });
      }
      for (const salesOfficerId of toRemove) {
        await assignMutation.mutateAsync({
          salesOfficerId,
          areaManagerId: null,
        });
      }
      setAssignOpen(false);
      setAssignForAmId(null);
      setAssignPicks([]);
      await alert('Sales Officer assignments updated.', { severity: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update assignments';
      await alert(msg, { severity: 'error' });
    }
  };

  const handleResetPassword = async (am: User) => {
    if (!am.email) {
      await alert('No email on file for this Area Manager.', { severity: 'warning' });
      return;
    }
    const ok = await confirm(`Send password reset email to ${am.email}?`, {
      title: 'Reset password',
      confirmLabel: 'Send',
    });
    if (!ok) return;
    try {
      const res = await resetPasswordMutation.mutateAsync(am.email);
      await alert(res.message, { severity: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to send reset email';
      await alert(msg, { severity: 'error' });
    }
  };

  /** SOs already assigned to another AM stay selectable but labeled. */
  const soAssignOptions = useMemo(() => {
    return [...salesOfficers].sort((a, b) =>
      soOptionLabel(a).localeCompare(soOptionLabel(b))
    );
  }, [salesOfficers]);

  const suggestedSosForAm = (amId: string | null): User[] => {
    if (!amId) return [];
    const am = (areaManagers || []).find((m) => m.id === amId);
    const districts = new Set(
      (am?.managedDistricts || []).map((d) => d.trim().toLowerCase()).filter(Boolean)
    );
    if (districts.size === 0) return [];
    return salesOfficers.filter((so) => {
      const d = String(so.district || '').trim().toLowerCase();
      if (!d || !districts.has(d)) return false;
      const currentAm = String(so.areaManagerId || '').trim();
      return !currentAm || currentAm === amId;
    });
  };

  if (isLoading) return <Loading message="Loading area managers..." />;
  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">Failed to load area managers.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3} gap={2} flexWrap="wrap">
        <Box>
          <Typography variant="h4" gutterBottom>
            Area managers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create Area Managers, assign districts, and map Sales Officers who report to them. AMs
            use the field app (`areaManager` role) — not this admin panel.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            setFormData(emptyCreateForm());
            setOpenDialog(true);
          }}
        >
          Add Area Manager
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <SortableTableHeadCell
                columnId="displayName"
                label="Name"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="phone"
                label="Phone"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="districts"
                label="Districts"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="soCount"
                label="SOs"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedManagers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No Area Managers yet.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedManagers.map((am) => {
                const open = expandedId === am.id;
                const sos = soByAmId.get(am.id) || [];
                return (
                  <React.Fragment key={am.id}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => setExpandedId(open ? null : am.id)}
                        >
                          {open ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={500}>
                          {am.displayName || am.email || am.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {am.email}
                        </Typography>
                      </TableCell>
                      <TableCell>{am.phoneNumber || '—'}</TableCell>
                      <TableCell>
                        <Box display="flex" flexWrap="wrap" gap={0.5}>
                          {(am.managedDistricts || []).length === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              —
                            </Typography>
                          ) : (
                            (am.managedDistricts || []).slice(0, 4).map((d) => (
                              <Chip key={d} size="small" label={d} />
                            ))
                          )}
                          {(am.managedDistricts || []).length > 4 && (
                            <Chip
                              size="small"
                              label={`+${(am.managedDistricts || []).length - 4}`}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">{sos.length}</TableCell>
                      <TableCell align="right">
                        <Box display="flex" gap={0.5} justifyContent="flex-end" flexWrap="wrap">
                          <Button
                            size="small"
                            startIcon={<Edit />}
                            onClick={() => openEdit(am)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            startIcon={<PersonAddAlt />}
                            onClick={() => openAssignSos(am)}
                          >
                            Assign SOs
                          </Button>
                          <IconButton
                            size="small"
                            title="Password reset"
                            onClick={() => void handleResetPassword(am)}
                          >
                            <LockReset fontSize="small" />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
                        <Collapse in={open} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 2 }}>
                            {(am.managedTowns || []).length > 0 && (
                              <Typography variant="body2" color="text.secondary" mb={1}>
                                Towns: {(am.managedTowns || []).join(', ')}
                              </Typography>
                            )}
                            {sos.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                No Sales Officers assigned. Use Assign SOs.
                              </Typography>
                            ) : (
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Sales Officer</TableCell>
                                    <TableCell>Phone</TableCell>
                                    <TableCell>Town / District</TableCell>
                                    <TableCell align="right">Visits</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {sos.map((so) => (
                                    <TableRow key={so.id}>
                                      <TableCell>
                                        {so.displayName || so.email || so.id}
                                      </TableCell>
                                      <TableCell>{so.phoneNumber || '—'}</TableCell>
                                      <TableCell>
                                        {[so.town, so.district].filter(Boolean).join(', ') ||
                                          '—'}
                                      </TableCell>
                                      <TableCell align="right">
                                        <Button
                                          size="small"
                                          onClick={() =>
                                            navigate(
                                              `/so-visits?so=${encodeURIComponent(so.id)}`
                                            )
                                          }
                                        >
                                          Visits
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Area Manager</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label="Full name"
              required
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              fullWidth
            />
            <TextField
              label="Phone"
              required
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              fullWidth
            />
            <Autocomplete
              multiple
              options={[...MADHYA_PRADESH_DISTRICTS]}
              value={formData.managedDistricts}
              onChange={(_, value) => setFormData({ ...formData, managedDistricts: value })}
              renderInput={(params) => (
                <TextField {...params} label="Managed districts" required />
              )}
            />
            <TextField
              label="Managed towns (optional)"
              helperText="Comma-separated"
              value={formData.managedTowns}
              onChange={(e) => setFormData({ ...formData, managedTowns: e.target.value })}
              fullWidth
            />
            <TextField
              label="Initial password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              fullWidth
              helperText="Share this with the Area Manager for app login"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleCreate()}
            disabled={createMutation.isPending}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Area Manager</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label="Full name"
              required
              value={editForm.displayName}
              onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
              fullWidth
            />
            <TextField
              label="Phone"
              required
              value={editForm.phoneNumber}
              onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
              fullWidth
            />
            <Autocomplete
              multiple
              options={[...MADHYA_PRADESH_DISTRICTS]}
              value={editForm.managedDistricts}
              onChange={(_, value) => setEditForm({ ...editForm, managedDistricts: value })}
              renderInput={(params) => (
                <TextField {...params} label="Managed districts" required />
              )}
            />
            <TextField
              label="Managed towns (optional)"
              helperText="Comma-separated"
              value={editForm.managedTowns}
              onChange={(e) => setEditForm({ ...editForm, managedTowns: e.target.value })}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveEdit()}
            disabled={updateMutation.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign SOs */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <Group /> Assign Sales Officers
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
            Selected officers will report to this Area Manager (`areaManagerId`). Officers already
            under another AM will be moved if you select them.
          </Typography>
          {suggestedSosForAm(assignForAmId).length > 0 && (
            <Button
              size="small"
              sx={{ mb: 1.5 }}
              onClick={() => {
                const suggested = suggestedSosForAm(assignForAmId);
                const byId = new Map(assignPicks.map((s) => [s.id, s]));
                for (const so of suggested) byId.set(so.id, so);
                setAssignPicks([...byId.values()]);
              }}
            >
              Add suggested SOs in managed districts (
              {suggestedSosForAm(assignForAmId).length})
            </Button>
          )}
          <Autocomplete
            multiple
            options={soAssignOptions}
            value={assignPicks}
            onChange={(_, value) => setAssignPicks(value)}
            getOptionLabel={soOptionLabel}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={(props, option) => {
              const otherAm = String(option.areaManagerId || '').trim();
              const assignedElsewhere =
                otherAm && assignForAmId && otherAm !== assignForAmId;
              return (
                <li {...props} key={option.id}>
                  <Box>
                    <Typography variant="body2">{soOptionLabel(option)}</Typography>
                    {assignedElsewhere && (
                      <Typography variant="caption" color="warning.main">
                        Currently under another AM
                      </Typography>
                    )}
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField {...params} label="Sales Officers" placeholder="Search…" />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveAssign()}
            disabled={assignMutation.isPending}
          >
            Save assignments
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

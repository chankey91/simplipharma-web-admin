import React, { useState } from 'react';
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
} from '@mui/material';
import { Add, ExpandMore, ExpandLess, Person, Store } from '@mui/icons-material';
import { useSalesOfficers, useCreateSalesOfficer } from '../hooks/useSalesOfficers';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { User } from '../types';

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
  const { data: allStores } = useStores();
  const createMutation = useCreateSalesOfficer();
  const [openDialog, setOpenDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    phoneNumber: '',
    password: '',
  });

  const handleOpenCreate = () => {
    setFormData({
      email: '',
      displayName: '',
      phoneNumber: '',
      password: generatePassword(),
    });
    setOpenDialog(true);
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
        Sales Officers manage retailers and deliver orders. Assign retailers to Sales Officers from the Medical Stores page.
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>Retailers</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!salesOfficers?.length ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="textSecondary">No Sales Officers yet</Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                    Create one to manage retailers and deliveries
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              salesOfficers.map((so) => (
                <SalesOfficerRow
                  key={so.id}
                  officer={so}
                  retailers={allStores?.filter((s) => s.salesOfficerId === so.id) || []}
                  expanded={expandedId === so.id}
                  onToggle={() => setExpandedId(expandedId === so.id ? null : so.id)}
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
    </Box>
  );
};

const SalesOfficerRow: React.FC<{
  officer: User;
  retailers: User[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ officer, retailers, expanded, onToggle }) => {
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
        <TableCell>
          <Chip label={retailers.length} size="small" color="primary" variant="outlined" />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ py: 0, borderBottom: 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2, pl: 4, backgroundColor: 'action.hover' }}>
              <Typography variant="subtitle2" gutterBottom>
                Retailers under this Sales Officer
              </Typography>
              {!retailers.length ? (
                <Typography variant="body2" color="text.secondary">No retailers assigned</Typography>
              ) : (
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {retailers.map((r) => (
                    <Chip
                      key={r.id}
                      icon={<Store fontSize="small" />}
                      label={r.shopName || r.displayName || r.email}
                      size="small"
                      variant="outlined"
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

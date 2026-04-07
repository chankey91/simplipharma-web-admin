import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  Alert,
  Link as MuiLink,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { format } from 'date-fns';
import { PostAdd } from '@mui/icons-material';
import { useProductDemands, useFulfillProductDemand, useRejectProductDemand } from '../hooks/useProductDemands';
import { useMedicines } from '../hooks/useInventory';
import { ProductDemand, Medicine } from '../types';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';

type Filter = 'pending' | 'all';

export const ProductDemandsPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: demands, isLoading, error } = useProductDemands();
  const { data: medicines } = useMedicines();
  const fulfillMutation = useFulfillProductDemand();
  const rejectMutation = useRejectProductDemand();

  const [filter, setFilter] = useState<Filter>('pending');
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<ProductDemand | null>(null);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [fulfillNote, setFulfillNote] = useState('');
  const [purchaseInvoiceId, setPurchaseInvoiceId] = useState('');
  const [cartQty, setCartQty] = useState('1');
  const [rejectReason, setRejectReason] = useState('');

  const filtered = useMemo(() => {
    if (!demands) return [];
    if (filter === 'pending') return demands.filter((d) => d.status === 'pending');
    return demands;
  }, [demands, filter]);

  const openFulfill = (d: ProductDemand) => {
    setSelectedDemand(d);
    setSelectedMedicine(null);
    setFulfillNote('');
    setPurchaseInvoiceId('');
    setCartQty('1');
    setFulfillOpen(true);
  };

  const openReject = (d: ProductDemand) => {
    setSelectedDemand(d);
    setRejectReason('');
    setRejectOpen(true);
  };

  const handleFulfill = async () => {
    if (!selectedDemand || !selectedMedicine) {
      alert('Select the medicine that was added to inventory (after purchase / master data).');
      return;
    }
    const q = parseInt(cartQty, 10);
    try {
      await fulfillMutation.mutateAsync({
        demandId: selectedDemand.id,
        medicineId: selectedMedicine.id,
        quantity: !isNaN(q) && q > 0 ? q : 1,
        fulfillmentNote: fulfillNote,
        purchaseInvoiceId: purchaseInvoiceId,
      });
      setFulfillOpen(false);
      setSelectedDemand(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to fulfill');
    }
  };

  const handleReject = async () => {
    if (!selectedDemand || !rejectReason.trim()) {
      alert('Enter a rejection reason');
      return;
    }
    try {
      await rejectMutation.mutateAsync({ demandId: selectedDemand.id, reason: rejectReason.trim() });
      setRejectOpen(false);
      setSelectedDemand(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to reject');
    }
  };

  if (isLoading) return <Loading message="Loading product demands..." />;
  if (error) return <Typography color="error">Failed to load demands</Typography>;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Product demands' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h4" display="flex" alignItems="center" gap={1}>
          <PostAdd color="primary" />
          Product demands
        </Typography>
        <ToggleButtonGroup
          value={filter}
          exclusive
          onChange={(_, v) => v && setFilter(v)}
          size="small"
        >
          <ToggleButton value="pending">Pending</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Workflow: add the medicine in{' '}
        <MuiLink component="button" type="button" onClick={() => navigate('/inventory')}>
          Inventory
        </MuiLink>
        , record stock via{' '}
        <MuiLink component="button" type="button" onClick={() => navigate('/purchases/new')}>
          New purchase invoice
        </MuiLink>
        , then select that product below and fulfill — the retailer gets a notification and the item is queued for their cart.
      </Alert>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Requested product</TableCell>
              <TableCell>Manufacturer</TableCell>
              <TableCell>Retailer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No demands in this view.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Typography fontWeight={600}>{row.productName}</Typography>
                    {row.notes ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.notes}
                      </Typography>
                    ) : null}
                    {row.fulfilledMedicineName ? (
                      <Typography variant="caption" color="success.main" display="block">
                        Fulfilled as: {row.fulfilledMedicineName}
                      </Typography>
                    ) : null}
                    {row.rejectionReason ? (
                      <Typography variant="caption" color="error" display="block">
                        Rejected: {row.rejectionReason}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.manufacturerName}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.retailerName || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.retailerEmail || row.retailerId}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.status}
                      color={
                        row.status === 'fulfilled'
                          ? 'success'
                          : row.status === 'rejected'
                            ? 'default'
                            : 'warning'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {row.createdAt
                      ? format(
                          row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
                          'dd MMM yyyy HH:mm'
                        )
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {row.status === 'pending' ? (
                      <>
                        <Button size="small" variant="contained" color="success" onClick={() => openFulfill(row)} sx={{ mr: 1 }}>
                          Fulfill
                        </Button>
                        <Button size="small" color="error" onClick={() => openReject(row)}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {row.fulfillmentNote || row.purchaseInvoiceId || '—'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={fulfillOpen} onClose={() => setFulfillOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Fulfill demand</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Requested: <strong>{selectedDemand?.productName}</strong> — {selectedDemand?.manufacturerName}
          </Typography>
          <Autocomplete
            sx={{ mt: 2 }}
            options={medicines || []}
            getOptionLabel={(m) => `${m.name} (${m.manufacturer || ''}) [${m.code || m.id}]`}
            value={selectedMedicine}
            onChange={(_, v) => setSelectedMedicine(v)}
            renderInput={(params) => (
              <TextField {...params} label="Medicine in master (after you added + purchased stock)" required />
            )}
          />
          <TextField
            fullWidth
            label="Quantity to add to retailer cart"
            type="number"
            value={cartQty}
            onChange={(e) => setCartQty(e.target.value)}
            sx={{ mt: 2 }}
            inputProps={{ min: 1 }}
          />
          <TextField
            fullWidth
            label="Fulfillment note (internal)"
            value={fulfillNote}
            onChange={(e) => setFulfillNote(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="e.g. Added via supplier X"
          />
          <TextField
            fullWidth
            label="Purchase invoice # (reference)"
            value={purchaseInvoiceId}
            onChange={(e) => setPurchaseInvoiceId(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="Optional — paste invoice number for your records"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFulfillOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleFulfill} disabled={fulfillMutation.isPending}>
            Fulfill & notify retailer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject demand</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={rejectMutation.isPending}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import * as XLSX from 'xlsx';
import { FileDownload, PostAdd, Search } from '@mui/icons-material';
import { useProductDemands, useFulfillProductDemand, useRejectProductDemand } from '../hooks/useProductDemands';
import { useMedicines } from '../hooks/useInventory';
import { ProductDemand, Medicine } from '../types';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  searchMedicinesTypesenseAdmin,
  resolveMedicineAfterPickerSelection,
  refineMedicineSearchResults,
} from '../services/medicineSearch';
import { MEDICINE_SEARCH_DEBOUNCE_MS } from '../constants/medicineSearchDebounce';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';

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

  const [fulfillMedicineSearchInput, setFulfillMedicineSearchInput] = useState('');
  const [fulfillMedicineSearchHits, setFulfillMedicineSearchHits] = useState<Medicine[]>([]);
  const [fulfillMedicineSearchLoading, setFulfillMedicineSearchLoading] = useState(false);
  const fulfillMedicineSearchSeq = useRef(0);
  const fulfillMedicineSearchInputRef = useRef(fulfillMedicineSearchInput);
  fulfillMedicineSearchInputRef.current = fulfillMedicineSearchInput;

  const filtered = useMemo(() => {
    if (!demands) return [];
    if (filter === 'pending') return demands.filter((d) => d.status === 'pending');
    return demands;
  }, [demands, filter]);

  useEffect(() => {
    if (!fulfillOpen) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchInput('');
      setFulfillMedicineSearchHits([]);
      setFulfillMedicineSearchLoading(false);
      setSelectedMedicine(null);
    }
  }, [fulfillOpen]);

  useEffect(() => {
    if (!fulfillOpen) return;

    const trimmed = fulfillMedicineSearchInput.trim();
    if (trimmed.length < 2) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchHits([]);
      setFulfillMedicineSearchLoading(false);
      return;
    }
    if (
      selectedMedicine &&
      trimmed === getMedicinePickerLabel(selectedMedicine).trim()
    ) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchLoading(false);
      return;
    }
    const seq = ++fulfillMedicineSearchSeq.current;
    setFulfillMedicineSearchHits([]);
    setFulfillMedicineSearchLoading(true);
    const t = setTimeout(() => {
      searchMedicinesTypesenseAdmin(trimmed, { hydrate: false, limit: 40, strict: true })
        .then((rows) => {
          if (fulfillMedicineSearchSeq.current !== seq) return;
          if (fulfillMedicineSearchInputRef.current.trim() !== trimmed) return;
          setFulfillMedicineSearchHits(rows);
        })
        .finally(() => {
          if (fulfillMedicineSearchSeq.current === seq) {
            setFulfillMedicineSearchLoading(false);
          }
        });
    }, MEDICINE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fulfillOpen, fulfillMedicineSearchInput, selectedMedicine]);

  const fulfillMasterMedicineOptions = useMemo(() => {
    const q = fulfillMedicineSearchInput.trim();
    const all = medicines || [];

    if (
      selectedMedicine &&
      q === getMedicinePickerLabel(selectedMedicine).trim()
    ) {
      return [selectedMedicine];
    }

    if (q.length >= 2) {
      let list = refineMedicineSearchResults(fulfillMedicineSearchHits, q, all);
      if (selectedMedicine && !list.some((m) => m.id === selectedMedicine.id)) {
        return [selectedMedicine, ...list];
      }
      return list;
    }

    if (selectedMedicine && !all.some((m) => m.id === selectedMedicine.id)) {
      return [selectedMedicine];
    }
    return [];
  }, [fulfillMedicineSearchInput, fulfillMedicineSearchHits, medicines, selectedMedicine]);

  const openFulfill = (d: ProductDemand) => {
    setSelectedDemand(d);
    setSelectedMedicine(null);
    setFulfillMedicineSearchInput('');
    setFulfillMedicineSearchHits([]);
    fulfillMedicineSearchSeq.current += 1;
    setFulfillNote('');
    setPurchaseInvoiceId('');
    const q = d.requestedQuantity;
    const n = typeof q === 'number' && !isNaN(q) && q >= 1 ? Math.floor(q) : 1;
    setCartQty(String(n));
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
      setSelectedMedicine(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to fulfill');
    }
  };

  const downloadDemandsExcel = () => {
    if (filtered.length === 0) {
      alert('No demands in this view to export');
      return;
    }
    const rows = filtered.map((d) => ({
      'Requested product': d.productName,
      Manufacturer: d.manufacturerName,
      Quantity: d.requestedQuantity,
      Unit: d.requestedUnit,
      Notes: d.notes ?? '',
      Retailer: d.retailerName ?? '',
      'Retailer email': d.retailerEmail ?? '',
      'Retailer id': d.retailerId,
      Status: d.status,
      'Created at': d.createdAt
        ? format(
            d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt as string | number),
            'yyyy-MM-dd HH:mm'
          )
        : '',
      'Fulfilled as': d.fulfilledMedicineName ?? '',
      'Fulfillment note': d.fulfillmentNote ?? '',
      'Purchase invoice ref': d.purchaseInvoiceId ?? '',
      'Rejection reason': d.rejectionReason ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Product demands');
    const stamp = format(new Date(), 'yyyy-MM-dd');
    XLSX.writeFile(wb, `product-demands-${stamp}.xlsx`);
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
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <ToggleButtonGroup
            value={filter}
            exclusive
            onChange={(_, v) => v && setFilter(v)}
            size="small"
          >
            <ToggleButton value="pending">Pending</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownload />}
            onClick={downloadDemandsExcel}
            disabled={!demands?.length || filtered.length === 0}
          >
            Download Excel
          </Button>
        </Box>
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
              <TableCell align="right">Qty</TableCell>
              <TableCell>Retailer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
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
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {row.requestedQuantity}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {row.requestedUnit}
                    </Typography>
                  </TableCell>
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
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Retailer needs:{' '}
            <strong>
              {selectedDemand?.requestedQuantity} {selectedDemand?.requestedUnit}
            </strong>{' '}
            (cart quantity below defaults to this; adjust if needed)
          </Typography>
          <Autocomplete
            sx={{ mt: 2 }}
            loading={fulfillMedicineSearchLoading}
            options={fulfillMasterMedicineOptions}
            getOptionLabel={getMedicinePickerLabel}
            value={selectedMedicine}
            inputValue={fulfillMedicineSearchInput}
            onInputChange={(_, newInputValue, reason) => {
              if (reason === 'clear') {
                setFulfillMedicineSearchInput('');
                setSelectedMedicine(null);
                return;
              }
              if (reason === 'input') {
                setFulfillMedicineSearchInput(newInputValue);
                if (
                  selectedMedicine &&
                  newInputValue !== getMedicinePickerLabel(selectedMedicine)
                ) {
                  setSelectedMedicine(null);
                }
                return;
              }
              setFulfillMedicineSearchInput(newInputValue);
            }}
            onChange={(_, newValue) => {
              setFulfillMedicineSearchHits([]);
              if (!newValue) {
                setSelectedMedicine(null);
                setFulfillMedicineSearchInput('');
                return;
              }
              void resolveMedicineAfterPickerSelection(newValue, medicines ?? undefined).then((merged) => {
                setSelectedMedicine(merged);
                setFulfillMedicineSearchInput(getMedicinePickerLabel(merged));
              });
            }}
            filterOptions={(options) => options}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Medicine in master (after you added + purchased stock)"
                required
                placeholder="Type 2+ letters to search by name or manufacturer…"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
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

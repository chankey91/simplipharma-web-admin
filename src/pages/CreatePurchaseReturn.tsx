import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Autocomplete,
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
  Card,
  CardContent,
  Divider,
  CircularProgress,
  Chip,
  Alert,
} from '@mui/material';
import { Add, Delete, Search, ArrowBack } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useVendors } from '../hooks/useVendors';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { useCreatePurchaseReturnsMultiVendor } from '../hooks/usePurchaseReturns';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  findMedicinesByBatchNumberQuery,
  getMedicinesByIdsWithBatches,
} from '../services/inventory';
import { deriveSearchMatchTokens } from '../services/medicineSearch';
import {
  buildPurchaseReturnBatchOptions,
  PurchaseReturnBatchOption,
} from '../utils/purchaseReturnSearch';
import { Medicine, PurchaseReturnItem, Vendor } from '../types';
import type { CreatePurchaseReturnInput } from '../services/purchaseReturns';

type DraftLine = PurchaseReturnItem & {
  availableQuantity: number;
  vendorId: string;
  vendorName: string;
};

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

function formatExpiry(expiryDate: Date | unknown | undefined): string {
  if (!expiryDate) return '—';
  const d =
    expiryDate instanceof Date
      ? expiryDate
      : typeof (expiryDate as { toDate?: () => Date }).toDate === 'function'
        ? (expiryDate as { toDate: () => Date }).toDate()
        : new Date(expiryDate as string | number);
  if (!Number.isFinite(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function lineTax(item: { purchasePrice: number; quantity: number; gstRate?: number }): number {
  const base = (Number(item.purchasePrice) || 0) * (Number(item.quantity) || 0);
  const rate = Number(item.gstRate) || 0;
  return Math.round(base * (rate / 100) * 100) / 100;
}

export const CreatePurchaseReturnPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert, confirm } = useAppDialog();
  const { data: vendors } = useVendors();
  const createMutation = useCreatePurchaseReturnsMultiVendor();

  /** Vendor applied to the next item you add — change freely between items. */
  const [vendorId, setVendorId] = useState('');
  const [returnDate, setReturnDate] = useState(toInputDate(new Date()));
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<DraftLine[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [selectedOption, setSelectedOption] = useState<PurchaseReturnBatchOption | null>(null);
  const [hydratedMedicines, setHydratedMedicines] = useState<Medicine[]>([]);
  const [batchLookupMedicines, setBatchLookupMedicines] = useState<Medicine[]>([]);
  const [hydrating, setHydrating] = useState(false);

  const [qtyDialog, setQtyDialog] = useState<{
    open: boolean;
    option: PurchaseReturnBatchOption | null;
    quantity: string;
  }>({ open: false, option: null, quantity: '1' });

  const {
    medicines: searchMedicines,
    loading: searchLoading,
  } = useMedicineSearch(searchInput, {
    hydrate: false,
    limit: 40,
    skipQuery: selectedOption?.label,
  });

  useEffect(() => {
    const ids = searchMedicines.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) {
      setHydratedMedicines([]);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    void getMedicinesByIdsWithBatches(ids)
      .then((rows) => {
        if (!cancelled) setHydratedMedicines(rows);
      })
      .catch(() => {
        if (!cancelled) setHydratedMedicines([]);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchMedicines]);

  useEffect(() => {
    const tokens = deriveSearchMatchTokens(searchInput);
    const batchLike = tokens.filter((t) => /[a-z0-9]/i.test(t) && t.length >= 2);
    if (batchLike.length === 0 || searchInput.trim().length < 2) {
      setBatchLookupMedicines([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(batchLike.map((t) => findMedicinesByBatchNumberQuery(t)))
        .then((lists) => {
          if (cancelled) return;
          const byId = new Map<string, Medicine>();
          for (const list of lists) {
            for (const m of list) byId.set(m.id, m);
          }
          setBatchLookupMedicines([...byId.values()]);
        })
        .catch(() => {
          if (!cancelled) setBatchLookupMedicines([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput]);

  const medicinePool = useMemo(() => {
    const byId = new Map<string, Medicine>();
    for (const m of hydratedMedicines) byId.set(m.id, m);
    for (const m of batchLookupMedicines) byId.set(m.id, m);
    return [...byId.values()];
  }, [hydratedMedicines, batchLookupMedicines]);

  const batchOptions = useMemo(
    () => buildPurchaseReturnBatchOptions(medicinePool, searchInput, { onlyInStock: true }),
    [medicinePool, searchInput]
  );

  const vendorOptions = useMemo(
    () => (vendors ?? []).filter((v) => v.isActive !== false),
    [vendors]
  );
  const selectedVendor: Vendor | null =
    vendorOptions.find((v) => v.id === vendorId) ?? null;

  const vendorGroups = useMemo(() => {
    const map = new Map<string, { vendorId: string; vendorName: string; lines: DraftLine[] }>();
    for (const it of items) {
      const g = map.get(it.vendorId) || {
        vendorId: it.vendorId,
        vendorName: it.vendorName,
        lines: [] as DraftLine[],
      };
      g.lines.push(it);
      map.set(it.vendorId, g);
    }
    return [...map.values()];
  }, [items]);

  const subTotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + (Number(it.purchasePrice) || 0) * (Number(it.quantity) || 0),
        0
      ),
    [items]
  );
  const taxAmount = useMemo(() => items.reduce((sum, it) => sum + lineTax(it), 0), [items]);
  const totalAmount = Math.round((subTotal + taxAmount) * 100) / 100;

  const openQtyDialog = (option: PurchaseReturnBatchOption) => {
    if (!selectedVendor) {
      void alert('Select the vendor for this item first. You can change vendor between items.');
      setSelectedOption(null);
      return;
    }
    setQtyDialog({ open: true, option, quantity: '1' });
  };

  const handleConfirmQty = () => {
    const option = qtyDialog.option;
    if (!option) return;
    if (!selectedVendor) {
      void alert('Select a vendor for this item');
      return;
    }
    const qty = parseInt(qtyDialog.quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      void alert('Enter a valid return quantity');
      return;
    }
    if (qty > option.availableQuantity) {
      void alert(`Only ${option.availableQuantity} available in batch ${option.batchNumber}`);
      return;
    }

    const unitPrice = option.purchasePrice;
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    const batchKey = `${option.medicineId}::${option.batchNumber.toLowerCase()}`;

    const existing = items.find(
      (it) => `${it.medicineId}::${it.batchNumber.toLowerCase()}` === batchKey
    );
    if (existing) {
      if (existing.vendorId !== selectedVendor.id) {
        void alert(
          `This batch is already listed for ${existing.vendorName}. Remove it first if you need a different vendor.`
        );
        return;
      }
      const nextQty = existing.quantity + qty;
      if (nextQty > option.availableQuantity) {
        void alert(
          `Cannot exceed available ${option.availableQuantity} for batch ${option.batchNumber}`
        );
        return;
      }
      setItems((prev) =>
        prev.map((it) =>
          `${it.medicineId}::${it.batchNumber.toLowerCase()}` === batchKey
            ? {
                ...it,
                quantity: nextQty,
                totalAmount: Math.round(unitPrice * nextQty * 100) / 100,
              }
            : it
        )
      );
    } else {
      setItems((prev) => [
        ...prev,
        {
          medicineId: option.medicineId,
          medicineName: option.medicineName,
          batchNumber: option.batchNumber,
          quantity: qty,
          unitPrice,
          purchasePrice: unitPrice,
          mrp: option.mrp,
          gstRate: option.gstRate ?? 5,
          expiryDate: option.expiryDate,
          totalAmount: lineTotal,
          availableQuantity: option.availableQuantity,
          vendorId: selectedVendor.id,
          vendorName: selectedVendor.vendorName,
        },
      ]);
    }

    setQtyDialog({ open: false, option: null, quantity: '1' });
    setSelectedOption(null);
    setSearchInput('');
  };

  const handleRemove = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (items.length === 0) {
      await alert('Add at least one item');
      return;
    }
    if (items.some((it) => !it.vendorId)) {
      await alert('Every item needs a vendor');
      return;
    }
    const date = new Date(returnDate);
    if (!Number.isFinite(date.getTime())) {
      await alert('Enter a valid return date');
      return;
    }

    const vendorSummary = vendorGroups
      .map((g) => `• ${g.vendorName}: ${g.lines.length} item(s)`)
      .join('\n');
    const ok = await confirm(
      `Create ${vendorGroups.length} purchase return(s) for ${items.length} item(s), total ₹${totalAmount.toFixed(2)}?\n\n${vendorSummary}\n\nStock will be deducted from inventory.`
    );
    if (!ok) return;

    try {
      const payloads: CreatePurchaseReturnInput[] = vendorGroups.map((g) => {
        const lines = g.lines;
        const groupSub = lines.reduce(
          (s, it) => s + (Number(it.purchasePrice) || 0) * (Number(it.quantity) || 0),
          0
        );
        const groupTax = lines.reduce((s, it) => s + lineTax(it), 0);
        return {
          vendorId: g.vendorId,
          vendorName: g.vendorName,
          returnDate: date,
          items: lines.map(
            ({ availableQuantity: _a, vendorId: _v, vendorName: _n, ...rest }) => rest
          ),
          subTotal: Math.round(groupSub * 100) / 100,
          taxAmount: Math.round(groupTax * 100) / 100,
          totalAmount: Math.round((groupSub + groupTax) * 100) / 100,
          notes: notes.trim() || undefined,
          reason: reason.trim() || undefined,
        };
      });

      const results = await createMutation.mutateAsync(payloads);
      const nums = results.map((r) => r.returnNumber).join(', ');
      await alert(
        results.length === 1
          ? `Purchase return ${nums} created`
          : `${results.length} purchase returns created: ${nums}`
      );
      navigate(results.length === 1 ? `/purchase-returns/${results[0].id}` : '/purchase-returns');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create purchase return';
      await alert(msg);
    }
  };

  const optionsLoading = searchLoading || hydrating;

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchase returns', path: '/purchase-returns' },
          { label: 'Create' },
        ]}
      />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Create Purchase Return</Typography>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/purchase-returns')}>
          Back
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Add medicines one by one from different vendors on this screen. Select a vendor, add
        item(s), switch vendor, add the next — save creates one return document per vendor.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Return details
            </Typography>
            <TextField
              fullWidth
              label="Return date"
              type="date"
              required
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
            />
            <Autocomplete
              fullWidth
              options={vendorOptions}
              getOptionLabel={(o) => o.vendorName || ''}
              value={selectedVendor}
              onChange={(_, v) => setVendorId(v?.id || '')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Vendor for next item"
                  required
                  placeholder="Search vendor…"
                  helperText="Change this before adding items from another vendor"
                />
              )}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              sx={{ mb: 2 }}
            />
            {selectedVendor && (
              <Card variant="outlined" sx={{ mb: 2, bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="body2" fontWeight="medium">
                    Next items → {selectedVendor.vendorName}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    GST: {selectedVendor.gstNumber || '—'}
                  </Typography>
                </CardContent>
              </Card>
            )}
            <TextField
              fullWidth
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              sx={{ mb: 2 }}
              placeholder="Expiry / damaged / retailer return…"
            />
            <TextField
              fullWidth
              label="Notes"
              multiline
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Summary
            </Typography>
            {vendorGroups.length > 1 && (
              <Box mb={2}>
                {vendorGroups.map((g) => {
                  const gSub = g.lines.reduce(
                    (s, it) =>
                      s + (Number(it.purchasePrice) || 0) * (Number(it.quantity) || 0),
                    0
                  );
                  const gTax = g.lines.reduce((s, it) => s + lineTax(it), 0);
                  return (
                    <Box key={g.vendorId} display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="textSecondary">
                        {g.vendorName} ({g.lines.length})
                      </Typography>
                      <Typography variant="body2">
                        ₹{(gSub + gTax).toFixed(2)}
                      </Typography>
                    </Box>
                  );
                })}
                <Divider sx={{ my: 1 }} />
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal:</Typography>
              <Typography>₹{subTotal.toFixed(2)}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax:</Typography>
              <Typography>₹{taxAmount.toFixed(2)}</Typography>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between">
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{totalAmount.toFixed(2)}</Typography>
            </Box>
            <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1 }}>
              {vendorGroups.length === 0
                ? 'No vendors yet'
                : vendorGroups.length === 1
                  ? '1 purchase return will be created'
                  : `${vendorGroups.length} purchase returns will be created (one per vendor)`}
            </Typography>
            <Button
              fullWidth
              variant="contained"
              sx={{ mt: 2 }}
              onClick={() => void handleSave()}
              disabled={createMutation.isPending || items.length === 0}
            >
              {createMutation.isPending
                ? 'Saving…'
                : vendorGroups.length > 1
                  ? `Create ${vendorGroups.length} purchase returns`
                  : 'Create purchase return'}
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2}>
              <Typography variant="h6">Return items</Typography>
              <Autocomplete
                sx={{ flex: 1, maxWidth: 520 }}
                loading={optionsLoading}
                options={batchOptions}
                getOptionLabel={(o) => o.label}
                value={selectedOption}
                inputValue={searchInput}
                onInputChange={(_, v, reason) => {
                  if (reason === 'clear') {
                    setSearchInput('');
                    setSelectedOption(null);
                    return;
                  }
                  if (reason === 'input') {
                    setSearchInput(v);
                    setSelectedOption(null);
                    return;
                  }
                  setSearchInput(v);
                }}
                onChange={(_, opt) => {
                  if (!opt) {
                    setSelectedOption(null);
                    return;
                  }
                  setSelectedOption(opt);
                  openQtyDialog(opt);
                }}
                filterOptions={(opts) => opts}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Search medicine / batch"
                    placeholder="Name, batch, or both — e.g. dolo ABC123"
                    size="small"
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                      endAdornment: (
                        <>
                          {optionsLoading ? <CircularProgress color="inherit" size={18} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                noOptionsText={
                  searchInput.trim().length < 2
                    ? 'Type at least 2 characters'
                    : optionsLoading
                      ? 'Searching…'
                      : 'No in-stock batches found'
                }
              />
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell align="right">Avail</TableCell>
                    <TableCell align="right">Return qty</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="center" width={56} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        <Typography variant="body2" color="textSecondary" sx={{ py: 3 }}>
                          Select vendor → search medicine/batch → add. Repeat for other vendors.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => (
                      <TableRow key={`${item.vendorId}-${item.medicineId}-${item.batchNumber}-${index}`}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            {item.medicineName}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            Exp: {formatExpiry(item.expiryDate)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={item.vendorName} variant="outlined" />
                        </TableCell>
                        <TableCell>{item.batchNumber}</TableCell>
                        <TableCell align="right">{item.availableQuantity}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">
                          ₹{(item.purchasePrice || 0).toFixed(2)}
                        </TableCell>
                        <TableCell align="right">
                          ₹{(item.totalAmount || 0).toFixed(2)}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemove(index)}
                            aria-label="Remove"
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      <Dialog
        open={qtyDialog.open}
        onClose={() => setQtyDialog({ open: false, option: null, quantity: '1' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Return quantity</DialogTitle>
        <DialogContent>
          {qtyDialog.option && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle1" fontWeight="medium">
                {qtyDialog.option.medicineName}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Batch {qtyDialog.option.batchNumber} · Available{' '}
                {qtyDialog.option.availableQuantity} · Rate ₹
                {qtyDialog.option.purchasePrice.toFixed(2)}
              </Typography>
              {selectedVendor && (
                <Chip
                  size="small"
                  color="primary"
                  label={`Vendor: ${selectedVendor.vendorName}`}
                  sx={{ mb: 2 }}
                />
              )}
              <TextField
                fullWidth
                label="Quantity to return"
                type="number"
                value={qtyDialog.quantity}
                onChange={(e) => setQtyDialog((d) => ({ ...d, quantity: e.target.value }))}
                inputProps={{ min: 1, max: qtyDialog.option.availableQuantity }}
                autoFocus
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQtyDialog({ open: false, option: null, quantity: '1' })}>
            Cancel
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={handleConfirmQty}>
            Add to list
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

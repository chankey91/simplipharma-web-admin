import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Alert,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Autocomplete,
  CircularProgress,
} from '@mui/material';
import {
  QrCodeScanner,
  Save,
  Search,
} from '@mui/icons-material';
import { QRCodeScanner } from '../components/BarcodeScanner';
import {
  useMedicine,
  useMedicineBatches,
  useUpdateStock,
  useAddStockBatch,
  useSetStockBatchQuantity,
  useFindMedicineByBarcode,
} from '../hooks/useInventory';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useAppDialog } from '../context/AppDialogProvider';
import { getMedicineById, normalizeFirestoreDate } from '../services/inventory';
import { Medicine, StockBatch } from '../types';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';
import { getTodayDateStringIST } from '../utils/dateTime';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';

const toInputDate = (value: unknown): string => {
  const d = value instanceof Date ? value : normalizeFirestoreDate(value);
  return d ? format(d, 'yyyy-MM-dd') : '';
};

const batchKey = (value: string | undefined) => String(value || '').trim().toLowerCase();
const batchKeyLoose = (value: string | undefined) => batchKey(value).replace(/[\s\-_/]/g, '');

const findExistingBatch = (batches: StockBatch[] | undefined, batchNumber: string) => {
  const key = batchKey(batchNumber);
  const loose = batchKeyLoose(batchNumber);
  if (!key || !batches?.length) return undefined;
  return (
    batches.find((b) => batchKey(b.batchNumber) === key) ||
    batches.find((b) => batchKey(b.invoiceBatchNumber) === key) ||
    batches.find((b) => batchKeyLoose(b.batchNumber) === loose) ||
    batches.find((b) => batchKeyLoose(b.invoiceBatchNumber) === loose)
  );
};

export const StockUpdatePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const medicineIdFromUrl = searchParams.get('medicineId');

  const updateStock = useUpdateStock();
  const addBatch = useAddStockBatch();
  const setBatchQty = useSetStockBatchQuantity();
  const findMedicine = useFindMedicineByBarcode();
  const { alert } = useAppDialog();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(medicineIdFromUrl);
  const [searchInput, setSearchInput] = useState('');

  const { data: selectedMedicine, isLoading: medicineLoading, refetch: refetchMedicine } =
    useMedicine(selectedId || undefined);
  const { data: loadedBatches } = useMedicineBatches(selectedId || undefined);
  const batches = useMemo(() => {
    if (loadedBatches?.length) return loadedBatches;
    return selectedMedicine?.stockBatches ?? [];
  }, [loadedBatches, selectedMedicine?.stockBatches]);

  const skipLabel = selectedMedicine ? getMedicinePickerLabel(selectedMedicine) : undefined;
  const { medicines: searchHits, loading: searchLoading } = useMedicineSearch(searchInput, {
    hydrate: false,
    limit: 40,
    skipQuery: skipLabel,
  });

  const [stockData, setStockData] = useState({
    quantity: '',
    batchNumber: '',
    mfgDate: '',
    expiryDate: '',
    purchaseDate: getTodayDateStringIST(),
    purchasePrice: '',
    mrp: '',
  });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [savingBatch, setSavingBatch] = useState<string | null>(null);

  const batchSort = useTableSort('expiryDate', 'asc');
  const matchedBatch = useMemo(
    () => findExistingBatch(batches, stockData.batchNumber),
    [batches, stockData.batchNumber]
  );
  const sortedBatches = useMemo(() => {
    if (!batches.length) return [];
    const list = [...batches];
    list.sort((a, b) => {
      const mfgMs = (x: typeof a) => {
        if (!x.mfgDate) return 0;
        return toTimeMs(x.mfgDate instanceof Date ? x.mfgDate : x.mfgDate.toDate());
      };
      const expMs = (x: typeof a) =>
        toTimeMs(x.expiryDate instanceof Date ? x.expiryDate : x.expiryDate.toDate());
      switch (batchSort.sortKey) {
        case 'batchNumber':
          return applyDirection(compareAsc(a.batchNumber, b.batchNumber), batchSort.sortDirection);
        case 'quantity':
          return applyDirection(compareAsc(a.quantity, b.quantity), batchSort.sortDirection);
        case 'mfgDate':
          return applyDirection(compareAsc(mfgMs(a), mfgMs(b)), batchSort.sortDirection);
        case 'expiryDate':
          return applyDirection(compareAsc(expMs(a), expMs(b)), batchSort.sortDirection);
        case 'mrp':
          return applyDirection(compareAsc(a.mrp ?? 0, b.mrp ?? 0), batchSort.sortDirection);
        default:
          return applyDirection(compareAsc(expMs(a), expMs(b)), 'asc');
      }
    });
    return list;
  }, [batches, selectedMedicine?.id, batchSort.sortKey, batchSort.sortDirection]);

  useEffect(() => {
    if (medicineIdFromUrl) setSelectedId(medicineIdFromUrl);
  }, [medicineIdFromUrl]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const b of batches) {
      next[b.batchNumber] = String(b.quantity ?? 0);
    }
    setQtyDrafts(next);
  }, [selectedMedicine?.id, batches]);

  const handleSetPhysicalQty = async (batchNumber: string) => {
    if (!selectedMedicine) return;
    const qty = Math.floor(Number(qtyDrafts[batchNumber]));
    if (!Number.isFinite(qty) || qty < 0) {
      await alert('Enter a quantity of 0 or more.', { severity: 'warning' });
      return;
    }
    setError(null);
    setSavingBatch(batchNumber);
    try {
      await setBatchQty.mutateAsync({
        medicineId: selectedMedicine.id,
        batchNumber,
        quantity: qty,
      });
      setSuccess(`Set ${batchNumber} to ${qty}. This replaces the quantity (does not add).`);
      await refetchMedicine();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to set quantity';
      setError(msg);
    } finally {
      setSavingBatch(null);
    }
  };

  const handleBarcodeScan = async (barcode: string) => {
    setBarcodeInput(barcode);
    setError(null);
    try {
      const result = await findMedicine.mutateAsync(barcode);
      if (result) {
        setSelectedId(result.id);
        setSearchInput(getMedicinePickerLabel(result));
        setSuccess('Medicine found!');
      } else {
        setError('Medicine not found with this barcode');
      }
    } catch {
      setError('Error searching for medicine');
    }
  };

  const applyExistingBatch = (batch: StockBatch, opts?: { keepQuantity?: boolean }) => {
    setStockData((prev) => ({
      quantity: opts?.keepQuantity ? prev.quantity : '',
      batchNumber: batch.batchNumber,
      mfgDate: toInputDate(batch.mfgDate),
      expiryDate: toInputDate(batch.expiryDate),
      purchaseDate: toInputDate(batch.purchaseDate) || prev.purchaseDate || getTodayDateStringIST(),
      purchasePrice: batch.purchasePrice != null ? String(batch.purchasePrice) : '',
      mrp: batch.mrp != null ? String(batch.mrp) : '',
    }));
    setError(null);
    setSuccess(
      `Filled from existing batch ${batch.batchNumber}. Enter physical quantity, then Set qty on the row or Add / increase qty.`
    );
  };

  const handleBatchNumberChange = (value: string, reason?: string) => {
    if (reason === 'reset') return;
    const match = findExistingBatch(batches, value);
    if (match) {
      applyExistingBatch(match, { keepQuantity: true });
      return;
    }
    setStockData((prev) => ({ ...prev, batchNumber: value }));
  };

  useEffect(() => {
    if (!matchedBatch) return;
    const alreadyFilled =
      batchKey(stockData.batchNumber) === batchKey(matchedBatch.batchNumber) &&
      (Boolean(stockData.expiryDate) || Boolean(stockData.mrp) || Boolean(stockData.purchasePrice));
    if (alreadyFilled) return;
    applyExistingBatch(matchedBatch, { keepQuantity: true });
  }, [matchedBatch, stockData.batchNumber]);

  const handleSelectMedicine = async (picked: Medicine | null) => {
    if (!picked) {
      setSelectedId(null);
      return;
    }
    setSelectedId(picked.id);
    setSearchInput(getMedicinePickerLabel(picked));
    setStockData({
      quantity: '',
      batchNumber: '',
      mfgDate: '',
      expiryDate: '',
      purchaseDate: getTodayDateStringIST(),
      purchasePrice: '',
      mrp: '',
    });
    try {
      const full = await getMedicineById(picked.id);
      if (full) setSearchInput(getMedicinePickerLabel(full));
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    if (!selectedMedicine) {
      setError('Please select a medicine');
      return;
    }
    if (!stockData.quantity || !stockData.batchNumber || !stockData.expiryDate) {
      setError('Please fill all required fields (Quantity, Batch Number, Expiry Date)');
      return;
    }

    try {
      await addBatch.mutateAsync({
        medicineId: selectedMedicine.id,
        batch: {
          batchNumber: stockData.batchNumber,
          quantity: parseInt(stockData.quantity),
          mfgDate: stockData.mfgDate ? new Date(stockData.mfgDate) : undefined,
          expiryDate: new Date(stockData.expiryDate),
          purchaseDate: stockData.purchaseDate ? new Date(stockData.purchaseDate) : new Date(),
          purchasePrice: stockData.purchasePrice ? parseFloat(stockData.purchasePrice) : undefined,
          mrp: stockData.mrp ? parseFloat(stockData.mrp) : undefined,
        },
      });

      const expiry = new Date(stockData.expiryDate);
      const batchNumber = stockData.batchNumber;
      const mrp = stockData.mrp ? parseFloat(stockData.mrp) : selectedMedicine.mrp;

      setStockData({
        quantity: '',
        batchNumber: '',
        mfgDate: '',
        expiryDate: '',
        purchaseDate: getTodayDateStringIST(),
        purchasePrice: '',
        mrp: '',
      });
      setSuccess('Batch saved. If this batch already existed, the quantity was added to it.');

      await updateStock.mutateAsync({
        medicineId: selectedMedicine.id,
        updates: {
          expiryDate: expiry,
          batchNumber,
          mrp,
        },
      });
      await refetchMedicine();
    } catch (err: any) {
      setError(err.message || 'Failed to update stock');
    }
  };

  if (medicineIdFromUrl && medicineLoading && !selectedMedicine) {
    return <Loading message="Loading medicine..." />;
  }

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Inventory', path: '/inventory' }, { label: 'Update stock' }]} />
      <Box display="flex" alignItems="center" mb={2}>
        <Typography variant="h4">Update stock</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        After a stock zero, open the medicine, type the physical quantity on the existing batch, and
        click Set qty. That replaces the number. Add batch below is only for a new lot, or to add
        extra units on top of the current qty.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Find Medicine
            </Typography>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<QrCodeScanner />}
              onClick={() => setScannerOpen(true)}
              sx={{ mb: 2 }}
            >
              Scan Barcode
            </Button>
            <TextField
              fullWidth
              label="Enter Barcode/Code"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleBarcodeScan(barcodeInput)}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: (
                  <IconButton onClick={() => handleBarcodeScan(barcodeInput)}>
                    <Search />
                  </IconButton>
                ),
              }}
            />
            <Autocomplete
              options={searchHits}
              loading={searchLoading}
              value={selectedMedicine ?? null}
              inputValue={searchInput}
              onInputChange={(_e, v) => setSearchInput(v)}
              onChange={(_e, v) => void handleSelectMedicine(v)}
              getOptionLabel={(m) => getMedicinePickerLabel(m)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(x) => x}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search medicine (Typesense)"
                  placeholder="Type 2+ characters…"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            {selectedMedicine && (
              <Card sx={{ mt: 3, bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
                <CardContent>
                  <Typography variant="subtitle2" color="primary">
                    Current Info
                  </Typography>
                  <Typography variant="h6">{selectedMedicine.name}</Typography>
                  {selectedMedicine.productId ? (
                    <Typography variant="body2" color="text.secondary">
                      Product ID: {selectedMedicine.productId}
                    </Typography>
                  ) : null}
                  <Typography variant="body2">
                    Current Stock: {selectedMedicine.currentStock ?? selectedMedicine.stock ?? 0}
                  </Typography>
                  <Typography variant="body2">Category: {selectedMedicine.category}</Typography>
                </CardContent>
              </Card>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Add new batch or add qty
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  freeSolo
                  options={batches.map((b) => b.batchNumber)}
                  inputValue={stockData.batchNumber}
                  onInputChange={(_e, value, reason) => handleBatchNumberChange(value, reason)}
                  onChange={(_e, value) => handleBatchNumberChange(String(value || ''), 'selectOption')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Batch Number"
                      required
                      helperText={
                        matchedBatch
                          ? `Existing batch ${matchedBatch.batchNumber} — expiry, MRP and price filled from inventory`
                          : batches.length
                            ? 'Type or pick an existing batch to auto-fill expiry / MRP'
                            : selectedMedicine
                              ? 'No batches loaded for this medicine yet'
                              : 'Select a medicine first, then type the batch'
                      }
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Quantity"
                  type="number"
                  required
                  value={stockData.quantity}
                  onChange={(e) => setStockData({ ...stockData, quantity: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Mfg Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={stockData.mfgDate}
                  onChange={(e) => setStockData({ ...stockData, mfgDate: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Expiry Date"
                  type="date"
                  required
                  InputLabelProps={{ shrink: true }}
                  value={stockData.expiryDate}
                  onChange={(e) => setStockData({ ...stockData, expiryDate: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Purchase Date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={stockData.purchaseDate}
                  onChange={(e) => setStockData({ ...stockData, purchaseDate: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Purchase Price"
                  type="number"
                  value={stockData.purchasePrice}
                  onChange={(e) => setStockData({ ...stockData, purchasePrice: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="MRP"
                  type="number"
                  value={stockData.mrp}
                  onChange={(e) => setStockData({ ...stockData, mrp: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  onClick={() => void handleSave()}
                  disabled={!selectedMedicine || addBatch.isPending}
                >
                  {addBatch.isPending ? 'Saving…' : 'Add / increase qty'}
                </Button>
                <Button sx={{ ml: 1 }} onClick={() => navigate(-1)}>
                  Back
                </Button>
              </Grid>
            </Grid>

            {sortedBatches.length > 0 && (
              <Box mt={4}>
                <Typography variant="h6" gutterBottom>
                  Existing batches — set physical qty
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Set qty replaces the current number. Use this after Zero all stock.
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <SortableTableHeadCell
                          columnId="batchNumber"
                          label="Batch"
                          sortKey={batchSort.sortKey}
                          sortDirection={batchSort.sortDirection}
                          onRequestSort={batchSort.requestSort}
                        />
                        <SortableTableHeadCell
                          columnId="quantity"
                          label="Qty"
                          sortKey={batchSort.sortKey}
                          sortDirection={batchSort.sortDirection}
                          onRequestSort={batchSort.requestSort}
                        />
                        <SortableTableHeadCell
                          columnId="mfgDate"
                          label="Mfg"
                          sortKey={batchSort.sortKey}
                          sortDirection={batchSort.sortDirection}
                          onRequestSort={batchSort.requestSort}
                        />
                        <SortableTableHeadCell
                          columnId="expiryDate"
                          label="Expiry"
                          sortKey={batchSort.sortKey}
                          sortDirection={batchSort.sortDirection}
                          onRequestSort={batchSort.requestSort}
                        />
                        <SortableTableHeadCell
                          columnId="mrp"
                          label="MRP"
                          sortKey={batchSort.sortKey}
                          sortDirection={batchSort.sortDirection}
                          onRequestSort={batchSort.requestSort}
                        />
                        <TableCell align="right">Physical qty</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedBatches.map((b) => (
                        <TableRow
                          key={b.id || b.batchNumber}
                          hover
                          selected={batchKey(stockData.batchNumber) === batchKey(b.batchNumber)}
                          onClick={() => applyExistingBatch(b, { keepQuantity: true })}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell>{b.batchNumber}</TableCell>
                          <TableCell>{b.quantity}</TableCell>
                          <TableCell>
                            {b.mfgDate
                              ? format(
                                  b.mfgDate instanceof Date ? b.mfgDate : b.mfgDate.toDate(),
                                  'dd MMM yyyy'
                                )
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {format(
                              b.expiryDate instanceof Date ? b.expiryDate : b.expiryDate.toDate(),
                              'dd MMM yyyy'
                            )}
                          </TableCell>
                          <TableCell>{b.mrp ?? '—'}</TableCell>
                          <TableCell align="right">
                            <Box
                              display="flex"
                              gap={1}
                              justifyContent="flex-end"
                              alignItems="center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <TextField
                                size="small"
                                type="number"
                                value={qtyDrafts[b.batchNumber] ?? ''}
                                onChange={(e) =>
                                  setQtyDrafts((prev) => ({
                                    ...prev,
                                    [b.batchNumber]: e.target.value,
                                  }))
                                }
                                inputProps={{ min: 0, style: { width: 72 } }}
                              />
                              <Button
                                size="small"
                                variant="contained"
                                disabled={savingBatch === b.batchNumber || setBatchQty.isPending}
                                onClick={() => void handleSetPhysicalQty(b.batchNumber)}
                              >
                                {savingBatch === b.batchNumber ? 'Saving…' : 'Set qty'}
                              </Button>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      <QRCodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => {
          setScannerOpen(false);
          void handleBarcodeScan(code);
        }}
      />
    </Box>
  );
};

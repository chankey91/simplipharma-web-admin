import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  useUpdateStock,
  useAddStockBatch,
  useFindMedicineByBarcode,
} from '../hooks/useInventory';
import { getMedicineById } from '../services/inventory';
import { Medicine } from '../types';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';
import { getTodayDateStringIST } from '../utils/dateTime';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  searchMedicinesTypesenseAdmin,
} from '../services/medicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { MEDICINE_SEARCH_DEBOUNCE_MS } from '../constants/medicineSearchDebounce';

export const StockUpdatePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const medicineIdFromUrl = searchParams.get('medicineId');

  const updateStock = useUpdateStock();
  const addBatch = useAddStockBatch();
  const findMedicine = useFindMedicineByBarcode();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(medicineIdFromUrl);
  const [searchInput, setSearchInput] = useState('');
  const [searchHits, setSearchHits] = useState<Medicine[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchSeq = useRef(0);

  const { data: selectedMedicine, isLoading: medicineLoading, refetch: refetchMedicine } =
    useMedicine(selectedId || undefined);

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

  const batchSort = useTableSort('expiryDate', 'asc');
  const sortedBatches = useMemo(() => {
    const batches = selectedMedicine?.stockBatches;
    if (!batches?.length) return [];
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
  }, [selectedMedicine?.stockBatches, selectedMedicine?.id, batchSort.sortKey, batchSort.sortDirection]);

  useEffect(() => {
    if (medicineIdFromUrl) setSelectedId(medicineIdFromUrl);
  }, [medicineIdFromUrl]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length < 2) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearchLoading(true);
    const t = window.setTimeout(() => {
      searchMedicinesTypesenseAdmin(trimmed, { hydrate: false, limit: 40, strict: true })
        .then((rows) => {
          if (searchSeq.current === seq) setSearchHits(rows);
        })
        .catch(() => {
          if (searchSeq.current === seq) setSearchHits([]);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearchLoading(false);
        });
    }, MEDICINE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  const handleSelectMedicine = async (picked: Medicine | null) => {
    if (!picked) {
      setSelectedId(null);
      return;
    }
    setSelectedId(picked.id);
    setSearchInput(getMedicinePickerLabel(picked));
    // Ensure batches are loaded (useMedicine will fetch; also warm full doc)
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
      setSuccess('Stock updated successfully!');

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
      <Box display="flex" alignItems="center" mb={3}>
        <Typography variant="h4">Update Stock Inventory</Typography>
      </Box>

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
              Add New Stock Batch
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
                <TextField
                  fullWidth
                  label="Batch Number"
                  required
                  value={stockData.batchNumber}
                  onChange={(e) => setStockData({ ...stockData, batchNumber: e.target.value })}
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
                  {addBatch.isPending ? 'Saving…' : 'Add Batch'}
                </Button>
                <Button sx={{ ml: 1 }} onClick={() => navigate(-1)}>
                  Back
                </Button>
              </Grid>
            </Grid>

            {selectedMedicine?.stockBatches && selectedMedicine.stockBatches.length > 0 && (
              <Box mt={4}>
                <Typography variant="h6" gutterBottom>
                  Existing Batches for {selectedMedicine.name}
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
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedBatches.map((b) => (
                        <TableRow key={b.id || b.batchNumber}>
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

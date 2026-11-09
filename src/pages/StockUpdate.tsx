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
  Checkbox,
  FormControlLabel,
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
  useUpdateStockBatch,
  useUpdateMedicine,
  useFindMedicineByBarcode,
} from '../hooks/useInventory';
import { useVendorLastPurchases } from '../hooks/usePurchaseInvoices';
import { RetailerLastSchemeHint } from '../components/RetailerLastSchemeHint';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useAppDialog } from '../context/AppDialogProvider';
import { getMedicineById, normalizeFirestoreDate } from '../services/inventory';
import { Medicine, StockBatch } from '../types';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';
import { getTodayDateStringIST, getYearIST } from '../utils/dateTime';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { parseOptionalGstRate, resolveGstRate } from '../utils/gstRate';
import { purchaseItemStockBatchNumber } from '../utils/purchaseInvoiceBatch';

const MM_YY_HELPER = 'Format: MM/YY (e.g., 12/25)';

const parseNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const purchasePriceFromMrp = (mrp: number, gstRate: number, standardDiscount: number): number => {
  if (mrp <= 0) return 0;
  return (mrp * (1 - standardDiscount / 100)) / (1 + gstRate / 100);
};

const standardDiscountFromPrice = (mrp: number, purchasePrice: number, gstRate: number): number => {
  if (mrp <= 0 || purchasePrice <= 0) return 20;
  const priceWithGst = purchasePrice * (1 + gstRate / 100);
  return (1 - priceWithGst / mrp) * 100;
};

const emptyStockForm = () => ({
  batchNumber: '',
  receivedBatchNumber: '',
  quantity: '',
  freeQuantity: '',
  schemePaidQty: '',
  schemeFreeQty: '',
  nonReturnable: false,
  nrxDrug: false,
  mfgDate: '',
  expiryDate: '',
  purchaseDate: getTodayDateStringIST(),
  mrp: '',
  gstRate: '',
  standardDiscount: '20',
  purchasePrice: '',
  discountPercentage: '',
});

const toInputDate = (value: unknown): string => {
  const d = value instanceof Date ? value : normalizeFirestoreDate(value);
  return d ? format(d, 'yyyy-MM-dd') : '';
};

const toMmYy = (value: unknown): string => {
  const d = value instanceof Date ? value : normalizeFirestoreDate(value);
  return d ? format(d, 'MM/yy') : '';
};

const formatMmYyInput = (raw: string): string => {
  let value = raw.replace(/[^0-9/]/g, '');
  if (value.length === 3 && !value.includes('/')) {
    value = `${value.substring(0, 2)}/${value.substring(2)}`;
  }
  return value.slice(0, 5);
};

type MmYyParse = { ok: true; date: Date } | { ok: false; error: string };

const parseMmYy = (value: string): MmYyParse => {
  const parts = value.trim().split('/');
  if (parts.length !== 2) return { ok: false, error: 'Format must be MM/YY (e.g., 12/25)' };
  const monthStr = parts[0].trim();
  const yearStr = parts[1].trim();
  if (monthStr.length !== 2) return { ok: false, error: 'Month must be 2 digits (e.g., 01, 02, ..., 12)' };
  const month = parseInt(monthStr, 10);
  if (isNaN(month) || month < 1 || month > 12) return { ok: false, error: 'Month must be between 01 and 12' };
  if (yearStr.length !== 2) return { ok: false, error: 'Year must be 2 digits (e.g., 25)' };
  const yy = parseInt(yearStr, 10);
  if (isNaN(yy)) return { ok: false, error: 'Year must be a valid number' };
  const year = 2000 + yy;
  const currentYear = getYearIST();
  if (year < currentYear - 10 || year > currentYear + 20) {
    return { ok: false, error: `Year must be between ${currentYear - 10} and ${currentYear + 20}` };
  }
  return { ok: true, date: new Date(year, month - 1, 1) };
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
  const updateBatch = useUpdateStockBatch();
  const updateMedicine = useUpdateMedicine();
  const { lastPurchaseByMedicineId } = useVendorLastPurchases(undefined, undefined, {
    enabled: true,
  });
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

  const [stockData, setStockData] = useState(emptyStockForm);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batchDrafts, setBatchDrafts] = useState<
    Record<string, { batchNumber: string; quantity: string; expiry: string; mrp: string }>
  >({});
  const [savingBatch, setSavingBatch] = useState<string | null>(null);
  const [mfgError, setMfgError] = useState('');
  const [expiryError, setExpiryError] = useState('');

  const batchSort = useTableSort('expiryDate', 'asc');
  const stockBatchNumber = purchaseItemStockBatchNumber({
    batchNumber: stockData.batchNumber,
    receivedBatchNumber: stockData.receivedBatchNumber,
  });
  const matchedBatch = useMemo(
    () =>
      findExistingBatch(batches, stockBatchNumber) ||
      findExistingBatch(batches, stockData.batchNumber),
    [batches, stockBatchNumber, stockData.batchNumber]
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
    const next: Record<string, { batchNumber: string; quantity: string; expiry: string; mrp: string }> = {};
    for (const b of batches) {
      const key = b.id || b.batchNumber;
      next[key] = {
        batchNumber: b.batchNumber,
        quantity: String(b.quantity ?? 0),
        expiry: toMmYy(b.expiryDate),
        mrp: b.mrp != null ? String(b.mrp) : '',
      };
    }
    setBatchDrafts(next);
  }, [selectedMedicine?.id, batches]);

  const patchBatchDraft = (
    key: string,
    patch: Partial<{ batchNumber: string; quantity: string; expiry: string; mrp: string }>
  ) => {
    setBatchDrafts((prev) => ({
      ...prev,
      [key]: {
        batchNumber: prev[key]?.batchNumber ?? '',
        quantity: prev[key]?.quantity ?? '',
        expiry: prev[key]?.expiry ?? '',
        mrp: prev[key]?.mrp ?? '',
        ...patch,
      },
    }));
  };

  const handleSaveExistingBatch = async (batch: StockBatch) => {
    if (!selectedMedicine) return;
    const key = batch.id || batch.batchNumber;
    const draft = batchDrafts[key];
    const nextNumber = draft?.batchNumber.trim() ?? '';
    if (!nextNumber) {
      await alert('Enter a batch number.', { severity: 'warning' });
      return;
    }
    const qty = Math.floor(Number(draft?.quantity));
    if (!Number.isFinite(qty) || qty < 0) {
      await alert('Enter a quantity of 0 or more.', { severity: 'warning' });
      return;
    }
    const expiryParsed = parseMmYy(draft?.expiry ?? '');
    if (!expiryParsed.ok) {
      await alert(`Expiry date: ${expiryParsed.error}`, { severity: 'warning' });
      return;
    }
    const mrpRaw = draft?.mrp.trim() ?? '';
    let mrp: number | undefined;
    if (mrpRaw) {
      mrp = Number(mrpRaw);
      if (!Number.isFinite(mrp) || mrp < 0) {
        await alert('Enter a valid MRP, or leave it blank.', { severity: 'warning' });
        return;
      }
    }
    const clash = batches.some(
      (b) => (b.id || b.batchNumber) !== key && batchKey(b.batchNumber) === batchKey(nextNumber)
    );
    if (clash) {
      await alert(`Batch ${nextNumber} already exists on this medicine.`, { severity: 'warning' });
      return;
    }

    setError(null);
    setSavingBatch(key);
    try {
      await updateBatch.mutateAsync({
        medicineId: selectedMedicine.id,
        currentBatchNumber: batch.batchNumber,
        edit: {
          batchNumber: nextNumber,
          quantity: qty,
          expiryDate: expiryParsed.date,
          mrp,
        },
      });
      setSuccess(
        `Saved ${nextNumber}: qty ${qty}, expiry ${draft?.expiry.trim()}. This replaces the quantity (does not add).`
      );
      await refetchMedicine();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update batch';
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
    const invoiceBatch = batch.invoiceBatchNumber?.trim() || batch.batchNumber;
    const received =
      batch.invoiceBatchNumber && batchKey(batch.invoiceBatchNumber) !== batchKey(batch.batchNumber)
        ? batch.batchNumber
        : '';
    const gstRate = resolveGstRate(selectedMedicine?.gstRate);
    const mrp = batch.mrp && batch.mrp > 0 ? batch.mrp : 0;
    let purchasePrice = batch.purchasePrice && batch.purchasePrice > 0 ? batch.purchasePrice : 0;
    const standardDiscountSeed =
      batch.standardDiscount != null && Number.isFinite(batch.standardDiscount)
        ? batch.standardDiscount
        : 20;
    if (purchasePrice <= 0 && mrp > 0) {
      purchasePrice = purchasePriceFromMrp(mrp, gstRate, standardDiscountSeed);
    }
    const standardDiscount =
      mrp > 0 && purchasePrice > 0
        ? standardDiscountFromPrice(mrp, purchasePrice, gstRate)
        : standardDiscountSeed;
    setStockData((prev) => ({
      ...prev,
      quantity: opts?.keepQuantity ? prev.quantity : '',
      batchNumber: invoiceBatch,
      receivedBatchNumber: received,
      freeQuantity: prev.freeQuantity,
      schemePaidQty:
        batch.schemePaidQty != null && batch.schemePaidQty > 0 ? String(Math.floor(batch.schemePaidQty)) : '',
      schemeFreeQty:
        batch.schemeFreeQty != null && batch.schemeFreeQty > 0 ? String(Math.floor(batch.schemeFreeQty)) : '',
      nonReturnable: batch.nonReturnable === true,
      nrxDrug: batch.nrxDrug === true,
      mfgDate: toMmYy(batch.mfgDate),
      expiryDate: toMmYy(batch.expiryDate),
      purchaseDate: toInputDate(batch.purchaseDate) || prev.purchaseDate || getTodayDateStringIST(),
      purchasePrice: purchasePrice > 0 ? purchasePrice.toFixed(2) : '',
      mrp: mrp > 0 ? String(mrp) : '',
      gstRate: selectedMedicine?.gstRate != null ? String(selectedMedicine.gstRate) : prev.gstRate,
      standardDiscount: Number.isFinite(standardDiscount) ? standardDiscount.toFixed(2) : '20',
      discountPercentage:
        batch.discountPercentage != null && batch.discountPercentage > 0
          ? String(batch.discountPercentage)
          : '',
    }));
    setMfgError('');
    setExpiryError('');
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
    setMfgError('');
    setExpiryError('');
    setStockData({
      ...emptyStockForm(),
      gstRate: picked.gstRate != null ? String(picked.gstRate) : '',
    });
    try {
      const full = await getMedicineById(picked.id);
      if (full) {
        setSearchInput(getMedicinePickerLabel(full));
        if (full.gstRate != null) {
          setStockData((prev) => ({ ...prev, gstRate: String(full.gstRate) }));
        }
      }
    } catch {
      // ignore
    }
  };

  const itemGstRate = () => {
    const entered = parseOptionalGstRate(stockData.gstRate);
    if (entered !== undefined) return entered;
    return resolveGstRate(selectedMedicine?.gstRate);
  };

  const handleSave = async () => {
    if (!selectedMedicine) {
      setError('Please select a medicine');
      return;
    }
    const paidQty = parseNumber(stockData.quantity);
    const freeQty = parseNumber(stockData.freeQuantity);
    const invoiceBatch = stockData.batchNumber.trim();
    const receivedBatch = stockData.receivedBatchNumber.trim();
    const stockBatch = purchaseItemStockBatchNumber({
      batchNumber: invoiceBatch,
      receivedBatchNumber: receivedBatch,
    });
    if (!invoiceBatch || !stockData.expiryDate.trim() || !(paidQty > 0)) {
      setError('Please fill invoice batch, quantity greater than 0, and expiry (MM/YY).');
      return;
    }
    const priceNum = parseNumber(stockData.purchasePrice);
    if (!Number.isFinite(priceNum) || stockData.purchasePrice.trim() === '' || priceNum < 0) {
      setError('Please enter purchase price.');
      return;
    }
    const expiryParsed = parseMmYy(stockData.expiryDate);
    if (!expiryParsed.ok) {
      setExpiryError(expiryParsed.error);
      setError(`Expiry date: ${expiryParsed.error}`);
      return;
    }
    let mfgDate: Date | undefined;
    if (stockData.mfgDate.trim()) {
      const mfgParsed = parseMmYy(stockData.mfgDate);
      if (!mfgParsed.ok) {
        setMfgError(mfgParsed.error);
        setError(`Mfg date: ${mfgParsed.error}`);
        return;
      }
      mfgDate = mfgParsed.date;
    }
    const spRaw = parseNumber(stockData.schemePaidQty);
    const sfRaw = parseNumber(stockData.schemeFreeQty);
    const schemePaidQty = spRaw > 0 && sfRaw > 0 ? Math.floor(spRaw) : undefined;
    const schemeFreeQty = schemePaidQty != null ? Math.floor(sfRaw) : undefined;
    const gstRate = itemGstRate();
    const mrp = stockData.mrp.trim() ? parseNumber(stockData.mrp) : undefined;
    const enteredStandard = stockData.standardDiscount.trim();
    const standardDiscount = enteredStandard
      ? parseNumber(enteredStandard)
      : standardDiscountFromPrice(mrp ?? 0, priceNum, gstRate);
    const discountPercentage = parseNumber(stockData.discountPercentage);
    setMfgError('');
    setExpiryError('');

    try {
      await addBatch.mutateAsync({
        medicineId: selectedMedicine.id,
        batch: {
          batchNumber: stockBatch,
          quantity: Math.floor(paidQty + (freeQty > 0 ? freeQty : 0)),
          mfgDate,
          expiryDate: expiryParsed.date,
          purchaseDate: stockData.purchaseDate ? new Date(stockData.purchaseDate) : new Date(),
          purchasePrice: priceNum,
          mrp,
          ...(discountPercentage > 0 ? { discountPercentage } : {}),
          ...(Number.isFinite(standardDiscount) ? { standardDiscount } : {}),
          ...(schemePaidQty != null && schemeFreeQty != null ? { schemePaidQty, schemeFreeQty } : {}),
          ...(stockData.nonReturnable ? { nonReturnable: true } : {}),
          ...(stockData.nrxDrug ? { nrxDrug: true } : {}),
          ...(receivedBatch && batchKey(receivedBatch) !== batchKey(invoiceBatch)
            ? { invoiceBatchNumber: invoiceBatch }
            : {}),
        },
      });
      try {
        await updateMedicine.mutateAsync({
          medicineId: selectedMedicine.id,
          updates: { gstRate },
        });
      } catch {
        // Stock is already saved. GST on the medicine master can be retried.
      }

      setStockData({
        ...emptyStockForm(),
        gstRate: String(gstRate),
      });
      setSuccess(
        freeQty > 0
          ? `Added ${Math.floor(paidQty)} + ${Math.floor(freeQty)} free on ${stockBatch}. Existing batches have the quantity added, not replaced.`
          : `Added ${Math.floor(paidQty)} on ${stockBatch}. Existing batches have the quantity added, not replaced.`
      );

      await updateStock.mutateAsync({
        medicineId: selectedMedicine.id,
        updates: {
          expiryDate: expiryParsed.date,
          batchNumber: stockBatch,
          mrp: mrp ?? selectedMedicine.mrp,
        },
      });
      await refetchMedicine();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update stock';
      setError(msg);
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
        After a stock zero, open the medicine and save the physical quantity on the existing batch.
        That replaces the number. The same row can correct the batch number, expiry, and MRP. Add
        batch below is only for a new lot, or to add extra units on top of the current qty.
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
                  options={[...new Set(batches.flatMap((b) => [b.invoiceBatchNumber, b.batchNumber].filter(Boolean) as string[]))]}
                  inputValue={stockData.batchNumber}
                  onInputChange={(_e, value, reason) => handleBatchNumberChange(value, reason)}
                  onChange={(_e, value) => handleBatchNumberChange(String(value || ''), 'selectOption')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Invoice Batch Number"
                      required
                      helperText={
                        matchedBatch
                          ? `Existing batch ${matchedBatch.batchNumber} — other fields filled from inventory`
                          : 'Batch as printed on the vendor bill'
                      }
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Received Batch Number"
                  value={stockData.receivedBatchNumber}
                  onChange={(e) => setStockData({ ...stockData, receivedBatchNumber: e.target.value })}
                  onBlur={() => {
                    const match = findExistingBatch(
                      batches,
                      purchaseItemStockBatchNumber({
                        batchNumber: stockData.batchNumber,
                        receivedBatchNumber: stockData.receivedBatchNumber,
                      })
                    );
                    if (match) applyExistingBatch(match, { keepQuantity: true });
                  }}
                  helperText="Physical batch on packs if different from invoice (used for stock)"
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
                  label="Free quantity (this bill)"
                  type="number"
                  helperText="Extra strips/units free on this invoice (stock)"
                  value={stockData.freeQuantity}
                  onChange={(e) => setStockData({ ...stockData, freeQuantity: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                  <Typography variant="caption" color="text.secondary">
                    Retailer scheme (optional): e.g. 1 free on 10 strips → pay for = 10, free = 1. Shown in the retailer app for this batch.
                  </Typography>
                  {selectedMedicine ? (
                    <RetailerLastSchemeHint
                      lastScheme={lastPurchaseByMedicineId.get(selectedMedicine.id)}
                      contextLabel="Previous purchase (same item · any vendor)"
                      emptyHint="No prior purchase for this item"
                      subjectLabel="this item"
                    />
                  ) : null}
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Scheme — pay for (qty)"
                  type="number"
                  inputProps={{ min: 1 }}
                  value={stockData.schemePaidQty}
                  onChange={(e) => setStockData({ ...stockData, schemePaidQty: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Scheme — get free (qty)"
                  type="number"
                  inputProps={{ min: 1 }}
                  value={stockData.schemeFreeQty}
                  onChange={(e) => setStockData({ ...stockData, schemeFreeQty: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={stockData.nonReturnable}
                      onChange={(e) => setStockData({ ...stockData, nonReturnable: e.target.checked })}
                    />
                  }
                  label="Non-returnable (retailer cannot return this batch)"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={stockData.nrxDrug}
                      onChange={(e) => setStockData({ ...stockData, nrxDrug: e.target.checked })}
                    />
                  }
                  label="NRX drug (Schedule H / restricted)"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Mfg Date"
                  value={stockData.mfgDate}
                  onChange={(e) => {
                    setMfgError('');
                    setStockData({ ...stockData, mfgDate: formatMmYyInput(e.target.value) });
                  }}
                  onBlur={() => {
                    const value = stockData.mfgDate.trim();
                    if (!value) {
                      setMfgError('');
                      return;
                    }
                    const parsed = parseMmYy(value);
                    setMfgError(parsed.ok ? '' : parsed.error);
                  }}
                  placeholder="MM/YY"
                  error={!!mfgError}
                  helperText={mfgError || MM_YY_HELPER}
                  inputProps={{ maxLength: 5 }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Expiry Date"
                  required
                  value={stockData.expiryDate}
                  onChange={(e) => {
                    setExpiryError('');
                    setStockData({ ...stockData, expiryDate: formatMmYyInput(e.target.value) });
                  }}
                  onBlur={() => {
                    const value = stockData.expiryDate.trim();
                    if (!value) {
                      setExpiryError('');
                      return;
                    }
                    const parsed = parseMmYy(value);
                    setExpiryError(parsed.ok ? '' : parsed.error);
                  }}
                  placeholder="MM/YY"
                  error={!!expiryError}
                  helperText={expiryError || MM_YY_HELPER}
                  inputProps={{ maxLength: 5 }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="MRP"
                  type="number"
                  value={stockData.mrp}
                  onChange={(e) => {
                    const mrpValue = e.target.value;
                    const mrp = parseNumber(mrpValue);
                    const gstRate = itemGstRate();
                    const standardDiscount = stockData.standardDiscount.trim()
                      ? parseNumber(stockData.standardDiscount)
                      : 20;
                    const purchasePrice = purchasePriceFromMrp(mrp, gstRate, standardDiscount);
                    setStockData({
                      ...stockData,
                      mrp: mrpValue,
                      ...(purchasePrice > 0
                        ? { purchasePrice: purchasePrice.toFixed(2) }
                        : {}),
                    });
                  }}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                  helperText="Purchase Price is calculated from MRP, Standard Discount and GST"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="GST Rate (%)"
                  type="number"
                  value={stockData.gstRate}
                  onChange={(e) => {
                    const gstValue = e.target.value;
                    const gstRate = parseOptionalGstRate(gstValue) ?? 0;
                    const mrp = parseNumber(stockData.mrp);
                    const standardDiscount = stockData.standardDiscount.trim()
                      ? parseNumber(stockData.standardDiscount)
                      : 20;
                    const purchasePrice = purchasePriceFromMrp(mrp, gstRate, standardDiscount);
                    setStockData({
                      ...stockData,
                      gstRate: gstValue,
                      ...(mrp > 0 ? { purchasePrice: purchasePrice.toFixed(2) } : {}),
                    });
                  }}
                  inputProps={{ min: 0, max: 100, step: 0.01 }}
                  helperText="Saved on this line and on the medicine in inventory"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Standard Discount (%)"
                  type="number"
                  value={stockData.standardDiscount}
                  onChange={(e) => {
                    const standardDiscountValue = e.target.value;
                    const mrp = parseNumber(stockData.mrp);
                    const gstRate = itemGstRate();
                    const purchasePrice = purchasePriceFromMrp(mrp, gstRate, parseNumber(standardDiscountValue));
                    setStockData({
                      ...stockData,
                      standardDiscount: standardDiscountValue,
                      ...(mrp > 0 ? { purchasePrice: purchasePrice.toFixed(2) } : {}),
                    });
                  }}
                  helperText="Change this to auto-update Purchase Price from MRP"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Purchase Price"
                  type="number"
                  required
                  value={stockData.purchasePrice}
                  onChange={(e) => {
                    const purchasePriceValue = e.target.value;
                    const mrp = parseNumber(stockData.mrp);
                    const gstRate = itemGstRate();
                    const standardDiscount = standardDiscountFromPrice(mrp, parseNumber(purchasePriceValue), gstRate);
                    setStockData({
                      ...stockData,
                      purchasePrice: purchasePriceValue,
                      ...(mrp > 0 ? { standardDiscount: standardDiscount.toFixed(2) } : {}),
                    });
                  }}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Discount Percentage (%)"
                  type="number"
                  value={stockData.discountPercentage}
                  onChange={(e) => setStockData({ ...stockData, discountPercentage: e.target.value })}
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
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Total Amount"
                  value={(() => {
                    const qty = parseNumber(stockData.quantity);
                    const price = parseNumber(stockData.purchasePrice);
                    const gstRate = itemGstRate();
                    const discountPercentage = parseNumber(stockData.discountPercentage);
                    const baseAmount = price * qty;
                    const discountAmount = (baseAmount * discountPercentage) / 100;
                    const amountAfterDiscount = baseAmount - discountAmount;
                    const gstAmount = (amountAfterDiscount * gstRate) / 100;
                    return (amountAfterDiscount + gstAmount).toFixed(2);
                  })()}
                  InputProps={{
                    readOnly: true,
                    startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography>,
                  }}
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
                  Save replaces the quantity and can change the batch number, expiry (MM/YY), and MRP.
                  It does not add quantity. Past orders keep the old batch number.
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
                        <TableCell align="right">Save</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedBatches.map((b) => {
                        const rowKey = b.id || b.batchNumber;
                        const draft = batchDrafts[rowKey];
                        return (
                        <TableRow
                          key={rowKey}
                          hover
                          selected={batchKey(stockData.batchNumber) === batchKey(b.batchNumber)}
                          onClick={() => applyExistingBatch(b, { keepQuantity: true })}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <TextField
                              size="small"
                              value={draft?.batchNumber ?? b.batchNumber}
                              onChange={(e) => patchBatchDraft(rowKey, { batchNumber: e.target.value })}
                              inputProps={{ style: { width: 120 } }}
                            />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <TextField
                              size="small"
                              type="number"
                              value={draft?.quantity ?? String(b.quantity ?? 0)}
                              onChange={(e) => patchBatchDraft(rowKey, { quantity: e.target.value })}
                              inputProps={{ min: 0, style: { width: 72 } }}
                            />
                          </TableCell>
                          <TableCell>{toMmYy(b.mfgDate) || '—'}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <TextField
                              size="small"
                              placeholder="MM/YY"
                              value={draft?.expiry ?? toMmYy(b.expiryDate)}
                              onChange={(e) =>
                                patchBatchDraft(rowKey, { expiry: formatMmYyInput(e.target.value) })
                              }
                              inputProps={{ maxLength: 5, style: { width: 72 } }}
                            />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <TextField
                              size="small"
                              type="number"
                              value={draft?.mrp ?? (b.mrp != null ? String(b.mrp) : '')}
                              onChange={(e) => patchBatchDraft(rowKey, { mrp: e.target.value })}
                              inputProps={{ min: 0, style: { width: 80 } }}
                            />
                          </TableCell>
                          <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={savingBatch === rowKey || updateBatch.isPending}
                              onClick={() => void handleSaveExistingBatch(b)}
                            >
                              {savingBatch === rowKey ? 'Saving…' : 'Save'}
                            </Button>
                          </TableCell>
                        </TableRow>
                        );
                      })}
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

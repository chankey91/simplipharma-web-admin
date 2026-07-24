import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  Chip,
  Autocomplete,
  CircularProgress,
  Alert,
} from '@mui/material';
import { ArrowBack, Delete, PictureAsPdf, Add } from '@mui/icons-material';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { auth } from '../services/firebase';
import { useVendors } from '../hooks/useVendors';
import { useCreatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { generatePurchaseInvoiceNumber } from '../utils/invoiceNumber';
import {
  extractTextFromPdfFile,
  findGstinsInText,
  matchVendorByGst,
  matchVendorByName,
  extractPotentialProductLines,
  parseProductLineFromRawLine,
  resolveMedicineForImportLine,
  type ParsedPdfProductLine,
} from '../utils/purchaseInvoicePdfImport';
import {
  resolveMedicineAfterPickerSelection,
} from '../services/medicineSearch';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { getTodayDateStringIST } from '../utils/dateTime';
import { Medicine, PurchaseInvoiceItem } from '../types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useAppDialog } from '../context/AppDialogProvider';

type ImportRow = {
  id: string;
  raw: string;
  parsed: ParsedPdfProductLine;
  medicine?: Medicine;
  matchSource: 'batch' | 'name' | 'manual' | 'none';
  batchNumber: string;
  quantity: number;
  mrp: string;
  purchasePrice: string;
  expiryMmYyyy: string;
  freeQuantity: string;
  schemePaidQty: string;
  schemeFreeQty: string;
  discountPercentage: string;
  standardDiscount: string;
};

const newRowId = () => `r-${Math.random().toString(36).slice(2, 11)}`;

/** Per-row Typesense medicine picker (no full catalog download). */
const ImportMedicinePicker: React.FC<{
  value: Medicine | null | undefined;
  onChange: (m: Medicine | null) => void;
}> = ({ value, onChange }) => {
  const [input, setInput] = useState(value ? getMedicinePickerLabel(value) : '');
  const skipLabel = value ? getMedicinePickerLabel(value) : undefined;
  const { medicines: hits, loading } = useMedicineSearch(input, {
    hydrate: false,
    limit: 40,
    strict: true,
    skipQuery: skipLabel,
  });

  useEffect(() => {
    if (value) setInput(getMedicinePickerLabel(value));
  }, [value]);

  const options =
    value && !hits.some((h) => h.id === value.id) ? [value, ...hits] : hits.length ? hits : value ? [value] : [];

  return (
    <Autocomplete
      size="small"
      options={options}
      loading={loading}
      value={value || null}
      inputValue={input}
      getOptionLabel={getMedicinePickerLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts) => opts}
      onInputChange={(_, v, reason) => {
        if (reason === 'input') setInput(v);
        else if (reason === 'clear') {
          setInput('');
          onChange(null);
        } else setInput(v);
      }}
      onChange={(_, v) => {
        if (!v) {
          onChange(null);
          setInput('');
          return;
        }
        void resolveMedicineAfterPickerSelection(v, undefined).then((merged) => {
          onChange(merged);
          setInput(getMedicinePickerLabel(merged));
        });
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search medicine (Typesense)…"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};

export const ImportPurchaseInvoicePdfPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: vendors } = useVendors();
  const createInvoiceMutation = useCreatePurchaseInvoice();
  const { alert, confirm } = useAppDialog();

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayDateStringIST());
  const [vendorId, setVendorId] = useState('');
  const [detectedGstins, setDetectedGstins] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rawPreview, setRawPreview] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const n = await generatePurchaseInvoiceNumber();
        setInvoiceNumber(n);
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, []);

  const selectedVendor = vendors?.find((v) => v.id === vendorId);

  const processPdfFile = async (file: File) => {
    setPdfError(null);
    setProcessing(true);
    try {
      const text = await extractTextFromPdfFile(file);
      setRawPreview(text.slice(0, 8000));

      const nameVendor = matchVendorByName(vendors, text);
      if (nameVendor) {
        setVendorId(nameVendor.id);
      }
      const gstins = findGstinsInText(text);
      setDetectedGstins(gstins);
      const matchedVendor = matchVendorByGst(vendors, gstins);
      if (matchedVendor && !nameVendor) {
        setVendorId(matchedVendor.id);
      }

      const rawLines = extractPotentialProductLines(text);
      const built: ImportRow[] = [];

      for (const line of rawLines) {
        const parsed = parseProductLineFromRawLine(line);
        if (!parsed) continue;
        const { medicine, source } = await resolveMedicineForImportLine(parsed);
        built.push({
          id: newRowId(),
          raw: line,
          parsed,
          medicine,
          matchSource: medicine ? source : 'none',
          batchNumber: parsed.batchNumber || '',
          quantity: parsed.quantity || 1,
          mrp: parsed.mrp !== undefined ? String(parsed.mrp) : '',
          purchasePrice: parsed.purchasePrice !== undefined ? String(parsed.purchasePrice) : '',
          expiryMmYyyy: parsed.expiryMmYyyy || '',
          freeQuantity: parsed.freeQuantity !== undefined ? String(parsed.freeQuantity) : '',
          schemePaidQty: '',
          schemeFreeQty: '',
          discountPercentage:
            parsed.discountPercentage !== undefined ? String(parsed.discountPercentage) : '',
          standardDiscount: '20',
        });
      }

      setRows(built);
      if (built.length === 0) {
        setPdfError(
          'No product lines could be parsed from this PDF. Text-based PDFs work best. You can still add rows manually.'
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPdfError(msg || 'Failed to read PDF');
      setRows([]);
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateRowField = (id: string, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addEmptyRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: newRowId(),
        raw: '',
        parsed: { raw: '', productName: '', batchNumber: '', quantity: 0 },
        matchSource: 'none',
        batchNumber: '',
        quantity: 1,
        mrp: '',
        purchasePrice: '',
        expiryMmYyyy: '',
        freeQuantity: '',
        schemePaidQty: '',
        schemeFreeQty: '',
        discountPercentage: '',
        standardDiscount: '20',
      },
    ]);
  };

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const handleSave = async () => {
    if (!vendorId || !invoiceNumber.trim()) {
      await alert('Invoice number and vendor are required', { severity: 'warning' });
      return;
    }
    const linked = rows.filter((r) => r.medicine);
    if (linked.length === 0) {
      await alert('Link at least one medicine row before saving', { severity: 'warning' });
      return;
    }
    const ok = await confirm(
      `Create purchase invoice with ${linked.length} linked line(s)? Unlinked rows will be skipped.`,
      { title: 'Create invoice' }
    );
    if (!ok) return;

    const user = auth.currentUser;
    if (!user) {
      await alert('Please sign in', { severity: 'warning' });
      return;
    }

    const items: PurchaseInvoiceItem[] = [];
    for (const r of linked) {
      const med = r.medicine!;
      const qty = Math.max(1, r.quantity || 1);
      const mrp = parseFloat(r.mrp) || 0;
      const purchasePrice = parseFloat(r.purchasePrice) || 0;
      const gstRate = med.gstRate ?? 5;
      const discountPercentage = parseFloat(r.discountPercentage) || 0;
      const freeQuantity = parseFloat(r.freeQuantity) || 0;
      const schemePaidQty = parseFloat(r.schemePaidQty) || undefined;
      const schemeFreeQty = parseFloat(r.schemeFreeQty) || undefined;
      const standardDiscount = parseFloat(r.standardDiscount) || 20;
      const base = purchasePrice * qty;
      const afterDisc = base - (base * discountPercentage) / 100;
      const lineTax = (afterDisc * gstRate) / 100;
      items.push({
        medicineId: med.id,
        medicineName: med.name,
        batchNumber: r.batchNumber || '',
        quantity: qty,
        freeQuantity: freeQuantity || undefined,
        schemePaidQty,
        schemeFreeQty,
        unitPrice: purchasePrice,
        purchasePrice,
        mrp: mrp || undefined,
        gstRate,
        discountPercentage: discountPercentage || undefined,
        standardDiscount,
        totalAmount: afterDisc + lineTax,
        expiryDate: r.expiryMmYyyy || '',
      });
    }

    const subTotal = items.reduce((s, i) => s + (i.purchasePrice || 0) * (i.quantity || 0), 0);
    const taxAmount = items.reduce((s, i) => {
      const base = (i.purchasePrice || 0) * (i.quantity || 0);
      const afterDisc = base - (base * (i.discountPercentage || 0)) / 100;
      return s + (afterDisc * (i.gstRate || 0)) / 100;
    }, 0);

    try {
      await createInvoiceMutation.mutateAsync({
        invoiceData: {
          invoiceNumber: invoiceNumber.trim(),
          vendorId,
          vendorName: selectedVendor?.vendorName || '',
          invoiceDate: new Date(invoiceDate),
          items,
          subTotal,
          taxAmount,
          totalAmount: subTotal + taxAmount,
          paymentStatus: 'Unpaid',
          createdBy: user.uid,
          createdAt: new Date(),
          notes: `Imported from PDF (${format(new Date(), 'yyyy-MM-dd')})`,
        } as any,
        updateStock: true,
      });
      await alert('Purchase invoice created', { severity: 'success' });
      navigate('/purchases');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert(msg || 'Failed to create invoice', { severity: 'error' });
    }
  };

  return (
    <Box>
      <Breadcrumbs
        items={[{ label: 'Purchase Invoices', path: '/purchases' }, { label: 'Import from PDF' }]}
      />
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <IconButton onClick={() => navigate('/purchases')}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h5">Import purchase invoice (PDF)</Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Uses text inside the PDF (not OCR). Vendor is auto-picked by vendor name (fallback GSTIN), and each item
        appears with a Typesense medicine search so you can confirm or change selections before saving.
      </Alert>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <Button
              variant="contained"
              component="label"
              startIcon={processing ? <CircularProgress size={18} color="inherit" /> : <PictureAsPdf />}
              disabled={processing}
            >
              {processing ? 'Reading PDF…' : 'Upload PDF'}
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void processPdfFile(f);
                }}
              />
            </Button>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Invoice number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Invoice date"
              InputLabelProps={{ shrink: true }}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              options={vendors || []}
              getOptionLabel={(v) => v.vendorName || v.id}
              value={selectedVendor || null}
              onChange={(_, v) => setVendorId(v?.id || '')}
              renderInput={(params) => <TextField {...params} label="Vendor" size="small" />}
            />
          </Grid>
          {detectedGstins.length > 0 && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                GSTINs found: {detectedGstins.join(', ')}
              </Typography>
            </Grid>
          )}
        </Grid>
        {pdfError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {pdfError}
          </Alert>
        )}
      </Paper>

      <Box display="flex" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle1">Lines ({rows.length})</Typography>
        <Button size="small" startIcon={<Add />} onClick={addEmptyRow}>
          Add row
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Match</TableCell>
              <TableCell>PDF text</TableCell>
              <TableCell>Medicine</TableCell>
              <TableCell>Batch</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Expiry</TableCell>
              <TableCell align="right">MRP</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.medicine ? (
                    <Chip
                      size="small"
                      label={row.matchSource}
                      color={row.matchSource === 'none' ? 'default' : 'success'}
                    />
                  ) : (
                    <Chip size="small" label="needs link" color="warning" />
                  )}
                </TableCell>
                <TableCell sx={{ maxWidth: 220 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {row.raw.slice(0, 120)}
                    {row.raw.length > 120 ? '…' : ''}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 280 }}>
                  <ImportMedicinePicker
                    value={row.medicine}
                    onChange={(v) =>
                      updateRowField(row.id, {
                        medicine: v || undefined,
                        matchSource: v
                          ? row.matchSource === 'batch' || row.matchSource === 'name'
                            ? row.matchSource
                            : 'manual'
                          : 'none',
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={row.batchNumber}
                    onChange={(e) => updateRowField(row.id, { batchNumber: e.target.value })}
                  />
                </TableCell>
                <TableCell align="right">
                  <TextField
                    size="small"
                    type="number"
                    sx={{ width: 72 }}
                    value={row.quantity}
                    onChange={(e) =>
                      updateRowField(row.id, {
                        quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="MM/YYYY"
                    value={row.expiryMmYyyy}
                    onChange={(e) => updateRowField(row.id, { expiryMmYyyy: e.target.value })}
                    sx={{ width: 100 }}
                  />
                </TableCell>
                <TableCell align="right">
                  <TextField
                    size="small"
                    type="number"
                    sx={{ width: 88 }}
                    value={row.mrp}
                    onChange={(e) => updateRowField(row.id, { mrp: e.target.value })}
                  />
                </TableCell>
                <TableCell align="right">
                  <TextField
                    size="small"
                    type="number"
                    sx={{ width: 88 }}
                    value={row.purchasePrice}
                    onChange={(e) => updateRowField(row.id, { purchasePrice: e.target.value })}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => removeRow(row.id)}>
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {rawPreview && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Text preview (truncated)
          </Typography>
          <Typography
            component="pre"
            variant="caption"
            sx={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}
          >
            {rawPreview}
          </Typography>
        </Paper>
      )}

      <Box mt={2} display="flex" gap={2}>
        <Button variant="contained" onClick={() => void handleSave()} disabled={createInvoiceMutation.isPending}>
          Create invoice
        </Button>
        <Button onClick={() => navigate('/purchases')}>Cancel</Button>
      </Box>
    </Box>
  );
};

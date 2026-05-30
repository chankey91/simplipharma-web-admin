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
import { useMedicines } from '../hooks/useInventory';
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
import { resolveMedicineAfterPickerSelection } from '../services/medicineSearch';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { getTodayDateStringIST } from '../utils/dateTime';
import { Medicine, PurchaseInvoiceItem } from '../types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Loading } from '../components/Loading';
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

export const ImportPurchaseInvoicePdfPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: vendors } = useVendors();
  const { data: medicines, isLoading: medLoading } = useMedicines();
  const createInvoiceMutation = useCreatePurchaseInvoice();
  const { alert, confirm, prompt } = useAppDialog();

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
      const catalog = medicines || [];
      const built: ImportRow[] = [];

      for (const line of rawLines) {
        const parsed = parseProductLineFromRawLine(line);
        if (!parsed) continue;
        const { medicine, source } = await resolveMedicineForImportLine(parsed, catalog);
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
    } catch (e: any) {
      console.error(e);
      setPdfError(e?.message || 'Failed to read PDF. Try a text-based PDF (not a scan).');
      setRows([]);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void processPdfFile(f);
    e.target.value = '';
  };

  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id));

  const addManualRow = () => {
    const parsed: ParsedPdfProductLine = {
      raw: '',
      productName: '',
      batchNumber: '',
      quantity: 1,
    };
    setRows((r) => [
      ...r,
      {
        id: newRowId(),
        raw: '(manual)',
        parsed,
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

  const updateRowField = (id: string, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const parseNum = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const calculatePurchasePriceFromMrp = (mrp: number, gstRate: number, standardDiscount: number) => {
    if (mrp <= 0) return 0;
    return (mrp * (1 - standardDiscount / 100)) / (1 + gstRate / 100);
  };

  const buildPurchaseItems = async (): Promise<PurchaseInvoiceItem[]> => {
    const catalog = medicines || [];
    const out: PurchaseInvoiceItem[] = [];

    for (const row of rows) {
      if (!row.medicine) continue;
      const med = (await resolveMedicineAfterPickerSelection(row.medicine, catalog)) as Medicine;
      const gstRate = med.gstRate || 5;
      const batchNumber = row.batchNumber.trim();
      const qty = Math.max(1, Math.round(row.quantity));
      const expiryParts = row.expiryMmYyyy.trim().split('/');
      if (expiryParts.length !== 2) throw new Error(`Expiry MM/YYYY required for ${med.name}`);
      const em = parseInt(expiryParts[0], 10);
      const ey = parseInt(expiryParts[1], 10);
      if (isNaN(em) || isNaN(ey) || em < 1 || em > 12) throw new Error(`Invalid expiry for ${med.name}`);

      let purchasePrice = parseNum(row.purchasePrice);
      const mrp = row.mrp ? parseNum(row.mrp) : 0;
      const stdDisc = row.standardDiscount ? parseNum(row.standardDiscount) : 20;
      if (purchasePrice <= 0 && mrp > 0) {
        purchasePrice = calculatePurchasePriceFromMrp(mrp, gstRate, stdDisc);
      }
      if (purchasePrice <= 0) throw new Error(`Purchase price or MRP required for ${med.name}`);

      const freeQty = row.freeQuantity ? parseNum(row.freeQuantity) : 0;
      const sp = row.schemePaidQty ? Math.floor(parseNum(row.schemePaidQty)) : NaN;
      const sf = row.schemeFreeQty ? Math.floor(parseNum(row.schemeFreeQty)) : NaN;
      const schemePaidQty = !isNaN(sp) && !isNaN(sf) && sp > 0 && sf > 0 ? sp : undefined;
      const schemeFreeQty = schemePaidQty != null ? sf : undefined;
      const discountPct = row.discountPercentage ? parseNum(row.discountPercentage) : 0;

      const expiryDate = new Date(ey, em - 1, 1);
      const std =
        row.standardDiscount !== '' && row.standardDiscount !== undefined
          ? parseNum(row.standardDiscount)
          : mrp > 0
            ? (1 - (purchasePrice * (1 + gstRate / 100)) / mrp) * 100
            : 20;

      const baseAmount = purchasePrice * qty;
      const discountAmount = (baseAmount * discountPct) / 100;
      const amountAfterDiscount = baseAmount - discountAmount;
      const gstAmount = (amountAfterDiscount * gstRate) / 100;
      const totalAmount = amountAfterDiscount + gstAmount;

      const qrData = JSON.stringify({
        medicineId: med.id,
        medicineName: med.name,
        batchNumber,
        expiryDate: format(expiryDate, 'MM/yyyy'),
        quantity: qty,
        freeQuantity: freeQty > 0 ? freeQty : undefined,
        schemePaidQty,
        schemeFreeQty,
        purchasePrice,
        mrp: mrp > 0 ? mrp : undefined,
      });
      const qrCode = await QRCode.toDataURL(qrData, { width: 200, margin: 1 }).catch(() => '');

      out.push({
        medicineId: med.id,
        medicineName: med.name,
        batchNumber,
        expiryDate,
        quantity: qty,
        freeQuantity: freeQty > 0 ? freeQty : undefined,
        ...(schemePaidQty != null && schemeFreeQty != null ? { schemePaidQty, schemeFreeQty } : {}),
        unitPrice: purchasePrice,
        purchasePrice,
        mrp: mrp > 0 ? mrp : undefined,
        gstRate,
        standardDiscount: Number.isFinite(std) ? std : undefined,
        discountPercentage: discountPct > 0 ? discountPct : undefined,
        totalAmount,
        qrCode: qrCode || undefined,
      });
    }
    return out;
  };

  const calculateTotals = (invoiceItems: PurchaseInvoiceItem[]) => {
    const subTotal = invoiceItems.reduce((s, it) => s + (it.purchasePrice || 0) * (it.quantity || 0), 0);
    const totalDiscount = invoiceItems.reduce((s, it) => {
      const base = (it.purchasePrice || 0) * (it.quantity || 0);
      return s + (base * (it.discountPercentage || 0)) / 100;
    }, 0);
    const amountAfterDiscount = subTotal - totalDiscount;
    const avgGst =
      invoiceItems.length > 0
        ? invoiceItems.reduce((sum, it) => sum + (it.gstRate || 5), 0) / invoiceItems.length
        : 5;
    const totalTax = (amountAfterDiscount * avgGst) / 100;
    const calculatedTotal = subTotal - totalDiscount + totalTax;
    const grandTotal = Math.round(calculatedTotal);
    return { subTotal, totalDiscount, totalTax, grandTotal };
  };

  const handleSaveInvoice = async () => {
    const user = auth.currentUser;
    if (!user) {
      await alert('Please login', { severity: 'warning' });
      return;
    }
    if (!invoiceNumber.trim() || !vendorId || rows.length === 0) {
      await alert('Invoice number, vendor, and at least one row are required.', { severity: 'warning' });
      return;
    }
    const unresolved = rows.filter((r) => !r.medicine);
    if (unresolved.length) {
      await alert(`Link medicine for ${unresolved.length} row(s) before saving.`, { severity: 'warning' });
      return;
    }
    try {
      const items = await buildPurchaseItems();
      if (items.length === 0) {
        await alert('No valid rows to save.', { severity: 'warning' });
        return;
      }
      const { subTotal, totalDiscount, totalTax, grandTotal } = calculateTotals(items);
      await createInvoiceMutation.mutateAsync({
        invoiceData: {
          invoiceNumber: invoiceNumber.trim(),
          vendorId,
          vendorName: selectedVendor?.vendorName || '',
          invoiceDate: new Date(invoiceDate),
          items,
          subTotal,
          taxAmount: totalTax,
          discount: totalDiscount > 0 ? totalDiscount : undefined,
          totalAmount: grandTotal,
          paymentStatus: 'Unpaid',
          createdBy: user.uid,
          createdAt: new Date(),
        },
        updateStock: true,
      });
      navigate('/purchases');
    } catch (e: any) {
      await alert(e?.message || 'Failed to create invoice', { severity: 'error' });
    }
  };

  if (medLoading) return <Loading message="Loading catalog..." />;

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchase Invoices', path: '/purchases' },
          { label: 'Import from PDF' },
        ]}
      />
      <Box display="flex" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <IconButton onClick={() => navigate('/purchases')}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">Import purchase invoice (PDF)</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={handleFileChange}
        />
        <Button
          variant="outlined"
          startIcon={<PictureAsPdf />}
          disabled={processing}
          onClick={() => fileInputRef.current?.click()}
        >
          {processing ? 'Reading PDF…' : 'Choose PDF'}
        </Button>
        <Button variant="contained" onClick={handleSaveInvoice} disabled={createInvoiceMutation.isPending}>
          {createInvoiceMutation.isPending ? <CircularProgress size={22} /> : 'Create invoice'}
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Uses text inside the PDF (not OCR). Vendor is auto-picked by vendor name (fallback GSTIN), and each item
        appears with a medicine dropdown so you can confirm or change selections before saving.
      </Alert>

      {pdfError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {pdfError}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Invoice header
            </Typography>
            <TextField
              fullWidth
              label="Invoice number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="date"
              label="Invoice date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
            />
            <Autocomplete
              options={vendors?.filter((v) => v.isActive !== false) || []}
              getOptionLabel={(v) => v.vendorName || ''}
              value={selectedVendor || null}
              onChange={(_, v) => setVendorId(v?.id || '')}
              renderInput={(params) => <TextField {...params} label="Vendor" required />}
            />
            {detectedGstins.length > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                GSTIN in PDF: {detectedGstins.join(', ')}
                {selectedVendor ? ` — matched: ${selectedVendor.vendorName}` : ' — pick vendor manually if needed'}
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Extracted text preview (truncated)
            </Typography>
            <Typography
              variant="caption"
              component="pre"
              sx={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', display: 'block' }}
            >
              {rawPreview || '—'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Box display="flex" justifyContent="space-between" alignItems="center" mt={2} mb={1}>
        <Typography variant="h6">Imported lines ({rows.length})</Typography>
        <Button startIcon={<Add />} onClick={addManualRow}>
          Add row manually
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Match</TableCell>
              <TableCell>PDF / product</TableCell>
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
                  <Autocomplete
                    size="small"
                    options={medicines || []}
                    value={row.medicine || null}
                    getOptionLabel={getMedicinePickerLabel}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    onChange={(_, v) =>
                      updateRowField(row.id, {
                        medicine: v || undefined,
                        matchSource: v ? (row.matchSource === 'batch' || row.matchSource === 'name' ? row.matchSource : 'manual') : 'none',
                      })
                    }
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Search medicine..." />
                    )}
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
                      updateRowField(row.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
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
    </Box>
  );
};

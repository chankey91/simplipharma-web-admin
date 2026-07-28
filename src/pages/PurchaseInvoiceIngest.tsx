import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack, CloudUpload, PlayArrow, Save } from '@mui/icons-material';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useVendors } from '../hooks/useVendors';
import { useCreatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { generatePurchaseInvoiceNumber } from '../utils/invoiceNumber';
import { getTodayDateStringIST } from '../utils/dateTime';
import { auth } from '../services/firebase';
import {
  createAndUploadInvoiceDraft,
  getDraftFileDownloadUrl,
  isAllowedInvoiceUpload,
  markInvoiceDraftCommitted,
  processInvoiceDraft,
  subscribeInvoiceDraft,
  updateInvoiceDraftReview,
} from '../services/purchaseInvoiceIngest';
import type { PurchaseInvoiceDraft, PurchaseInvoiceDraftResolvedLine, PurchaseInvoiceItem } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import {
  useGroupedMedicineResolveOptions,
  useMedicineResolutionContext,
} from '../hooks/useMedicineResolutionContext';
import {
  renderMedicineResolveGroup,
  renderMedicineResolveOption,
} from '../components/MedicineResolveAutocomplete';
import Autocomplete from '@mui/material/Autocomplete';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { resolveMedicineAfterPickerSelection } from '../services/medicineSearch';
import QRCode from 'qrcode';

function parseExpiryToDate(mmYyyy?: string): Date | undefined {
  if (!mmYyyy) return undefined;
  const m = mmYyyy.trim().match(/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/);
  if (!m) return undefined;
  const month = parseInt(m[1], 10);
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  return new Date(year, month - 1, 1);
}

const LineMedicinePicker: React.FC<{
  line: PurchaseInvoiceDraftResolvedLine;
  onPick: (medicineId: string, medicineName: string, productId?: string) => void;
}> = ({ line, onPick }) => {
  const initial = line.selectedMedicineName || line.medicineName || line.productName || '';
  const [input, setInput] = useState(initial);
  const { medicines: hits, loading } = useMedicineSearch(input, {
    hydrate: false,
    limit: 30,
  });
  const { pendingMedicines, pendingDemands } = useMedicineResolutionContext();
  const options = useGroupedMedicineResolveOptions({
    query: input,
    inventoryHits: hits,
    pendingMedicines,
    pendingDemands,
  });

  return (
    <Autocomplete
      size="small"
      fullWidth
      options={options}
      loading={loading}
      groupBy={(o) => o.groupLabel}
      getOptionLabel={(o) => o.label}
      getOptionDisabled={(o) => !o.selectable}
      filterOptions={(x) => x}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      renderGroup={renderMedicineResolveGroup}
      renderOption={renderMedicineResolveOption}
      onChange={(_, v) => {
        if (!v?.selectable || !v.medicine) return;
        void resolveMedicineAfterPickerSelection(v.medicine, undefined).then((m) => {
          onPick(m.id, m.name, m.productId);
          setInput(getMedicinePickerLabel(m));
        });
      }}
      renderInput={(params) => (
        <TextField {...params} placeholder="Resolve medicine…" />
      )}
    />
  );
};

export const PurchaseInvoiceIngestPage: React.FC = () => {
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams<{ draftId?: string }>();
  const { data: vendors } = useVendors();
  const createInvoice = useCreatePurchaseInvoice();
  const { alert } = useAppDialog();

  const [draftId, setDraftId] = useState<string | null>(routeDraftId || null);
  const [draft, setDraft] = useState<PurchaseInvoiceDraft | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayDateStringIST());

  useEffect(() => {
    void generatePurchaseInvoiceNumber()
      .then(setInvoiceNumber)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!draftId) return;
    return subscribeInvoiceDraft(draftId, setDraft);
  }, [draftId]);

  useEffect(() => {
    if (!draft?.sourceFile?.storagePath) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void getDraftFileDownloadUrl(draft.sourceFile.storagePath)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.sourceFile?.storagePath]);

  useEffect(() => {
    if (draft?.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
    if (draft?.invoiceDate) setInvoiceDate(draft.invoiceDate);
  }, [draft?.invoiceNumber, draft?.invoiceDate]);

  const lines = draft?.resolvedLines || [];

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (!isAllowedInvoiceUpload(file)) {
      setError('Please upload a PDF or image (JPG/PNG/WebP).');
      return;
    }
    setBusy(true);
    try {
      const id = await createAndUploadInvoiceDraft(file);
      setDraftId(id);
      navigate(`/purchases/ingest/${id}`, { replace: true });
      await processInvoiceDraft(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reprocess = async () => {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    try {
      await processInvoiceDraft(draftId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchLine = async (lineId: string, patch: Partial<PurchaseInvoiceDraftResolvedLine>) => {
    if (!draftId || !draft?.resolvedLines) return;
    const resolvedLines = draft.resolvedLines.map((l) =>
      l.lineId === lineId ? { ...l, ...patch } : l
    );
    await updateInvoiceDraftReview(draftId, { resolvedLines, status: 'needs_review' });
  };

  const saveHeader = async () => {
    if (!draftId) return;
    const vendor = vendors?.find((v) => v.id === draft?.vendorId);
    await updateInvoiceDraftReview(draftId, {
      vendorId: draft?.vendorId,
      vendorName: vendor?.vendorName || draft?.vendorName,
      invoiceNumber,
      invoiceDate,
    });
  };

  const commit = async () => {
    if (!draft) return;
    const vendorId = draft.vendorId;
    if (!vendorId) {
      await alert('Select a vendor before committing.', { severity: 'warning' });
      return;
    }
    const vendor = vendors?.find((v) => v.id === vendorId);
    const usable = (draft.resolvedLines || []).filter(
      (l) => (l.selectedMedicineId || l.medicineId) && (l.batchNumber || '').trim()
    );
    if (!usable.length) {
      await alert('Need at least one line with a resolved medicine and batch number.', {
        severity: 'warning',
      });
      return;
    }

    setBusy(true);
    try {
      await saveHeader();
      const items: PurchaseInvoiceItem[] = [];
      for (const line of usable) {
        const medicineId = line.selectedMedicineId || line.medicineId!;
        const medicineName = line.selectedMedicineName || line.medicineName || line.productName;
        const qty = Math.max(1, Math.floor(line.quantity || 1));
        const purchasePrice = Number(line.purchasePrice || 0);
        const mrp = line.mrp != null ? Number(line.mrp) : purchasePrice;
        const unitPrice = mrp;
        const qrCode = await QRCode.toDataURL(
          JSON.stringify({
            medicineId,
            batchNumber: line.batchNumber,
            invoiceNumber,
          })
        );
        items.push({
          medicineId,
          medicineName,
          batchNumber: String(line.batchNumber || '').trim(),
          quantity: qty,
          freeQuantity: line.freeQuantity,
          unitPrice,
          purchasePrice,
          mrp,
          totalAmount: purchasePrice * qty,
          expiryDate: parseExpiryToDate(line.expiryMmYyyy),
          discountPercentage: line.discountPercentage,
          gstRate: line.gstRate ?? 5,
          qrCode,
        });
      }

      const subTotal = items.reduce((s, i) => s + i.totalAmount, 0);
      const taxPercentage = 0;
      const taxAmount = 0;
      const invoiceId = await createInvoice.mutateAsync({
        invoiceData: {
          invoiceNumber,
          vendorId,
          vendorName: vendor?.vendorName || draft.vendorName || '',
          invoiceDate: new Date(invoiceDate),
          items,
          subTotal,
          taxAmount,
          taxPercentage,
          totalAmount: subTotal + taxAmount,
          paymentStatus: 'Unpaid',
          createdBy: auth.currentUser?.uid || '',
          createdAt: new Date(),
          notes: `Ingested from ${draft.sourceFile?.contentType?.startsWith('image/') ? 'photo' : 'PDF'}`,
        },
        updateStock: true,
      });

      await markInvoiceDraftCommitted(draft.id, String(invoiceId));
      await alert('Purchase invoice created and stock updated.', { severity: 'success' });
      navigate(`/purchases/${invoiceId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addBlankLine = async () => {
    if (!draftId || !draft) return;
    const lineId = `manual_${Date.now()}`;
    const blank: PurchaseInvoiceDraftResolvedLine = {
      lineId,
      productName: '',
      quantity: 1,
      matchStatus: 'unmatched',
      matchReason: 'none',
    };
    const resolvedLines = [...(draft.resolvedLines || []), blank];
    await updateInvoiceDraftReview(draftId, { resolvedLines, status: 'needs_review' });
  };

  const statusChip = useMemo(() => {
    const s = draft?.status || 'uploaded';
    const color: 'default' | 'success' | 'error' | 'warning' =
      s === 'ready' || s === 'committed'
        ? 'success'
        : s === 'failed'
          ? 'error'
          : s === 'needs_review'
            ? 'warning'
            : 'default';
    return <Chip size="small" color={color} label={s} />;
  }, [draft?.status]);

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchases', path: '/purchases' },
          { label: 'Ingest invoice' },
        ]}
      />
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/purchases')}>
          Back
        </Button>
        <Typography variant="h5">Ingest purchase invoice</Typography>
        {draftId ? statusChip : null}
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Upload a <strong>PDF</strong> or <strong>photo (JPG/PNG)</strong>. Gemini extracts only
        medicine line items (name, batch, expiry, qty, rates), then prefers medicines on{' '}
        <strong>pending orders</strong>, then inventory. Review before committing.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!draftId && (
        <Paper sx={{ p: 3 }}>
          <Button
            variant="contained"
            component="label"
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <CloudUpload />}
            disabled={busy}
          >
            Upload PDF or photo
            <input
              hidden
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/*"
              capture="environment"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </Button>
        </Paper>
      )}

      {draftId && !draft && (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      )}

      {draftId && draft && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Source
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {draft.sourceFile?.fileName} · {draft.sourceFile?.contentType}
              </Typography>
              {draft.extractionMeta?.message && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {draft.extractionMeta.message}
                </Alert>
              )}
              {previewUrl && draft.sourceFile?.contentType?.startsWith('image/') && (
                <Box
                  component="img"
                  src={previewUrl}
                  alt="Invoice"
                  sx={{ width: '100%', borderRadius: 1, maxHeight: 420, objectFit: 'contain' }}
                />
              )}
              {previewUrl && draft.sourceFile?.contentType === 'application/pdf' && (
                <Button href={previewUrl} target="_blank" rel="noreferrer" size="small">
                  Open PDF
                </Button>
              )}
              <Box mt={2} display="flex" gap={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PlayArrow />}
                  onClick={() => void reprocess()}
                  disabled={busy}
                >
                  Re-run extract
                </Button>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Vendor"
                    size="small"
                    value={draft.vendorId || ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      const v = vendors?.find((x) => x.id === id);
                      setDraft((d) =>
                        d
                          ? { ...d, vendorId: id, vendorName: v?.vendorName || d.vendorName }
                          : d
                      );
                    }}
                  >
                    <MenuItem value="">Select vendor</MenuItem>
                    {(vendors || []).map((v) => (
                      <MenuItem key={v.id} value={v.id}>
                        {v.vendorName}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="Invoice #"
                    size="small"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Invoice date"
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </Grid>
              </Grid>
              <Box mt={2} display="flex" gap={1}>
                <Button size="small" onClick={() => void saveHeader()} disabled={busy}>
                  Save header
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Save />}
                  onClick={() => void commit()}
                  disabled={busy || draft.status === 'committed'}
                >
                  Commit invoice + stock
                </Button>
              </Box>
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle1">Lines ({lines.length})</Typography>
                <Button size="small" onClick={() => void addBlankLine()} disabled={busy}>
                  Add line
                </Button>
              </Box>
              {busy && !lines.length ? (
                <Box display="flex" justifyContent="center" p={3}>
                  <CircularProgress />
                </Box>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Extracted</TableCell>
                      <TableCell>Match</TableCell>
                      <TableCell>Batch</TableCell>
                      <TableCell>Qty</TableCell>
                      <TableCell>Rate</TableCell>
                      <TableCell>Exp</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.lineId}>
                        <TableCell sx={{ minWidth: 160 }}>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="Product name"
                            value={line.productName || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { productName: e.target.value })
                            }
                          />
                          <Chip
                            size="small"
                            label={line.matchStatus}
                            color={
                              line.matchStatus === 'matched'
                                ? 'success'
                                : line.matchStatus === 'ambiguous'
                                  ? 'warning'
                                  : 'default'
                            }
                            sx={{ mt: 0.5 }}
                          />
                          {line.matchReason === 'pending_order' && (
                            <Chip size="small" color="warning" label="pending order" sx={{ ml: 0.5, mt: 0.5 }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ minWidth: 260 }}>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {line.selectedMedicineName || line.medicineName || '—'}
                            {(line.productId && ` [${line.productId}]`) || ''}
                          </Typography>
                          <LineMedicinePicker
                            line={line}
                            onPick={(medicineId, medicineName, productId) => {
                              void patchLine(line.lineId, {
                                selectedMedicineId: medicineId,
                                selectedMedicineName: medicineName,
                                medicineId,
                                medicineName,
                                productId,
                                matchStatus: 'matched',
                                matchReason: 'inventory',
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={line.batchNumber || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { batchNumber: e.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            sx={{ width: 80 }}
                            value={line.quantity ?? ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, {
                                quantity: parseFloat(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            sx={{ width: 90 }}
                            value={line.purchasePrice ?? ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, {
                                purchasePrice: parseFloat(e.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            placeholder="MM/YY"
                            sx={{ width: 90 }}
                            value={line.expiryMmYyyy || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { expiryMmYyyy: e.target.value })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {!lines.length && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography color="text.secondary">
                            No lines yet. For photos without OCR, click <strong>Add line</strong> and
                            resolve medicines manually (or configure Vision OCR and Re-run extract).
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

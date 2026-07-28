import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add, ArrowBack, CloudUpload, PlayArrow, Save } from '@mui/icons-material';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useVendors } from '../hooks/useVendors';
import { useCreatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { useCreateMedicine } from '../hooks/useInventory';
import { createMedicine, getMedicineById } from '../services/inventory';
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
import type {
  PurchaseInvoiceDraft,
  PurchaseInvoiceDraftResolvedLine,
  PurchaseInvoiceItem,
} from '../types';
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
import {
  findMedicineByExactName,
  resolveMedicineAfterPickerSelection,
} from '../services/medicineSearch';
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

/** Line taxable amount = qty × rate (minus discount % if any). Free qty not billed. */
function lineAmountTotal(line: PurchaseInvoiceDraftResolvedLine): number {
  const qty = Number(line.quantity) || 0;
  const rate = Number(line.purchasePrice) || 0;
  const disc = Number(line.discountPercentage) || 0;
  const base = qty * rate;
  if (disc > 0) return Math.round((base - (base * disc) / 100) * 100) / 100;
  return Math.round(base * 100) / 100;
}

function lineGstRate(line: PurchaseInvoiceDraftResolvedLine): number {
  const g = Number(line.gstRate);
  return Number.isFinite(g) && g >= 0 ? g : 5;
}

function lineGstAmount(line: PurchaseInvoiceDraftResolvedLine): number {
  return Math.round(lineAmountTotal(line) * (lineGstRate(line) / 100) * 100) / 100;
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type EnsuredMedicine = {
  medicineId: string;
  medicineName: string;
  productId?: string;
  gstRate: number;
  created: boolean;
};

/**
 * Find existing inventory by exact name, or auto-create a master row for ingest.
 */
async function ensureInventoryForIngestLine(
  line: PurchaseInvoiceDraftResolvedLine,
  cache: Map<string, EnsuredMedicine>
): Promise<EnsuredMedicine> {
  const existingId = line.selectedMedicineId || line.medicineId;
  if (existingId) {
    return {
      medicineId: existingId,
      medicineName: line.selectedMedicineName || line.medicineName || line.productName,
      productId: line.productId,
      gstRate: line.gstRate ?? 5,
      created: false,
    };
  }

  const name = (line.productName || line.medicineName || '').trim();
  if (!name) {
    throw new Error('Product name is required to add inventory');
  }
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return { ...cached, created: false };

  const existing = await findMedicineByExactName(name);
  if (existing) {
    const hit: EnsuredMedicine = {
      medicineId: existing.id,
      medicineName: existing.name,
      productId: existing.productId,
      gstRate: existing.gstRate ?? line.gstRate ?? 5,
      created: false,
    };
    cache.set(key, hit);
    return hit;
  }

  const gstRate = line.gstRate ?? 5;
  const packaging = (line.packaging || '').trim() || 'Unit';
  const medicineId = await createMedicine({
    name,
    category: 'General',
    manufacturer: 'Unknown',
    unit: packaging,
    stock: 0,
    currentStock: 0,
    price: line.mrp ?? line.purchasePrice ?? 0,
    mrp: line.mrp,
    purchasePrice: line.purchasePrice,
    gstRate,
    description:
      packaging !== 'Unit'
        ? `Packaging: ${packaging} (auto-created from purchase invoice ingest)`
        : 'Auto-created from purchase invoice ingest',
  });
  const created = await getMedicineById(medicineId);
  const hit: EnsuredMedicine = {
    medicineId,
    medicineName: created?.name || name,
    productId: created?.productId,
    gstRate: created?.gstRate ?? gstRate,
    created: true,
  };
  cache.set(key, hit);
  return hit;
}

const LineMedicinePicker: React.FC<{
  line: PurchaseInvoiceDraftResolvedLine;
  onPick: (medicineId: string, medicineName: string, productId?: string) => void;
}> = ({ line, onPick }) => {
  const matchedLabel = useMemo(() => {
    const name = line.selectedMedicineName || line.medicineName;
    if (!name) return '';
    return line.productId ? `${name} [${line.productId}]` : name;
  }, [line.selectedMedicineName, line.medicineName, line.productId]);

  const [input, setInput] = useState(matchedLabel);
  useEffect(() => {
    setInput(matchedLabel);
  }, [matchedLabel, line.lineId]);

  const searchQuery = input.trim() || matchedLabel || line.productName || '';
  const { medicines: hits, loading } = useMedicineSearch(searchQuery, {
    hydrate: false,
    limit: 30,
  });
  const { pendingMedicines, pendingDemands } = useMedicineResolutionContext();
  const options = useGroupedMedicineResolveOptions({
    query: searchQuery,
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
      onInputChange={(_, v, reason) => {
        if (reason === 'reset' && matchedLabel) {
          setInput(matchedLabel);
          return;
        }
        setInput(v);
      }}
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
        <TextField
          {...params}
          placeholder={matchedLabel ? undefined : 'Resolve medicine…'}
        />
      )}
    />
  );
};

export const PurchaseInvoiceIngestPage: React.FC = () => {
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams<{ draftId?: string }>();
  const { data: vendors } = useVendors();
  const createInvoice = useCreatePurchaseInvoice();
  const createMedicine = useCreateMedicine();
  const { alert } = useAppDialog();

  const [draftId, setDraftId] = useState<string | null>(routeDraftId || null);
  const [draft, setDraft] = useState<PurchaseInvoiceDraft | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayDateStringIST());
  const [addMedicineLineId, setAddMedicineLineId] = useState<string | null>(null);
  const [newMedicineData, setNewMedicineData] = useState({
    name: '',
    code: '',
    type: '',
    packaging: '',
    manufacturer: '',
    gstRate: '5',
  });
  const [commitProgress, setCommitProgress] = useState<{
    open: boolean;
    label: string;
    current: number;
    total: number;
  }>({ open: false, label: '', current: 0, total: 1 });

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
  const linesAmountTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineAmountTotal(line), 0),
    [lines]
  );
  const linesGstTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineGstAmount(line), 0),
    [lines]
  );

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

  const openAddMedicine = (line: PurchaseInvoiceDraftResolvedLine) => {
    setAddMedicineLineId(line.lineId);
    setNewMedicineData({
      name: line.productName || '',
      code: '',
      type: '',
      packaging: line.packaging || '',
      manufacturer: '',
      gstRate: line.gstRate != null ? String(line.gstRate) : '5',
    });
  };

  const closeAddMedicine = () => {
    setAddMedicineLineId(null);
    setNewMedicineData({
      name: '',
      code: '',
      type: '',
      packaging: '',
      manufacturer: '',
      gstRate: '5',
    });
  };

  const handleCreateMasterMedicine = async () => {
    if (
      !newMedicineData.name.trim() ||
      !newMedicineData.code.trim() ||
      !newMedicineData.type.trim() ||
      !newMedicineData.packaging.trim() ||
      !newMedicineData.manufacturer.trim() ||
      !newMedicineData.gstRate
    ) {
      await alert('Please fill all required fields to add master inventory.', {
        severity: 'warning',
      });
      return;
    }
    if (!addMedicineLineId) return;

    setBusy(true);
    try {
      const existing = await findMedicineByExactName(newMedicineData.name.trim());
      if (existing) {
        await patchLine(addMedicineLineId, {
          selectedMedicineId: existing.id,
          selectedMedicineName: existing.name,
          medicineId: existing.id,
          medicineName: existing.name,
          productId: existing.productId,
          gstRate: existing.gstRate ?? (parseFloat(newMedicineData.gstRate) || 5),
          matchStatus: 'matched',
          matchReason: 'inventory',
        });
        closeAddMedicine();
        await alert(
          `Medicine "${existing.name}" already exists in inventory. Line linked to it.`,
          { severity: 'info' }
        );
        return;
      }

      const medicineId = await createMedicine.mutateAsync({
        name: newMedicineData.name.trim(),
        code: newMedicineData.code.trim(),
        category: newMedicineData.type.trim(),
        unit: newMedicineData.packaging.trim(),
        manufacturer: newMedicineData.manufacturer.trim(),
        stock: 0,
        currentStock: 0,
        price: 0,
        gstRate: parseFloat(newMedicineData.gstRate) || 5,
        description: `Packaging: ${newMedicineData.packaging.trim()}`,
      });

      const created = await getMedicineById(medicineId);
      await patchLine(addMedicineLineId, {
        selectedMedicineId: medicineId,
        selectedMedicineName: created?.name || newMedicineData.name.trim(),
        medicineId,
        medicineName: created?.name || newMedicineData.name.trim(),
        productId: created?.productId,
        gstRate: created?.gstRate ?? (parseFloat(newMedicineData.gstRate) || 5),
        matchStatus: 'matched',
        matchReason: 'inventory',
      });
      closeAddMedicine();
      await alert(
        'Medicine added to inventory master. Line linked — stock will update on commit.',
        { severity: 'success' }
      );
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : String(e), { severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!draft) return;
    const vendorId = draft.vendorId;
    if (!vendorId) {
      await alert('Select a vendor before committing.', { severity: 'warning' });
      return;
    }
    const vendor = vendors?.find((v) => v.id === vendorId);
    let linesAll = [...(draft.resolvedLines || [])];
    const namedLines = linesAll.filter((l) => (l.productName || l.medicineName || '').trim());
    if (!namedLines.length) {
      await alert('No invoice lines to commit.', { severity: 'warning' });
      return;
    }

    const missingBatch = namedLines.filter((l) => !(l.batchNumber || '').trim());
    if (missingBatch.length) {
      await alert(
        `${missingBatch.length} line(s) are missing batch number. Fill batch before commit.`,
        { severity: 'warning' }
      );
      return;
    }

    setBusy(true);
    const ensureCache = new Map<string, EnsuredMedicine>();
    let autoCreated = 0;
    setCommitProgress({
      open: true,
      label: 'Linking / creating inventory master…',
      current: 0,
      total: Math.max(1, namedLines.length),
    });

    try {
      await saveHeader();

      const linkedLines: PurchaseInvoiceDraftResolvedLine[] = [];
      for (let i = 0; i < linesAll.length; i++) {
        const line = linesAll[i];
        const hasName = (line.productName || line.medicineName || '').trim();
        if (!hasName) {
          linkedLines.push(line);
          continue;
        }
        setCommitProgress({
          open: true,
          label: `Inventory: ${line.productName || line.medicineName}`,
          current: i,
          total: linesAll.length,
        });
        const ensured = await ensureInventoryForIngestLine(line, ensureCache);
        if (ensured.created) autoCreated += 1;
        linkedLines.push({
          ...line,
          selectedMedicineId: ensured.medicineId,
          selectedMedicineName: ensured.medicineName,
          medicineId: ensured.medicineId,
          medicineName: ensured.medicineName,
          productId: ensured.productId,
          gstRate: ensured.gstRate,
          matchStatus: 'matched',
          matchReason: line.matchReason === 'pending_order' ? 'pending_order' : 'inventory',
        });
      }

      linesAll = linkedLines;
      if (draftId) {
        await updateInvoiceDraftReview(draftId, {
          resolvedLines: linesAll,
          status: 'needs_review',
        });
        setDraft((d) => (d ? { ...d, resolvedLines: linesAll } : d));
      }

      const usable = linesAll.filter(
        (l) => (l.selectedMedicineId || l.medicineId) && (l.batchNumber || '').trim()
      );
      if (!usable.length) {
        await alert('Need at least one line with medicine and batch number.', {
          severity: 'warning',
        });
        return;
      }

      const items: PurchaseInvoiceItem[] = [];
      for (let i = 0; i < usable.length; i++) {
        const line = usable[i];
        setCommitProgress({
          open: true,
          label: `Preparing ${line.selectedMedicineName || line.medicineName || line.productName}…`,
          current: i,
          total: usable.length,
        });
        const medicineId = line.selectedMedicineId || line.medicineId!;
        const medicineName = line.selectedMedicineName || line.medicineName || line.productName;
        const qty = Number(line.quantity);
        const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
        if (quantity <= 0) continue;
        const freeRaw = Number(line.freeQuantity);
        const freeQuantity =
          Number.isFinite(freeRaw) && freeRaw > 0 ? freeRaw : undefined;
        const purchasePrice = Number(line.purchasePrice || 0);
        const mrp = line.mrp != null ? Number(line.mrp) : purchasePrice;
        const unitPrice = mrp;
        const disc = Number(line.discountPercentage) || 0;
        const baseAmount = purchasePrice * quantity;
        const totalAmount =
          disc > 0
            ? Math.round((baseAmount - (baseAmount * disc) / 100) * 100) / 100
            : Math.round(baseAmount * 100) / 100;
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
          quantity,
          freeQuantity,
          unitPrice,
          purchasePrice,
          mrp,
          totalAmount,
          expiryDate: parseExpiryToDate(line.expiryMmYyyy),
          discountPercentage: line.discountPercentage,
          gstRate: line.gstRate ?? 5,
          qrCode,
        });
      }

      const subTotal = items.reduce((s, i) => s + i.totalAmount, 0);
      const taxAmount = items.reduce(
        (s, i) => s + (i.totalAmount * (i.gstRate ?? 5)) / 100,
        0
      );
      const taxPercentage = 0;
      setCommitProgress({
        open: true,
        label: 'Saving purchase invoice…',
        current: 0,
        total: items.length,
      });
      const invoiceId = await createInvoice.mutateAsync({
        invoiceData: {
          invoiceNumber,
          vendorId,
          vendorName: vendor?.vendorName || draft.vendorName || '',
          invoiceDate: new Date(invoiceDate),
          items,
          subTotal,
          taxAmount: Math.round(taxAmount * 100) / 100,
          taxPercentage,
          totalAmount: Math.round((subTotal + taxAmount) * 100) / 100,
          paymentStatus: 'Unpaid',
          createdBy: auth.currentUser?.uid || '',
          createdAt: new Date(),
          notes: `Ingested from ${draft.sourceFile?.contentType?.startsWith('image/') ? 'photo' : 'PDF'}`,
        },
        updateStock: true,
        onProgress: (p) => {
          if (p.phase === 'saving_invoice') {
            setCommitProgress({
              open: true,
              label: 'Saving purchase invoice…',
              current: 0,
              total: Math.max(1, p.total),
            });
            return;
          }
          if (p.phase === 'updating_stock') {
            const name = p.medicineName || 'medicine';
            const batch = p.batchNumber ? ` · batch ${p.batchNumber}` : '';
            setCommitProgress({
              open: true,
              label: `Updating stock: ${name}${batch}`,
              current: p.current,
              total: Math.max(1, p.total),
            });
            return;
          }
          setCommitProgress({
            open: true,
            label: 'Finishing…',
            current: p.total,
            total: Math.max(1, p.total),
          });
        },
      });

      await markInvoiceDraftCommitted(draft.id, String(invoiceId));
      setCommitProgress({
        open: true,
        label: 'Done',
        current: items.length,
        total: items.length,
      });
      const createdNote =
        autoCreated > 0
          ? ` ${autoCreated} new medicine(s) added to inventory master.`
          : '';
      await alert(`Purchase invoice created and stock updated.${createdNote}`, {
        severity: 'success',
      });
      navigate(`/purchases/${invoiceId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setCommitProgress((p) => ({ ...p, open: false }));
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
        Upload a <strong>PDF</strong> or <strong>photo (JPG/PNG)</strong>. Gemini extracts medicine
        lines and matches pending orders / inventory. On commit, unmatched products are{' '}
        <strong>auto-added to inventory master</strong> (using invoice packaging when present), then
        stock is updated. You can still resolve or edit master details before committing.
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
                <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 1360, tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: '15%' }}>Extracted</TableCell>
                      <TableCell sx={{ width: '22%' }}>Match</TableCell>
                      <TableCell sx={{ width: '10%', minWidth: 96 }}>Batch</TableCell>
                      <TableCell sx={{ width: '7%', minWidth: 60 }}>Qty</TableCell>
                      <TableCell sx={{ width: '7%', minWidth: 60 }}>Free</TableCell>
                      <TableCell sx={{ width: '9%', minWidth: 80 }}>Rate</TableCell>
                      <TableCell sx={{ width: '8%', minWidth: 72 }}>GST %</TableCell>
                      <TableCell sx={{ width: '10%', minWidth: 92 }}>Amount</TableCell>
                      <TableCell sx={{ width: '8%', minWidth: 80 }}>Exp</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.lineId} sx={{ verticalAlign: 'top' }}>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="Product name"
                            value={line.productName || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { productName: e.target.value })
                            }
                          />
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="Packaging"
                            sx={{ mt: 0.5 }}
                            value={line.packaging || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { packaging: e.target.value })
                            }
                          />
                          <Box mt={0.5} display="flex" gap={0.5} flexWrap="wrap">
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
                            />
                            {line.matchReason === 'pending_order' && (
                              <Chip size="small" color="warning" label="pending order" />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
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
                          {!(line.selectedMedicineId || line.medicineId) && (
                            <Button
                              size="small"
                              startIcon={<Add />}
                              sx={{ mt: 0.5 }}
                              onClick={() => openAddMedicine(line)}
                              disabled={busy}
                            >
                              Edit master
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="Batch"
                            value={line.batchNumber || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { batchNumber: e.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            type="text"
                            inputMode="decimal"
                            value={line.quantity ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '' || raw === '.' || raw === '-') {
                                void patchLine(line.lineId, { quantity: 0 });
                                return;
                              }
                              const n = parseFloat(raw);
                              void patchLine(line.lineId, {
                                quantity: Number.isFinite(n) ? n : 0,
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={line.freeQuantity ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '' || raw === '.' || raw === '-') {
                                void patchLine(line.lineId, { freeQuantity: 0 });
                                return;
                              }
                              const n = parseFloat(raw);
                              void patchLine(line.lineId, {
                                freeQuantity: Number.isFinite(n) ? n : 0,
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            type="text"
                            inputMode="decimal"
                            value={line.purchasePrice ?? ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, {
                                purchasePrice: parseFloat(e.target.value) || 0,
                              })
                            }
                            inputProps={{ style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            type="text"
                            inputMode="decimal"
                            value={line.gstRate ?? 5}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '' || raw === '.' || raw === '-') {
                                void patchLine(line.lineId, { gstRate: 5 });
                                return;
                              }
                              const n = parseFloat(raw);
                              void patchLine(line.lineId, {
                                gstRate: Number.isFinite(n) ? n : 5,
                              });
                            }}
                            inputProps={{ style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            value={formatAmount(lineAmountTotal(line))}
                            InputProps={{ readOnly: true }}
                            inputProps={{
                              style: { textAlign: 'right', fontWeight: 600 },
                              'aria-label': 'Line amount',
                            }}
                            helperText={`GST ${formatAmount(lineGstAmount(line))}`}
                            FormHelperTextProps={{ sx: { m: 0, textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="MM/YY"
                            value={line.expiryMmYyyy || ''}
                            onChange={(e) =>
                              void patchLine(line.lineId, { expiryMmYyyy: e.target.value })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {!!lines.length && (
                      <TableRow>
                        <TableCell colSpan={6} align="right">
                          <Typography variant="subtitle2">Totals</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" display="block" textAlign="right" color="text.secondary">
                            GST {formatAmount(linesGstTotal)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="subtitle2" textAlign="right">
                            {formatAmount(linesAmountTotal)}
                          </Typography>
                          <Typography variant="caption" display="block" textAlign="right" color="text.secondary">
                            Incl. GST {formatAmount(linesAmountTotal + linesGstTotal)}
                          </Typography>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                    {!lines.length && (
                      <TableRow>
                        <TableCell colSpan={9}>
                          <Typography color="text.secondary">
                            No lines yet. For photos without OCR, click <strong>Add line</strong> and
                            resolve medicines manually (or configure Vision OCR and Re-run extract).
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </TableContainer>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      <Dialog open={commitProgress.open} maxWidth="xs" fullWidth>
        <DialogTitle>Committing invoice</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {commitProgress.label}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={Math.min(
              100,
              Math.round((commitProgress.current / Math.max(1, commitProgress.total)) * 100)
            )}
            sx={{ mt: 1, mb: 1 }}
          />
          <Typography variant="caption" color="text.secondary">
            {commitProgress.current} / {commitProgress.total}
          </Typography>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(addMedicineLineId)}
        onClose={() => !busy && closeAddMedicine()}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add medicine to inventory master</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
            Optional: set HSN, type, packaging, and manufacturer now. Otherwise commit will
            auto-create inventory using invoice packaging when available (else Unit), then update
            stock.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Medicine name"
                required
                value={newMedicineData.name}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="HSN / item code"
                required
                value={newMedicineData.code}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Type"
                required
                value={newMedicineData.type}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, type: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Packaging"
                required
                placeholder="e.g., 10 Tab, 100 ml"
                value={newMedicineData.packaging}
                onChange={(e) =>
                  setNewMedicineData({ ...newMedicineData, packaging: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturer"
                required
                value={newMedicineData.manufacturer}
                onChange={(e) =>
                  setNewMedicineData({ ...newMedicineData, manufacturer: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST rate (%)"
                required
                type="number"
                value={newMedicineData.gstRate}
                onChange={(e) =>
                  setNewMedicineData({ ...newMedicineData, gstRate: e.target.value })
                }
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddMedicine} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleCreateMasterMedicine()}
            disabled={busy || createMedicine.isPending}
          >
            {createMedicine.isPending ? 'Saving…' : 'Create & link line'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

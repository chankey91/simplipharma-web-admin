import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add,
  ArrowBack,
  CloudUpload,
  DeleteOutline,
  ExpandMore,
  PlayArrow,
  Save,
  Search as SearchIcon,
} from '@mui/icons-material';
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
  discardInvoiceDraft,
  getDraftFileDownloadUrl,
  isAllowedInvoiceUpload,
  listMyActiveInvoiceDrafts,
  markInvoiceDraftCommitted,
  processInvoiceDraft,
  subscribeInvoiceDraft,
  updateInvoiceDraftReview,
} from '../services/purchaseInvoiceIngest';
import type {
  Medicine,
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
import type { MedicineResolveOption } from '../services/medicineResolution';
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

function numOr(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Same formula as Add Invoice: discounted MRP / (1 + GST). */
function purchasePriceFromMrpAndDiscount(
  mrp: number,
  gstRate: number,
  standardDiscount: number
): number {
  if (mrp <= 0) return 0;
  const discountedMrp = mrp * (1 - standardDiscount / 100);
  return discountedMrp / (1 + gstRate / 100);
}

function standardDiscountFromMrpAndPurchasePrice(
  mrp: number,
  purchasePrice: number,
  gstRate: number
): number {
  if (mrp <= 0 || purchasePrice <= 0) return 20;
  const priceWithGST = purchasePrice * (1 + gstRate / 100);
  return (1 - priceWithGST / mrp) * 100;
}

/** Line taxable (ex-GST) after bill discount %. Free qty not billed. */
function lineTaxableAmount(line: PurchaseInvoiceDraftResolvedLine): number {
  const qty = numOr(line.quantity);
  const rate = numOr(line.purchasePrice);
  const disc = numOr(line.discountPercentage);
  const base = qty * rate;
  if (disc > 0) return Math.round((base - (base * disc) / 100) * 100) / 100;
  return Math.round(base * 100) / 100;
}

function lineGstRate(line: PurchaseInvoiceDraftResolvedLine): number {
  const g = Number(line.gstRate);
  return Number.isFinite(g) && g >= 0 ? g : 5;
}

function lineGstAmount(line: PurchaseInvoiceDraftResolvedLine): number {
  return Math.round(lineTaxableAmount(line) * (lineGstRate(line) / 100) * 100) / 100;
}

/** Matches Add Invoice line totalAmount: taxable + GST. */
function lineAmountTotal(line: PurchaseInvoiceDraftResolvedLine): number {
  return Math.round((lineTaxableAmount(line) + lineGstAmount(line)) * 100) / 100;
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function optionalPositiveInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/** Firestore rejects `undefined` field values. */
function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out as T;
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
  onPick: (medicineId: string, medicineName: string, productId?: string, gstRate?: number) => void;
  onDemandPick: (prefill: {
    name: string;
    manufacturer?: string;
    packaging?: string;
  }) => void;
}> = ({ line, onPick, onDemandPick }) => {
  const [medicineCache, setMedicineCache] = useState<Record<string, Medicine>>({});
  const rememberMedicines = useCallback((rows: Medicine[]) => {
    if (!rows.length) return;
    setMedicineCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const m of rows) {
        if (!m?.id) continue;
        if (!next[m.id]) {
          next[m.id] = m;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const rememberMedicine = useCallback(
    (m: Medicine | null | undefined) => {
      if (m?.id) rememberMedicines([m]);
    },
    [rememberMedicines]
  );

  const selectedMedicine = useMemo((): Medicine | null => {
    const id = line.selectedMedicineId || line.medicineId;
    if (!id) return null;
    const cached = medicineCache[id];
    if (cached) return cached;
    return {
      id,
      name: line.selectedMedicineName || line.medicineName || line.productName || '',
      productId: line.productId,
      category: 'General',
      manufacturer: '',
      unit: line.packaging || 'Unit',
      stock: 0,
      price: 0,
      gstRate: line.gstRate,
    } as Medicine;
  }, [line, medicineCache]);

  const selectedLabel = selectedMedicine ? getMedicinePickerLabel(selectedMedicine) : '';
  const [input, setInput] = useState(selectedLabel);
  useEffect(() => {
    setInput(selectedLabel);
  }, [selectedLabel, line.lineId]);

  const skipQuery =
    selectedMedicine != null && input.trim() === selectedLabel.trim()
      ? selectedLabel
      : undefined;
  const { medicines: hits, loading } = useMedicineSearch(input, {
    hydrate: false,
    limit: 40,
    skipQuery,
  });
  const { pendingMedicines, pendingDemands } = useMedicineResolutionContext();

  useEffect(() => {
    rememberMedicines(hits);
  }, [hits, rememberMedicines]);
  useEffect(() => {
    rememberMedicines(pendingMedicines);
  }, [pendingMedicines, rememberMedicines]);

  const options = useGroupedMedicineResolveOptions({
    query: input,
    inventoryHits: hits,
    pendingMedicines,
    pendingDemands,
    selectedMedicine,
  });

  const selectedResolveOption = useMemo((): MedicineResolveOption | null => {
    if (!selectedMedicine) return null;
    return (
      options.find((o) => o.medicine?.id === selectedMedicine.id) || {
        id: selectedMedicine.id,
        group: 'inventory',
        groupLabel: '3 · Inventory',
        label: getMedicinePickerLabel(selectedMedicine),
        selectable: true,
        medicine: selectedMedicine,
      }
    );
  }, [selectedMedicine, options]);

  return (
    <Autocomplete
      size="small"
      fullWidth
      loading={loading}
      options={options}
      groupBy={(o) => o.groupLabel}
      getOptionLabel={(o) => o.label}
      getOptionDisabled={(o) => !o.selectable && !o.demand}
      value={selectedResolveOption}
      inputValue={input}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_, newInputValue, reason) => {
        if (reason === 'clear') {
          setInput('');
          return;
        }
        if (reason === 'input') {
          setInput(newInputValue);
          return;
        }
        setInput(newInputValue);
      }}
      onChange={(_, newValue) => {
        if (!newValue) return;
        if (newValue.demand && !newValue.medicine) {
          const demand = newValue.demand;
          onDemandPick({
            name: demand.productName || line.productName || '',
            manufacturer: demand.manufacturerName || '',
            packaging: demand.requestedUnit || line.packaging || '',
          });
          return;
        }
        if (!newValue.selectable || !newValue.medicine) return;
        void resolveMedicineAfterPickerSelection(newValue.medicine, undefined).then((m) => {
          rememberMedicine(m);
          onPick(m.id, m.name, m.productId, m.gstRate);
          setInput(getMedicinePickerLabel(m));
        });
      }}
      renderGroup={renderMedicineResolveGroup}
      renderOption={renderMedicineResolveOption}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Match medicine"
          placeholder="Pending orders · demands · inventory…"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} fontSize="small" />
                {params.InputProps.startAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};

const StackLines: React.FC<{
  lines: PurchaseInvoiceDraftResolvedLine[];
  busy: boolean;
  linesTaxableTotal: number;
  linesGstTotal: number;
  linesAmountTotal: number;
  patchLine: (lineId: string, patch: Partial<PurchaseInvoiceDraftResolvedLine>) => void;
  openAddMedicine: (
    line: PurchaseInvoiceDraftResolvedLine,
    prefill?: { name?: string; manufacturer?: string; packaging?: string }
  ) => void;
}> = ({
  lines,
  busy,
  linesTaxableTotal,
  linesGstTotal,
  linesAmountTotal,
  patchLine,
  openAddMedicine,
}) => {
  if (!lines.length) {
    return (
      <Typography color="text.secondary">
        No lines yet. For photos without OCR, click <strong>Add line</strong> and resolve medicines
        manually (or configure Vision OCR and Re-run extract).
      </Typography>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {lines.map((line, index) => {
        const displayName =
          line.selectedMedicineName ||
          line.medicineName ||
          line.productName ||
          `Line ${index + 1}`;
        const qty = numOr(line.quantity);
        const free = numOr(line.freeQuantity);
        return (
        <Accordion
          key={line.lineId}
          disableGutters
          elevation={0}
          defaultExpanded={line.matchStatus !== 'matched'}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            '&:before': { display: 'none' },
            overflow: 'hidden',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMore />}
            sx={{
              px: 1.5,
              minHeight: 56,
              '& .MuiAccordionSummary-content': { my: 1, overflow: 'hidden' },
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 88px 112px' },
                width: '100%',
                gap: { xs: 0.5, sm: 1.5 },
                alignItems: 'center',
                pr: 1,
              }}
            >
              <Box minWidth={0}>
                <Typography variant="body2" fontWeight={600} noWrap title={displayName}>
                  {displayName}
                </Typography>
                <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.25}>
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
              </Box>
              <Box textAlign={{ xs: 'left', sm: 'right' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Qty
                </Typography>
                <Typography variant="body2">
                  {qty}
                  {free > 0 ? ` +${free}` : ''}
                </Typography>
              </Box>
              <Box textAlign={{ xs: 'left', sm: 'right' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Amount
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatAmount(lineAmountTotal(line))}
                </Typography>
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Product name"
                value={line.productName || ''}
                onChange={(e) => void patchLine(line.lineId, { productName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Packaging"
                value={line.packaging || ''}
                onChange={(e) => void patchLine(line.lineId, { packaging: e.target.value })}
                helperText="From invoice when present (used if creating master)"
              />
            </Grid>
            <Grid item xs={12}>
              <LineMedicinePicker
                line={line}
                onPick={(medicineId, medicineName, productId, gstRate) => {
                  patchLine(line.lineId, {
                    selectedMedicineId: medicineId,
                    selectedMedicineName: medicineName,
                    medicineId,
                    medicineName,
                    productId,
                    ...(gstRate != null ? { gstRate } : {}),
                    matchStatus: 'matched',
                    matchReason: 'inventory',
                  });
                }}
                onDemandPick={(prefill) => openAddMedicine(line, prefill)}
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
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Invoice Batch Number"
                required
                value={line.batchNumber || ''}
                onChange={(e) => void patchLine(line.lineId, { batchNumber: e.target.value })}
                helperText="Batch as printed on the vendor bill"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Received Batch Number"
                value={line.receivedBatchNumber || ''}
                onChange={(e) =>
                  void patchLine(line.lineId, { receivedBatchNumber: e.target.value })
                }
                helperText="Physical batch on packs if different from invoice"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Quantity"
                type="text"
                inputMode="decimal"
                required
                value={line.quantity ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { quantity: 0 });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, { quantity: Number.isFinite(n) ? n : 0 });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Free quantity (this bill)"
                type="text"
                inputMode="decimal"
                value={line.freeQuantity ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { freeQuantity: 0 });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, { freeQuantity: Number.isFinite(n) ? n : 0 });
                }}
                helperText="Extra strips/units free on this invoice (stock)"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Retailer scheme (optional): e.g. 1 free on 10 strips → pay for = 10, free = 1.
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Scheme — pay for (qty)"
                type="text"
                inputMode="numeric"
                value={line.schemePaidQty ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') {
                    void patchLine(line.lineId, { schemePaidQty: undefined });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, {
                    schemePaidQty: Number.isFinite(n) ? Math.floor(n) : undefined,
                  });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Scheme — get free (qty)"
                type="text"
                inputMode="numeric"
                value={line.schemeFreeQty ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') {
                    void patchLine(line.lineId, { schemeFreeQty: undefined });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, {
                    schemeFreeQty: Number.isFinite(n) ? Math.floor(n) : undefined,
                  });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={line.nonReturnable === true}
                    onChange={(e) =>
                      void patchLine(line.lineId, { nonReturnable: e.target.checked })
                    }
                  />
                }
                label="Non-returnable (retailer cannot return this batch)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={line.nrxDrug === true}
                    onChange={(e) => void patchLine(line.lineId, { nrxDrug: e.target.checked })}
                  />
                }
                label="NRX drug (Schedule H / restricted)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Expiry Date"
                placeholder="MM/YY"
                value={line.expiryMmYyyy || ''}
                onChange={(e) => void patchLine(line.lineId, { expiryMmYyyy: e.target.value })}
                helperText="MM/YY or MM/YYYY as on invoice"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="MRP"
                type="text"
                inputMode="decimal"
                value={line.mrp ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { mrp: undefined });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, { mrp: Number.isFinite(n) ? n : undefined });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                helperText="Purchase price recalculates from MRP + standard discount + GST"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="GST Rate (%)"
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
                  void patchLine(line.lineId, { gstRate: Number.isFinite(n) ? n : 5 });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Standard Discount (%)"
                type="text"
                inputMode="decimal"
                value={line.standardDiscount ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { standardDiscount: undefined });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, {
                    standardDiscount: Number.isFinite(n) ? n : undefined,
                  });
                }}
                helperText="Change to auto-update purchase price from MRP"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Purchase Price"
                type="text"
                inputMode="decimal"
                required
                value={line.purchasePrice ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { purchasePrice: 0 });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, {
                    purchasePrice: Number.isFinite(n) ? n : 0,
                  });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Discount Percentage (%)"
                type="text"
                inputMode="decimal"
                value={line.discountPercentage ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '.' || raw === '-') {
                    void patchLine(line.lineId, { discountPercentage: undefined });
                    return;
                  }
                  const n = parseFloat(raw);
                  void patchLine(line.lineId, {
                    discountPercentage: Number.isFinite(n) ? n : undefined,
                  });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                size="small"
                fullWidth
                label="Total Amount"
                value={formatAmount(lineAmountTotal(line))}
                InputProps={{ readOnly: true }}
                helperText={`Taxable ₹${formatAmount(lineTaxableAmount(line))} · GST ₹${formatAmount(lineGstAmount(line))}`}
              />
            </Grid>
          </Grid>
          </AccordionDetails>
        </Accordion>
        );
      })}

      <Divider />
      <Box display="flex" justifyContent="flex-end" gap={3} flexWrap="wrap">
        <Box textAlign="right">
          <Typography variant="caption" color="text.secondary">
            Subtotal
          </Typography>
          <Typography variant="body2">
            ₹
            {formatAmount(
              lines.reduce(
                (s, l) => s + numOr(l.purchasePrice) * numOr(l.quantity),
                0
              )
            )}
          </Typography>
        </Box>
        <Box textAlign="right">
          <Typography variant="caption" color="text.secondary">
            Discount
          </Typography>
          <Typography variant="body2">
            ₹
            {formatAmount(
              lines.reduce((s, l) => {
                const base = numOr(l.purchasePrice) * numOr(l.quantity);
                return s + (base * numOr(l.discountPercentage)) / 100;
              }, 0)
            )}
          </Typography>
        </Box>
        <Box textAlign="right">
          <Typography variant="caption" color="text.secondary">
            Taxable
          </Typography>
          <Typography variant="body2">₹{formatAmount(linesTaxableTotal)}</Typography>
        </Box>
        <Box textAlign="right">
          <Typography variant="caption" color="text.secondary">
            GST
          </Typography>
          <Typography variant="body2">₹{formatAmount(linesGstTotal)}</Typography>
        </Box>
        <Box textAlign="right">
          <Typography variant="caption" color="text.secondary">
            Grand total
          </Typography>
          <Typography variant="subtitle1">₹{formatAmount(linesAmountTotal)}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export const PurchaseInvoiceIngestPage: React.FC = () => {
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams<{ draftId?: string }>();
  const { data: vendors } = useVendors();
  const createInvoice = useCreatePurchaseInvoice();
  const createMedicine = useCreateMedicine();
  const { alert, confirm } = useAppDialog();

  const [draftId, setDraftId] = useState<string | null>(routeDraftId || null);
  const [draft, setDraft] = useState<PurchaseInvoiceDraft | null>(null);
  const [localLines, setLocalLines] = useState<PurchaseInvoiceDraftResolvedLine[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayDateStringIST());
  const [notes, setNotes] = useState('');
  const [inboxDrafts, setInboxDrafts] = useState<PurchaseInvoiceDraft[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
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

  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLinesRef = useRef<PurchaseInvoiceDraftResolvedLine[] | null>(null);
  const linesDirtyRef = useRef(false);

  const refreshInbox = useCallback(async () => {
    if (draftId) return;
    setInboxLoading(true);
    try {
      setInboxDrafts(await listMyActiveInvoiceDrafts());
    } catch {
      setInboxDrafts([]);
    } finally {
      setInboxLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void generatePurchaseInvoiceNumber()
      .then(setInvoiceNumber)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setDraftId(routeDraftId || null);
  }, [routeDraftId]);

  useEffect(() => {
    if (!draftId) {
      setDraft(null);
      setLocalLines([]);
      void refreshInbox();
      return;
    }
    return subscribeInvoiceDraft(draftId, setDraft);
  }, [draftId, refreshInbox]);

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
    if (draft?.notes != null) setNotes(draft.notes);
  }, [draft?.invoiceNumber, draft?.invoiceDate, draft?.notes]);

  useEffect(() => {
    if (!draft?.resolvedLines) {
      if (!linesDirtyRef.current) setLocalLines([]);
      return;
    }
    if (linesDirtyRef.current) return;
    setLocalLines(draft.resolvedLines);
  }, [draft?.resolvedLines]);

  const flushLinePatches = useCallback(async () => {
    if (!draftId || !pendingLinesRef.current) return;
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const resolvedLines = stripUndefinedDeep(pendingLinesRef.current);
    pendingLinesRef.current = null;
    try {
      await updateInvoiceDraftReview(draftId, {
        resolvedLines,
        status: 'needs_review',
      });
      linesDirtyRef.current = false;
    } catch (e: unknown) {
      linesDirtyRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draftId]);

  useEffect(() => {
    return () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    };
  }, []);

  const lines = localLines;
  const linesTaxableTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineTaxableAmount(line), 0),
    [lines]
  );
  const linesGstTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineGstAmount(line), 0),
    [lines]
  );
  const linesAmountTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineAmountTotal(line), 0),
    [lines]
  );

  const avgLineConfidence = useMemo(() => {
    const vals = lines
      .map((l) => (typeof l.confidence === 'number' ? l.confidence : NaN))
      .filter((n) => Number.isFinite(n));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [lines]);

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
    await flushLinePatches();
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

  const applyPricingToLine = (
    line: PurchaseInvoiceDraftResolvedLine,
    patch: Partial<PurchaseInvoiceDraftResolvedLine>
  ): PurchaseInvoiceDraftResolvedLine => {
    const next: PurchaseInvoiceDraftResolvedLine = { ...line, ...patch };
    const gst = lineGstRate(next);
    const mrp = numOr(next.mrp);
    const touchedMrp = Object.prototype.hasOwnProperty.call(patch, 'mrp');
    const touchedStd = Object.prototype.hasOwnProperty.call(patch, 'standardDiscount');
    const touchedPp = Object.prototype.hasOwnProperty.call(patch, 'purchasePrice');

    if ((touchedMrp || touchedStd) && mrp > 0) {
      const std =
        next.standardDiscount === undefined || next.standardDiscount === null
          ? 20
          : numOr(next.standardDiscount, 20);
      const pp = purchasePriceFromMrpAndDiscount(mrp, gst, std);
      next.purchasePrice = Math.round(pp * 100) / 100;
      if (next.standardDiscount == null) next.standardDiscount = std;
    } else if (touchedPp && mrp > 0) {
      const pp = numOr(next.purchasePrice);
      next.standardDiscount =
        Math.round(standardDiscountFromMrpAndPurchasePrice(mrp, pp, gst) * 100) / 100;
    }
    return next;
  };

  const patchLine = (lineId: string, patch: Partial<PurchaseInvoiceDraftResolvedLine>) => {
    if (!draftId) return;
    setLocalLines((prev) => {
      const resolvedLines = prev.map((l) =>
        l.lineId === lineId ? applyPricingToLine(l, patch) : l
      );
      pendingLinesRef.current = resolvedLines;
      linesDirtyRef.current = true;
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => {
        void flushLinePatches();
      }, 450);
      return resolvedLines;
    });
  };

  const saveHeader = async () => {
    if (!draftId) return;
    await flushLinePatches();
    const vendor = vendors?.find((v) => v.id === draft?.vendorId);
    await updateInvoiceDraftReview(draftId, {
      vendorId: draft?.vendorId,
      vendorName: vendor?.vendorName || draft?.vendorName,
      invoiceNumber,
      invoiceDate,
      notes: notes.trim() || null,
    });
  };

  const openAddMedicine = (
    line: PurchaseInvoiceDraftResolvedLine,
    prefill?: { name?: string; manufacturer?: string; packaging?: string }
  ) => {
    setAddMedicineLineId(line.lineId);
    setNewMedicineData({
      name: prefill?.name || line.productName || '',
      code: '',
      type: '',
      packaging: prefill?.packaging || line.packaging || '',
      manufacturer: prefill?.manufacturer || '',
      gstRate: line.gstRate != null ? String(line.gstRate) : '5',
    });
  };

  const discardDraft = async (id: string) => {
    const ok = await confirm('Discard this draft? You can upload the invoice again later.');
    if (!ok) return;
    try {
      await discardInvoiceDraft(id);
      if (draftId === id) {
        setDraftId(null);
        navigate('/purchases/ingest', { replace: true });
      }
      await refreshInbox();
    } catch (e: unknown) {
      await alert(e instanceof Error ? e.message : String(e), { severity: 'error' });
    }
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
    if (!draft || !draftId) return;
    await flushLinePatches();
    const vendorId = draft.vendorId;
    if (!vendorId) {
      await alert('Select a vendor before committing.', { severity: 'warning' });
      return;
    }
    const vendor = vendors?.find((v) => v.id === vendorId);
    let linesAll = [...localLines];
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

    const unmatchedNamed = namedLines.filter(
      (l) => !(l.selectedMedicineId || l.medicineId)
    );
    if (unmatchedNamed.length) {
      const ok = await confirm(
        `${unmatchedNamed.length} line(s) have no inventory match. Commit will auto-create medicine masters (category General, manufacturer Unknown) for those names.\n\nContinue?`
      );
      if (!ok) return;
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
      await updateInvoiceDraftReview(draftId, { status: 'committing' });
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
      setLocalLines(linesAll);
      await updateInvoiceDraftReview(draftId, {
        resolvedLines: stripUndefinedDeep(linesAll),
        status: 'committing',
      });
      linesDirtyRef.current = false;

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
        const schemePaidQty = optionalPositiveInt(line.schemePaidQty);
        const schemeFreeQty =
          schemePaidQty != null ? optionalPositiveInt(line.schemeFreeQty) : undefined;
        const purchasePrice = Number(line.purchasePrice || 0);
        const mrpRaw = line.mrp != null ? Number(line.mrp) : NaN;
        const mrp = Number.isFinite(mrpRaw) && mrpRaw > 0 ? mrpRaw : undefined;
        const gstRate = line.gstRate ?? 5;
        const disc = Number(line.discountPercentage) || 0;
        const baseAmount = purchasePrice * quantity;
        const discountAmount = (baseAmount * disc) / 100;
        const amountAfterDiscount = baseAmount - discountAmount;
        const gstAmount = (amountAfterDiscount * gstRate) / 100;
        const totalAmount = Math.round((amountAfterDiscount + gstAmount) * 100) / 100;
        const enteredStd = Number(line.standardDiscount);
        const standardDiscount = Number.isFinite(enteredStd)
          ? enteredStd
          : mrp != null && purchasePrice > 0
            ? standardDiscountFromMrpAndPurchasePrice(mrp, purchasePrice, gstRate)
            : undefined;
        const receivedBatchNumber = String(line.receivedBatchNumber || '').trim();
        const stockBatchForQr = receivedBatchNumber || String(line.batchNumber || '').trim();
        const qrCode = await QRCode.toDataURL(
          JSON.stringify({
            medicineId,
            medicineName,
            batchNumber: stockBatchForQr,
            invoiceNumber,
            quantity,
            freeQuantity,
            schemePaidQty,
            schemeFreeQty,
            purchasePrice,
            mrp,
          })
        );
        items.push({
          medicineId,
          medicineName,
          batchNumber: String(line.batchNumber || '').trim(),
          ...(receivedBatchNumber ? { receivedBatchNumber } : {}),
          quantity,
          freeQuantity,
          ...(schemePaidQty != null && schemeFreeQty != null
            ? { schemePaidQty, schemeFreeQty }
            : {}),
          unitPrice: purchasePrice,
          purchasePrice,
          mrp,
          totalAmount,
          expiryDate: parseExpiryToDate(line.expiryMmYyyy),
          discountPercentage: disc > 0 ? disc : undefined,
          standardDiscount:
            standardDiscount != null && Number.isFinite(standardDiscount)
              ? standardDiscount
              : undefined,
          gstRate,
          qrCode,
          ...(line.nonReturnable === true ? { nonReturnable: true } : {}),
          ...(line.nrxDrug === true ? { nrxDrug: true } : {}),
        });
      }

      const subTotal = items.reduce(
        (s, i) => s + (i.purchasePrice || 0) * (i.quantity || 0),
        0
      );
      const totalDiscount = items.reduce((s, i) => {
        const base = (i.purchasePrice || 0) * (i.quantity || 0);
        return s + (base * (i.discountPercentage || 0)) / 100;
      }, 0);
      const taxAmount = items.reduce((s, i) => {
        const base = (i.purchasePrice || 0) * (i.quantity || 0);
        const afterDisc = base - (base * (i.discountPercentage || 0)) / 100;
        return s + (afterDisc * (i.gstRate || 0)) / 100;
      }, 0);
      const calculatedTotal = subTotal - totalDiscount + taxAmount;
      const grandTotal = Math.round(calculatedTotal);
      const taxPercentage = 0;
      setCommitProgress({
        open: true,
        label: 'Saving purchase invoice…',
        current: 0,
        total: items.length,
      });
      const sourceNote = `Ingested from ${
        draft.sourceFile?.contentType?.startsWith('image/') ? 'photo' : 'PDF'
      }`;
      const mergedNotes = [notes.trim(), sourceNote].filter(Boolean).join(' · ');
      const invoiceId = await createInvoice.mutateAsync({
        invoiceData: {
          invoiceNumber,
          vendorId,
          vendorName: vendor?.vendorName || draft.vendorName || '',
          invoiceDate: new Date(invoiceDate),
          items,
          subTotal: Math.round(subTotal * 100) / 100,
          taxAmount: Math.round(taxAmount * 100) / 100,
          discount: totalDiscount > 0 ? Math.round(totalDiscount * 100) / 100 : undefined,
          taxPercentage,
          totalAmount: grandTotal,
          paymentStatus: 'Unpaid',
          createdBy: auth.currentUser?.uid || '',
          createdAt: new Date(),
          notes: mergedNotes || undefined,
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
      if (draftId) {
        try {
          await updateInvoiceDraftReview(draftId, { status: 'needs_review' });
        } catch {
          /* ignore recovery failure */
        }
      }
    } finally {
      setBusy(false);
      setCommitProgress((p) => ({ ...p, open: false }));
    }
  };

  const addBlankLine = async () => {
    if (!draftId) return;
    await flushLinePatches();
    const lineId = `manual_${Date.now()}`;
    const blank: PurchaseInvoiceDraftResolvedLine = {
      lineId,
      productName: '',
      quantity: 1,
      freeQuantity: 0,
      gstRate: 5,
      standardDiscount: 20,
      matchStatus: 'unmatched',
      matchReason: 'none',
    };
    const resolvedLines = [...localLines, blank];
    setLocalLines(resolvedLines);
    linesDirtyRef.current = false;
    await updateInvoiceDraftReview(draftId, {
      resolvedLines: stripUndefinedDeep(resolvedLines),
      status: 'needs_review',
    });
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
        Upload a <strong>PDF</strong> or <strong>photo (JPG/PNG)</strong>. Extracted fields match{' '}
        <strong>Add Invoice</strong> (batches, scheme, MRP, discounts, flags, notes). Review and edit
        before commit — unmatched products can be auto-added to inventory master, then stock updates.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!draftId && (
        <Stack gap={2}>
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

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              Your drafts
            </Typography>
            {inboxLoading ? (
              <Box display="flex" justifyContent="center" p={2}>
                <CircularProgress size={24} />
              </Box>
            ) : !inboxDrafts.length ? (
              <Typography variant="body2" color="text.secondary">
                No open drafts. Upload an invoice to start.
              </Typography>
            ) : (
              <List dense>
                {inboxDrafts.map((d) => (
                  <ListItem
                    key={d.id}
                    button
                    onClick={() => navigate(`/purchases/ingest/${d.id}`)}
                  >
                    <ListItemText
                      primary={d.sourceFile?.fileName || d.id}
                      secondary={`${d.status}${d.invoiceNumber ? ` · ${d.invoiceNumber}` : ''}${
                        d.resolvedLines?.length ? ` · ${d.resolvedLines.length} lines` : ''
                      }`}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        aria-label="discard"
                        onClick={(e) => {
                          e.stopPropagation();
                          void discardDraft(d.id);
                        }}
                      >
                        <DeleteOutline />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Stack>
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
              <Box display="flex" gap={0.75} flexWrap="wrap" mb={1}>
                {draft.extractionMeta?.engine && (
                  <Chip
                    size="small"
                    color={
                      draft.extractionMeta.engine === 'gemini'
                        ? 'success'
                        : draft.extractionMeta.engine === 'none'
                          ? 'default'
                          : 'warning'
                    }
                    label={`Engine: ${draft.extractionMeta.engine}`}
                  />
                )}
                {draft.extractionMeta?.model && (
                  <Chip size="small" variant="outlined" label={draft.extractionMeta.model} />
                )}
                {avgLineConfidence != null && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Avg confidence ${(avgLineConfidence * 100).toFixed(0)}%`}
                  />
                )}
              </Box>
              {draft.extractionMeta?.message && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {draft.extractionMeta.message}
                </Alert>
              )}
              <Box mt={1} mb={1} display="flex" gap={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PlayArrow />}
                  onClick={() => void reprocess()}
                  disabled={busy}
                >
                  Re-run extract
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutline />}
                  onClick={() => void discardDraft(draft.id)}
                  disabled={busy || draft.status === 'committed'}
                >
                  Discard draft
                </Button>
              </Box>
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
                  {draft.vendorId && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {vendors?.find((v) => v.id === draft.vendorId)?.gstNumber
                        ? `GSTIN: ${vendors.find((v) => v.id === draft.vendorId)?.gstNumber}`
                        : draft.vendorHint?.gstin
                          ? `Extracted GSTIN: ${draft.vendorHint.gstin}`
                          : ''}
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="Invoice Number"
                    size="small"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Invoice Date"
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    label="Notes"
                    size="small"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    helperText="Optional. Extracted remarks appear here when present on the invoice."
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
                <StackLines
                  lines={lines}
                  busy={busy}
                  linesTaxableTotal={linesTaxableTotal}
                  linesGstTotal={linesGstTotal}
                  linesAmountTotal={linesAmountTotal}
                  patchLine={patchLine}
                  openAddMedicine={openAddMedicine}
                />
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

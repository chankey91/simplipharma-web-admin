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
  Divider,
  CircularProgress,
  Chip,
  Alert,
} from '@mui/material';
import { Add, Delete, Search, ArrowBack, FileDownload } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useVendors } from '../hooks/useVendors';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
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
import {
  buildPurchaseSourceIndex,
  resolvePurchaseSource,
  sourceMatchLabel,
  type PurchaseSourceHit,
  type PurchaseSourceMatch,
  type PurchaseSourceResolution,
  type PurchaseSourceStatus,
} from '../utils/purchaseSourceLookup';
import { exportVendorWiseReturnList } from '../utils/purchaseReturnVendorListExport';
import { Medicine, PurchaseReturnItem, Vendor } from '../types';
import type { CreatePurchaseReturnInput } from '../services/purchaseReturns';

const UNKNOWN_VENDOR_ID = '';

type DraftLine = PurchaseReturnItem & {
  availableQuantity: number;
  vendorId: string;
  vendorName: string;
  sourceStatus: PurchaseSourceStatus | 'manual';
  sourceMatch?: PurchaseSourceMatch;
  sourceInvoiceNumber?: string;
  sourceCandidates: PurchaseSourceHit[];
  nonReturnable?: boolean;
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

function batchKeyOf(medicineId: string, batchNumber: string): string {
  return `${medicineId}::${batchNumber.toLowerCase()}`;
}

function applyResolutionToLine(
  line: DraftLine,
  resolution: PurchaseSourceResolution
): DraftLine {
  if (line.sourceStatus === 'manual' && line.vendorId) return line;
  if (resolution.status === 'exact' || resolution.status === 'guess') {
    return {
      ...line,
      vendorId: resolution.vendorId || '',
      vendorName: resolution.vendorName || '',
      sourceStatus: resolution.status,
      sourceMatch: resolution.match,
      sourceInvoiceNumber: resolution.invoiceNumber,
      sourceCandidates: resolution.candidates,
    };
  }
  return {
    ...line,
    vendorId: '',
    vendorName: '',
    sourceStatus: resolution.status,
    sourceMatch: undefined,
    sourceInvoiceNumber: undefined,
    sourceCandidates: resolution.candidates,
  };
}

export const CreatePurchaseReturnPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert, confirm } = useAppDialog();
  const { data: vendors } = useVendors();
  const { data: purchaseInvoices, isLoading: invoicesLoading } = usePurchaseInvoices();
  const createMutation = useCreatePurchaseReturnsMultiVendor();

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
    vendorId: string;
    resolution: PurchaseSourceResolution | null;
    showAllVendors: boolean;
  }>({
    open: false,
    option: null,
    quantity: '1',
    vendorId: '',
    resolution: null,
    showAllVendors: false,
  });

  const {
    medicines: searchMedicines,
    loading: searchLoading,
  } = useMedicineSearch(searchInput, {
    hydrate: false,
    limit: 40,
    skipQuery: selectedOption?.label,
  });

  const sourceIndex = useMemo(
    () => buildPurchaseSourceIndex(purchaseInvoices ?? []),
    [purchaseInvoices]
  );

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

  useEffect(() => {
    if (!purchaseInvoices) return;
    setItems((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((line) => {
        if (line.sourceStatus === 'manual') return line;
        if (line.sourceStatus === 'exact' && line.vendorId) return line;
        const resolved = resolvePurchaseSource(
          sourceIndex,
          line.medicineId,
          line.batchNumber,
          line.expiryDate instanceof Date ? line.expiryDate : undefined
        );
        const updated = applyResolutionToLine(line, resolved);
        if (
          updated.vendorId !== line.vendorId ||
          updated.sourceStatus !== line.sourceStatus ||
          updated.sourceInvoiceNumber !== line.sourceInvoiceNumber
        ) {
          changed = true;
        }
        return updated;
      });
      return changed ? next : prev;
    });
  }, [purchaseInvoices, sourceIndex]);

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

  const vendorGroups = useMemo(() => {
    const map = new Map<
      string,
      { vendorId: string; vendorName: string; vendorGstin?: string; lines: DraftLine[] }
    >();
    for (const it of items) {
      const id = it.vendorId || UNKNOWN_VENDOR_ID;
      const vendorGstin = vendorOptions.find((v) => v.id === id)?.gstNumber;
      const g = map.get(id) || {
        vendorId: id,
        vendorName: id ? it.vendorName : 'Unknown vendor',
        vendorGstin,
        lines: [] as DraftLine[],
      };
      g.lines.push(it);
      map.set(id, g);
    }
    const groups = [...map.values()];
    groups.sort((a, b) => {
      if (!a.vendorId) return 1;
      if (!b.vendorId) return -1;
      return a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: 'base' });
    });
    return groups;
  }, [items, vendorOptions]);

  const unknownCount = items.filter((it) => !it.vendorId).length;
  const assignedGroups = vendorGroups.filter((g) => g.vendorId);

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
    const resolution = resolvePurchaseSource(
      sourceIndex,
      option.medicineId,
      option.batchNumber,
      option.expiryDate instanceof Date ? option.expiryDate : undefined
    );
    const vendorId =
      resolution.status === 'exact' || resolution.status === 'guess'
        ? resolution.vendorId || ''
        : '';
    setQtyDialog({
      open: true,
      option,
      quantity: '1',
      vendorId,
      resolution,
      showAllVendors: false,
    });
  };

  const dialogVendorOptions = useMemo(() => {
    const candidates = qtyDialog.resolution?.candidates ?? [];
    if (!qtyDialog.showAllVendors && candidates.length > 0) {
      const byId = new Map<string, Vendor>();
      for (const c of candidates) {
        const fromMaster = vendorOptions.find((v) => v.id === c.vendorId);
        byId.set(
          c.vendorId,
          fromMaster ||
            ({
              id: c.vendorId,
              vendorName: c.vendorName,
            } as Vendor)
        );
      }
      return [...byId.values()];
    }
    return vendorOptions;
  }, [qtyDialog.resolution, qtyDialog.showAllVendors, vendorOptions]);

  const handleConfirmQty = () => {
    const option = qtyDialog.option;
    if (!option) return;
    const qty = parseInt(qtyDialog.quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      void alert('Enter a valid return quantity');
      return;
    }
    if (qty > option.availableQuantity) {
      void alert(`Only ${option.availableQuantity} available in batch ${option.batchNumber}`);
      return;
    }
    if (qtyDialog.resolution?.status === 'ambiguous' && !qtyDialog.vendorId) {
      void alert('This batch appears on more than one vendor bill. Pick the vendor.');
      return;
    }

    const resolution = qtyDialog.resolution;
    const pickedVendor = vendorOptions.find((v) => v.id === qtyDialog.vendorId);
    const candidate = resolution?.candidates.find((c) => c.vendorId === qtyDialog.vendorId);
    const vendorId = pickedVendor?.id || candidate?.vendorId || '';
    const vendorName = pickedVendor?.vendorName || candidate?.vendorName || '';
    const sourceStatus: DraftLine['sourceStatus'] =
      vendorId && resolution?.status === 'exact' && resolution.vendorId === vendorId
        ? 'exact'
        : vendorId && resolution?.status === 'guess' && resolution.vendorId === vendorId
          ? 'guess'
          : vendorId
            ? 'manual'
            : resolution?.status || 'none';

    const unitPrice = option.purchasePrice;
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;
    const batchKey = batchKeyOf(option.medicineId, option.batchNumber);

    const existing = items.find(
      (it) => batchKeyOf(it.medicineId, it.batchNumber) === batchKey
    );
    if (existing) {
      const nextQty = existing.quantity + qty;
      if (nextQty > option.availableQuantity) {
        void alert(
          `Cannot exceed available ${option.availableQuantity} for batch ${option.batchNumber}`
        );
        return;
      }
      setItems((prev) =>
        prev.map((it) =>
          batchKeyOf(it.medicineId, it.batchNumber) === batchKey
            ? {
                ...it,
                quantity: nextQty,
                totalAmount: Math.round(unitPrice * nextQty * 100) / 100,
                vendorId: vendorId || it.vendorId,
                vendorName: vendorName || it.vendorName,
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
          vendorId,
          vendorName,
          sourceStatus,
          sourceMatch: resolution?.match,
          sourceInvoiceNumber: candidate?.invoiceNumber || resolution?.invoiceNumber,
          sourceCandidates: resolution?.candidates || [],
          nonReturnable: option.nonReturnable,
        },
      ]);
    }

    setQtyDialog({
      open: false,
      option: null,
      quantity: '1',
      vendorId: '',
      resolution: null,
      showAllVendors: false,
    });
    setSelectedOption(null);
    setSearchInput('');
  };

  const handleRemove = (medicineId: string, batchNumber: string) => {
    setItems((prev) =>
      prev.filter((it) => batchKeyOf(it.medicineId, it.batchNumber) !== batchKeyOf(medicineId, batchNumber))
    );
  };

  const handleAssignVendor = (medicineId: string, batchNumber: string, vendor: Vendor | null) => {
    const key = batchKeyOf(medicineId, batchNumber);
    setItems((prev) =>
      prev.map((it) => {
        if (batchKeyOf(it.medicineId, it.batchNumber) !== key) return it;
        if (!vendor) {
          return {
            ...it,
            vendorId: '',
            vendorName: '',
            sourceStatus: it.sourceCandidates.length > 1 ? 'ambiguous' : 'none',
            sourceInvoiceNumber: undefined,
          };
        }
        const candidate = it.sourceCandidates.find((c) => c.vendorId === vendor.id);
        return {
          ...it,
          vendorId: vendor.id,
          vendorName: vendor.vendorName,
          sourceStatus: 'manual',
          sourceInvoiceNumber: candidate?.invoiceNumber || it.sourceInvoiceNumber,
        };
      })
    );
  };

  const handleExport = () => {
    if (items.length === 0) {
      void alert('Add items before downloading the vendor list');
      return;
    }
    exportVendorWiseReturnList(
      vendorGroups.flatMap((g) =>
        g.lines.map((it) => ({
          vendorName: g.vendorName,
          medicineName: it.medicineName,
          batchNumber: it.batchNumber,
          expiry: formatExpiry(it.expiryDate),
          availableQuantity: it.availableQuantity,
          quantity: it.quantity,
          purchasePrice: Number(it.purchasePrice) || 0,
          totalAmount: Number(it.totalAmount) || 0,
          invoiceNumber: it.sourceInvoiceNumber,
          matchLabel: sourceMatchLabel(
            it.sourceMatch,
            it.sourceStatus === 'manual' ? undefined : it.sourceStatus
          ),
        }))
      )
    );
  };

  const handleSave = async () => {
    if (items.length === 0) {
      await alert('Add at least one item');
      return;
    }
    if (unknownCount > 0) {
      await alert(
        `${unknownCount} item(s) have no vendor. Assign a vendor on those rows, or remove them, before creating returns.`
      );
      return;
    }
    const date = new Date(returnDate);
    if (!Number.isFinite(date.getTime())) {
      await alert('Enter a valid return date');
      return;
    }

    const vendorSummary = assignedGroups
      .map((g) => `• ${g.vendorName}: ${g.lines.length} item(s)`)
      .join('\n');
    const ok = await confirm(
      `Create ${assignedGroups.length} purchase return(s) for ${items.length} item(s), total ₹${totalAmount.toFixed(2)}?\n\n${vendorSummary}\n\nStock will be deducted from inventory.`
    );
    if (!ok) return;

    try {
      const payloads: CreatePurchaseReturnInput[] = assignedGroups.map((g) => {
        const lines = g.lines;
        const groupSub = lines.reduce(
          (s, it) => s + (Number(it.purchasePrice) || 0) * (Number(it.quantity) || 0),
          0
        );
        const groupTax = lines.reduce((s, it) => s + lineTax(it), 0);
        return {
          vendorId: g.vendorId,
          vendorName: g.vendorName,
          vendorGstin: g.vendorGstin,
          returnDate: date,
          items: lines.map(
            ({
              availableQuantity: _a,
              vendorId: _v,
              vendorName: _n,
              sourceStatus: _s,
              sourceMatch: _m,
              sourceInvoiceNumber: _i,
              sourceCandidates: _c,
              nonReturnable: _nr,
              ...rest
            }) => rest
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

  const sourceChip = (line: DraftLine) => {
    if (!line.vendorId) {
      return <Chip size="small" color="warning" label="Needs vendor" />;
    }
    if (line.sourceStatus === 'exact') {
      return <Chip size="small" color="success" variant="outlined" label="Batch match" />;
    }
    if (line.sourceStatus === 'guess') {
      return <Chip size="small" color="warning" variant="outlined" label="Check vendor" />;
    }
    if (line.sourceStatus === 'manual') {
      return <Chip size="small" variant="outlined" label="Picked" />;
    }
    return null;
  };

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: 'Purchase returns', path: '/purchase-returns' },
          { label: 'Create' },
        ]}
      />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
        <Typography variant="h5">Create Purchase Return</Typography>
        <Box display="flex" gap={1}>
          <Button
            startIcon={<FileDownload />}
            onClick={handleExport}
            disabled={items.length === 0}
          >
            Download vendor list
          </Button>
          <Button startIcon={<ArrowBack />} onClick={() => navigate('/purchase-returns')}>
            Back
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Add every strip first (name or batch). Vendor is filled from the purchase invoice that
        billed that batch. The list is grouped by vendor — download Excel to pack, then create
        one purchase return per vendor. Stock is not deducted until you save.
      </Alert>
      {invoicesLoading && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Loading purchase invoices to match vendors…
        </Alert>
      )}

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
            {vendorGroups.length > 0 && (
              <Box mb={2}>
                {vendorGroups.map((g) => {
                  const gSub = g.lines.reduce(
                    (s, it) =>
                      s + (Number(it.purchasePrice) || 0) * (Number(it.quantity) || 0),
                    0
                  );
                  const gTax = g.lines.reduce((s, it) => s + lineTax(it), 0);
                  return (
                    <Box key={g.vendorId || 'unknown'} display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color={g.vendorId ? 'textSecondary' : 'warning.main'}>
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
              {items.length === 0
                ? 'No items yet'
                : unknownCount > 0
                  ? `${unknownCount} item(s) still need a vendor`
                  : assignedGroups.length === 1
                    ? '1 purchase return will be created'
                    : `${assignedGroups.length} purchase returns will be created (one per vendor)`}
            </Typography>
            <Button
              fullWidth
              variant="contained"
              sx={{ mt: 2 }}
              onClick={() => void handleSave()}
              disabled={createMutation.isPending || items.length === 0 || unknownCount > 0}
            >
              {createMutation.isPending
                ? 'Saving…'
                : assignedGroups.length > 1
                  ? `Create ${assignedGroups.length} purchase returns`
                  : 'Create purchase return'}
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2}>
              <Typography variant="h6">Vendor-wise list</Typography>
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

            {items.length === 0 ? (
              <Typography variant="body2" color="textSecondary" sx={{ py: 4 }} align="center">
                Search a medicine or batch from the strip. Vendor is matched from purchase
                invoices automatically.
              </Typography>
            ) : (
              vendorGroups.map((group) => (
                <Box key={group.vendorId || 'unknown'} sx={{ mb: 3 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {group.vendorName}
                    </Typography>
                    <Chip size="small" label={`${group.lines.length} item(s)`} />
                    {!group.vendorId && (
                      <Chip size="small" color="warning" label="Assign vendor on each row" />
                    )}
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Medicine</TableCell>
                          <TableCell sx={{ minWidth: 200 }}>Vendor</TableCell>
                          <TableCell>Batch</TableCell>
                          <TableCell align="right">Avail</TableCell>
                          <TableCell align="right">Return qty</TableCell>
                          <TableCell align="right">Rate</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="center" width={56} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {group.lines.map((item) => (
                          <TableRow key={batchKeyOf(item.medicineId, item.batchNumber)}>
                            <TableCell>
                              <Typography variant="body2" fontWeight="medium">
                                {item.medicineName}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                Exp: {formatExpiry(item.expiryDate)}
                                {item.sourceInvoiceNumber ? ` · PI ${item.sourceInvoiceNumber}` : ''}
                              </Typography>
                              {item.nonReturnable && (
                                <Typography variant="caption" color="error" display="block">
                                  Marked non-returnable on stock
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Autocomplete
                                size="small"
                                options={vendorOptions}
                                getOptionLabel={(o) => o.vendorName || ''}
                                value={vendorOptions.find((v) => v.id === item.vendorId) || null}
                                onChange={(_, v) =>
                                  handleAssignVendor(item.medicineId, item.batchNumber, v)
                                }
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    placeholder="Select vendor"
                                    error={!item.vendorId}
                                  />
                                )}
                                isOptionEqualToValue={(a, b) => a.id === b.id}
                              />
                              <Box mt={0.5}>{sourceChip(item)}</Box>
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
                                onClick={() => handleRemove(item.medicineId, item.batchNumber)}
                                aria-label="Remove"
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ))
            )}
          </Paper>
        </Grid>
      </Grid>

      <Dialog
        open={qtyDialog.open}
        onClose={() =>
          setQtyDialog({
            open: false,
            option: null,
            quantity: '1',
            vendorId: '',
            resolution: null,
            showAllVendors: false,
          })
        }
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
              {qtyDialog.option.nonReturnable && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  This batch is marked non-returnable on stock.
                </Alert>
              )}
              <Autocomplete
                sx={{ mb: 2 }}
                options={dialogVendorOptions}
                getOptionLabel={(o) => o.vendorName || ''}
                value={
                  dialogVendorOptions.find((v) => v.id === qtyDialog.vendorId) ||
                  vendorOptions.find((v) => v.id === qtyDialog.vendorId) ||
                  null
                }
                onChange={(_, v) => setQtyDialog((d) => ({ ...d, vendorId: v?.id || '' }))}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Vendor"
                    placeholder={
                      qtyDialog.resolution?.status === 'ambiguous'
                        ? 'Pick vendor — multiple bills'
                        : 'Optional if unknown'
                    }
                    error={qtyDialog.resolution?.status === 'ambiguous' && !qtyDialog.vendorId}
                    helperText={sourceMatchLabel(
                      qtyDialog.resolution?.match,
                      qtyDialog.resolution?.status
                    )}
                  />
                )}
                isOptionEqualToValue={(a, b) => a.id === b.id}
              />
              {dialogVendorOptions.length > 0 &&
                !qtyDialog.showAllVendors &&
                (qtyDialog.resolution?.candidates.length ?? 0) > 0 &&
                vendorOptions.length > dialogVendorOptions.length && (
                  <Button
                    size="small"
                    sx={{ mb: 2 }}
                    onClick={() => setQtyDialog((d) => ({ ...d, showAllVendors: true }))}
                  >
                    Show all vendors
                  </Button>
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
          <Button
            onClick={() =>
              setQtyDialog({
                open: false,
                option: null,
                quantity: '1',
                vendorId: '',
                resolution: null,
                showAllVendors: false,
              })
            }
          >
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

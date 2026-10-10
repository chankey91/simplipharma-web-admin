import React, { useState, useRef, useEffect, startTransition } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Alert,
  Tooltip,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  CircularProgress,
} from '@mui/material';
import {
  Search,
  Visibility,
  Upload,
  Download,
  CloudSync,
  Inventory2,
  RestartAlt,
  Add,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { findMedicineByExactName, searchMedicinesCatalog } from '../services/medicineSearch';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { useCreateMedicine } from '../hooks/useInventory';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import * as XLSX from 'xlsx';
import { doc, setDoc, collection, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage, functions } from '../services/firebase';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppDialog } from '../context/AppDialogProvider';
import { zeroAllStockChunk } from '../services/inventory';

const emptyNewProduct = {
  name: '',
  code: '',
  type: '',
  packaging: '',
  manufacturer: '',
  gstRate: '5',
};

export const InventoryPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canWrite, panelRole } = useAuth();
  const { alert, confirm, prompt } = useAppDialog();
  const canEditInventory = canWrite('inventory');
  const canReindexInventory = panelRole === 'admin' || panelRole === 'operations';
  const canZeroAllStock = panelRole === 'admin';

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const { sortKey, sortDirection, requestSort } = useTableSort('name', 'asc');

  const [expiredCount, setExpiredCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bulkPhase, setBulkPhase] = useState<'idle' | 'uploading' | 'running' | 'done' | 'error'>('idle');
  const [jobStatusLine, setJobStatusLine] = useState('');
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [zeroing, setZeroing] = useState(false);
  const [zeroMessage, setZeroMessage] = useState<string | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyNewProduct);
  const createMedicineMutation = useCreateMedicine();
  const jobUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q != null && q.length > 0) setSearchTerm(q);
    const cat = searchParams.get('category');
    if (cat != null && cat.length > 0) setCategoryFilter(cat);
    const stock = searchParams.get('stockFilter');
    if (stock === 'Low' || stock === 'Out' || stock === 'In Stock' || stock === 'All') {
      setStockFilter(stock);
    }
  }, [searchParams]);

  // Typesense-only list — never loads ~800k Firestore masters into the browser.
  const typesenseSortKey =
    sortKey === 'stock' || sortKey === 'manufacturer' || sortKey === 'name' ? sortKey : 'name';

  const {
    medicines: pageRows,
    found,
    facet_counts,
    loading: searchLoading,
    error: searchError,
  } = useMedicineSearch(searchTerm, {
    browseWhenEmpty: true,
    // Typesense-only — productId/HSN come from the index after reindex (no per-page Firestore reads).
    hydrate: false,
    limit: rowsPerPage,
    page,
    // Trust Typesense page rows for the table (found count must match visible rows).
    refineResults: false,
    category: categoryFilter,
    manufacturer: manufacturerFilter,
    stockFilter,
    sortKey: searchTerm.trim().length >= 2 ? '_text_match' : typesenseSortKey,
    sortDirection,
    // Facets only needed for filter dropdowns while browsing — typed search matches PI path.
    includeFacets: searchTerm.trim().length < 2,
    debounceMs: searchTerm.trim().length >= 2 ? 350 : 50,
  });

  const categories = (facet_counts.category || []).map((c) => c.value).filter(Boolean);
  const manufacturers = (facet_counts.manufacturer || []).map((c) => c.value).filter(Boolean);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [expired, expiring] = await Promise.all([
        searchMedicinesCatalog('', {
          browse: true,
          hydrate: false,
          limit: 1,
          page: 1,
          expiryFilter: 'expired',
        }),
        searchMedicinesCatalog('', {
          browse: true,
          hydrate: false,
          limit: 1,
          page: 1,
          expiryFilter: 'expiring',
        }),
      ]);
      if (!cancelled) {
        setExpiredCount(expired.found);
        setExpiringCount(expiring.found);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopJobListener = () => {
    jobUnsubRef.current?.();
    jobUnsubRef.current = null;
  };

  useEffect(() => {
    return () => stopJobListener();
  }, []);

  useEffect(() => {
    if (bulkUploadOpen) {
      setBulkPhase('idle');
      setJobStatusLine('');
      setUploadError(null);
      stopJobListener();
    } else {
      stopJobListener();
    }
  }, [bulkUploadOpen]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(found / rowsPerPage));

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const getStockColor = (stock: number) => {
    if (stock === 0) return 'error';
    if (stock < 10) return 'warning';
    return 'success';
  };

  const handleReindexTypesense = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      // Short chunks (~90s / 12k docs). Long single callables often fail in the browser as functions/internal.
      const fn = httpsCallable(functions, 'adminReindexMedicinesTypesense', {
        timeout: 180000,
      });
      let startAfterId: string | null = null;
      let totalIndexed = 0;
      let totalScanned = 0;
      let chunk = 0;
      let synonymsUpserted = 0;

      for (;;) {
        chunk++;
        setReindexMessage(
          `Rebuilding search index… chunk ${chunk}` +
            (totalIndexed ? ` (${totalIndexed.toLocaleString()} indexed so far)` : '') +
            ' — keep this tab open.'
        );
        // First call: {} lets the server resume an in-progress job (survives UI "internal" drops).
        const payload = startAfterId ? { startAfterId } : {};
        const res = await fn(payload);
        const d = res.data as {
          indexed?: number;
          totalDocs?: number;
          scanned?: number;
          done?: boolean;
          nextStartAfterId?: string | null;
          cumulativeIndexed?: number;
          cumulativeScanned?: number;
          synonymsUpserted?: number;
        };
        totalIndexed = d.cumulativeIndexed ?? totalIndexed + (d.indexed ?? 0);
        totalScanned = d.cumulativeScanned ?? totalScanned + (d.scanned ?? d.totalDocs ?? 0);
        if (typeof d.synonymsUpserted === 'number') synonymsUpserted = d.synonymsUpserted;

        if (d.done) break;
        if (!d.nextStartAfterId) {
          throw new Error('Reindex chunk returned incomplete without a resume cursor');
        }
        startAfterId = d.nextStartAfterId;
      }

      setReindexMessage(
        `Search index updated: ${totalIndexed.toLocaleString()} documents indexed` +
          ` (${totalScanned.toLocaleString()} Firestore docs scanned, ${chunk} chunk${chunk === 1 ? '' : 's'}` +
          (synonymsUpserted ? `, ${synonymsUpserted} synonyms` : '') +
          ').'
      );
      setPage(1);
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string; details?: unknown };
      const msg = [err.code, err.message, err.details].filter(Boolean).join(' — ') || String(e);
      const hint =
        msg.toLowerCase().includes('internal') ||
        msg.toLowerCase().includes('deadline') ||
        msg.includes('DEADLINE') ||
        msg.toLowerCase().includes('timeout')
          ? ' Click Rebuild again — server saves a resume cursor, so it continues (does not start over).'
          : msg.toLowerCase().includes('not configured') || msg.includes('failed-precondition')
            ? ' Check Typesense host health and Functions config, then retry.'
            : ' Keep the tab open; each chunk is ~1–2 minutes.';
      setReindexMessage(`Search index rebuild failed: ${msg}.${hint}`);
    } finally {
      setReindexing(false);
    }
  };

  const handleZeroAllStock = async () => {
    const ok = await confirm(
      'This sets every batch quantity to 0. Batches are not deleted (batch number, expiry, MRP stay). Pending order fulfillment will see no stock until you enter physical qty on Update stock. Pause fulfilling first.',
      { title: 'Zero all stock?', confirmLabel: 'Continue', destructive: true }
    );
    if (!ok) return;
    const typed = await prompt('Type ZERO STOCK to confirm', {
      title: 'Confirm zero all stock',
      confirmLabel: 'Zero stock',
    });
    if (typed == null) return;
    if (typed.trim().toUpperCase() !== 'ZERO STOCK') {
      await alert('Stock was not changed. Confirmation text did not match.', { severity: 'info' });
      return;
    }

    setZeroing(true);
    setZeroMessage(null);
    try {
      let phase: 'batches' | 'medicines' = 'batches';
      let startAfterId: string | null = null;
      let batchesZeroed = 0;
      let medicinesUpdated = 0;
      let chunk = 0;
      for (;;) {
        chunk += 1;
        setZeroMessage(
          `Zeroing stock… ${phase} chunk ${chunk}` +
            (batchesZeroed ? ` (${batchesZeroed.toLocaleString()} batches set to 0)` : '') +
            ' — keep this tab open.'
        );
        const d = await zeroAllStockChunk({
          phase,
          startAfterId,
        });
        batchesZeroed += d.batchesZeroed ?? 0;
        medicinesUpdated += d.medicinesUpdated ?? 0;
        if (d.done) break;
        if (!d.nextStartAfterId && d.phase === phase) {
          throw new Error('Zero job returned incomplete without a resume cursor');
        }
        phase = d.phase;
        startAfterId = d.nextStartAfterId || null;
      }
      setZeroMessage(
        `All batch quantities are 0. ${batchesZeroed.toLocaleString()} batches updated, ${medicinesUpdated.toLocaleString()} medicines. Batches were not deleted. Use Update stock to enter physical qty, then Rebuild search index.`
      );
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      const msg = [err.code, err.message].filter(Boolean).join(' — ') || String(e);
      setZeroMessage(`Zero all stock failed: ${msg}. Click Zero all stock again to continue if a chunk timed out.`);
    } finally {
      setZeroing(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Medicine Name': 'Paracetamol 500mg',
        Code: 'PARA500',
        Type: 'Tablet',
        Packaging: 'Strip of 10',
        Manufacturer: 'ABC Pharma',
        'GST Rate (%)': 5,
        Description: 'Pain reliever',
      },
      {
        'Medicine Name': 'Amoxicillin 250mg',
        Code: 'AMOX250',
        Type: 'Capsule',
        Packaging: 'Bottle of 15',
        Manufacturer: 'XYZ Pharma',
        'GST Rate (%)': 5,
        Description: 'Antibiotic',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medicines');
    XLSX.writeFile(wb, 'medicine_bulk_upload_template.xlsx');
  };

  const closeAddProduct = () => {
    setAddProductOpen(false);
    setNewProduct(emptyNewProduct);
  };

  const handleAddProduct = async () => {
    const name = newProduct.name.trim();
    const code = newProduct.code.trim();
    const type = newProduct.type.trim();
    const packaging = newProduct.packaging.trim();
    const manufacturer = newProduct.manufacturer.trim();
    const gstRate = parseFloat(newProduct.gstRate);
    if (!name || !code || !type || !packaging || !manufacturer || !Number.isFinite(gstRate)) {
      await alert('Please fill all required fields', { severity: 'warning' });
      return;
    }
    try {
      const existing = await findMedicineByExactName(name);
      if (existing) {
        closeAddProduct();
        const openExisting = await confirm(
          `"${existing.name}" already exists in inventory. Open that product?`,
          { title: 'Product exists', confirmLabel: 'Open' }
        );
        if (openExisting) navigate(`/inventory/${existing.id}`);
        return;
      }
      const medicineId = await createMedicineMutation.mutateAsync({
        name,
        code,
        category: type,
        unit: packaging,
        manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        gstRate,
        description: `Packaging: ${packaging}`,
      });
      closeAddProduct();
      await alert('Product added to inventory. Add stock from the Purchase invoices section.', {
        severity: 'success',
      });
      navigate(`/inventory/${medicineId}`);
    } catch (err: unknown) {
      await alert(err instanceof Error ? err.message : 'Failed to add product', {
        severity: 'error',
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setBulkPhase('uploading');
    setJobStatusLine('');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('You must be signed in to upload.');

      const data = await file.arrayBuffer();
      setJobStatusLine('Uploading file to cloud storage…');
      const jobRef = doc(collection(db, 'bulk_medicine_jobs'));
      const jobId = jobRef.id;
      const storagePath = `bulk_medicine_uploads/${user.uid}/${jobId}.xlsx`;
      const fileRef = storageRef(storage, storagePath);
      const contentType =
        file.type ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await uploadBytes(fileRef, new Uint8Array(data), { contentType });

      const notifyEmail = String(user.email || '').trim();
      if (!notifyEmail) {
        throw new Error(
          'Your account has no email address. Add an email to your Firebase user to receive completion notifications.'
        );
      }

      await setDoc(jobRef, {
        status: 'queued',
        storagePath,
        notifyEmail,
        createdBy: user.uid,
        fileName: file.name,
        createdAt: serverTimestamp(),
      });

      setBulkPhase('running');
      setJobStatusLine('Job queued — processing on the server (up to several minutes for large files)…');

      stopJobListener();
      jobUnsubRef.current = onSnapshot(jobRef, (snap) => {
        const d = snap.data() as Record<string, unknown> | undefined;
        if (!d) return;
        const st = String(d.status || '');
        if (d.progressNote) {
          setJobStatusLine(String(d.progressNote));
        } else if (st === 'processing') {
          setJobStatusLine('Server is importing medicines…');
        }
        if (st === 'completed') {
          const c = Number(d.createCount ?? 0);
          const u = Number(d.updateCount ?? 0);
          const f = Number(d.failCount ?? 0);
          setBulkPhase('done');
          setJobStatusLine(
            `Import finished: ${c} created, ${u} updated, ${f} row failures. Check your email (${notifyEmail}) for the full report.`
          );
          void queryClient.invalidateQueries({ queryKey: ['medicines'] });
          setPage(1);
          stopJobListener();
        }
        if (st === 'failed') {
          setBulkPhase('error');
          setJobStatusLine(String(d.errorMessage || 'Import failed'));
          void queryClient.invalidateQueries({ queryKey: ['medicines'] });
          stopJobListener();
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start bulk import';
      setUploadError(message);
      setBulkPhase('error');
      setJobStatusLine('');
    }

    const fileInput = document.getElementById('bulk-upload-file') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  if (searchLoading && pageRows.length === 0 && searchTerm.trim().length === 0 && found === 0) {
    return <Loading message="Loading inventory..." />;
  }

  const searchHint =
    searchTerm.trim().length === 0
      ? `${found.toLocaleString()} in catalog`
      : searchTerm.trim().length < 2
        ? 'Type one more character…'
        : searchLoading
          ? 'Searching…'
          : `${found.toLocaleString()} result${found === 1 ? '' : 's'}`;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 0.5 }}>
          Inventory
        </Typography>
        {expiredCount > 0 && (
          <Chip size="small" color="error" label={`${expiredCount} expired`} />
        )}
        {expiringCount > 0 && (
          <Chip size="small" color="warning" label={`${expiringCount} expiring`} />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {canEditInventory && (
          <>
            <Button
              size="small"
              variant="contained"
              startIcon={<Add fontSize="small" />}
              onClick={() => setAddProductOpen(true)}
            >
              Add product
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Inventory2 fontSize="small" />}
              onClick={() => navigate('/inventory/stock-update')}
            >
              Update stock
            </Button>
          </>
        )}
        {canZeroAllStock && (
          <Tooltip title={zeroing ? 'Zeroing…' : 'Zero all stock'}>
            <span>
              <IconButton
                size="small"
                color="error"
                onClick={() => void handleZeroAllStock()}
                disabled={zeroing}
                aria-label="Zero all stock"
              >
                <RestartAlt fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title="Download template">
          <IconButton size="small" onClick={handleDownloadTemplate} aria-label="Download template">
            <Download fontSize="small" />
          </IconButton>
        </Tooltip>
        {canReindexInventory && (
          <Tooltip title={reindexing ? 'Indexing…' : 'Rebuild search index'}>
            <span>
              <IconButton
                size="small"
                color="secondary"
                onClick={() => void handleReindexTypesense()}
                disabled={reindexing}
                aria-label="Rebuild search index"
              >
                <CloudSync fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {canEditInventory && (
          <Tooltip title="Bulk upload medicines">
            <IconButton size="small" onClick={() => setBulkUploadOpen(true)} aria-label="Bulk upload medicines">
              <Upload fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {zeroMessage && (
        <Alert
          severity={zeroMessage.startsWith('All batch') ? 'success' : zeroMessage.startsWith('Zeroing') ? 'info' : 'error'}
          onClose={zeroing ? undefined : () => setZeroMessage(null)}
          sx={{ mb: 1 }}
        >
          {zeroMessage}
        </Alert>
      )}

      {reindexMessage && (
        <Alert
          severity={reindexMessage.startsWith('Search index updated') ? 'success' : 'error'}
          onClose={() => setReindexMessage(null)}
          sx={{ mb: 1 }}
        >
          {reindexMessage}
        </Alert>
      )}

      {searchError && !searchLoading && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Inventory search failed (Typesense). The list is empty because the catalog search
          index could not be queried — this is not a Firestore inventory wipe. Open the browser
          console for details, then click <strong>Rebuild search index</strong>. If rebuild
          fails with &quot;not configured&quot;, Typesense host/API key on Cloud Functions need
          fixing.
        </Alert>
      )}

      {!searchError && !searchLoading && found === 0 && searchTerm.trim().length < 2 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Typesense returned 0 medicines. If Firestore still has medicines, click{' '}
          <strong>Rebuild search index</strong> and keep this tab open until it finishes.
        </Alert>
      )}

      <Paper sx={{ px: 1.5, py: 1, mb: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search name, product ID, code, or manufacturer…"
            value={searchTerm}
            onChange={(e) => {
              const next = e.target.value;
              setSearchTerm(next);
              startTransition(() => setPage(1));
            }}
            sx={{ minWidth: 220, flex: '1 1 200px' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchLoading ? (
                <InputAdornment position="end">
                  <CircularProgress color="inherit" size={18} />
                </InputAdornment>
              ) : undefined,
            }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={categoryFilter}
              label="Type"
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="All">All types</MenuItem>
              {categories.map((cat) => (
                <MenuItem key={cat} value={cat}>
                  {cat}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Manufacturer</InputLabel>
            <Select
              value={manufacturerFilter}
              label="Manufacturer"
              onChange={(e) => {
                setManufacturerFilter(e.target.value);
                setPage(1);
              }}
              MenuProps={{ PaperProps: { style: { maxHeight: 320 } } }}
            >
              <MenuItem value="All">All manufacturers</MenuItem>
              {manufacturers.map((mf) => (
                <MenuItem key={mf} value={mf}>
                  {mf}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Stock</InputLabel>
            <Select
              value={stockFilter}
              label="Stock"
              onChange={(e) => {
                setStockFilter(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="All">All stock</MenuItem>
              <MenuItem value="In Stock">In stock</MenuItem>
              <MenuItem value="Low">Low stock</MenuItem>
              <MenuItem value="Out">Out of stock</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {searchHint}
          </Typography>
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="name" label="Medicine Details" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell>Product ID</TableCell>
              <SortableTableHeadCell columnId="type" label="Type" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="packaging" label="Packaging" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="manufacturer" label="Manufacturer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="gst" label="GST Rate" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="stock" label="Stock" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>
                    {searchLoading ? 'Loading…' : 'No medicines found'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((medicine) => (
                <TableRow
                  key={medicine.id}
                  hover
                  onClick={() => navigate(`/inventory/${medicine.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">
                      {medicine.name}
                    </Typography>
                    {medicine.code ? (
                      <Typography variant="caption" color="textSecondary">
                        HSN {medicine.code}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {medicine.productId || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>{medicine.category}</TableCell>
                  <TableCell>{medicine.unit || 'N/A'}</TableCell>
                  <TableCell>{medicine.manufacturer}</TableCell>
                  <TableCell align="right">
                    <Chip
                      label={`${medicine.gstRate || 5}%`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Chip
                      label={medicine.currentStock ?? medicine.stock ?? 0}
                      size="small"
                      color={
                        getStockColor(medicine.currentStock ?? medicine.stock ?? 0) as
                          | 'error'
                          | 'warning'
                          | 'success'
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/inventory/${medicine.id}`);
                      }}
                    >
                      <Visibility />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {found > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={Math.min(page, totalPages)}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, found)} of{' '}
            {found.toLocaleString()} medicines
          </Typography>
        </Box>
      )}

      <Dialog
        open={addProductOpen}
        onClose={() => !createMedicineMutation.isPending && closeAddProduct()}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add product</DialogTitle>
        <DialogContent>
          <Box display="flex" flexWrap="wrap" gap={1.5} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              size="small"
              label="Medicine name"
              required
              value={newProduct.name}
              onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
            />
            <TextField
              size="small"
              label="HSN / item code"
              required
              value={newProduct.code}
              onChange={(e) => setNewProduct({ ...newProduct, code: e.target.value })}
              sx={{ flex: '1 1 180px' }}
            />
            <TextField
              size="small"
              label="Type"
              required
              placeholder="Tablet, Syrup…"
              value={newProduct.type}
              onChange={(e) => setNewProduct({ ...newProduct, type: e.target.value })}
              sx={{ flex: '1 1 160px' }}
            />
            <TextField
              size="small"
              label="Packaging"
              required
              placeholder="e.g., 10 Tab, 100 ml"
              value={newProduct.packaging}
              onChange={(e) => setNewProduct({ ...newProduct, packaging: e.target.value })}
              sx={{ flex: '1 1 180px' }}
            />
            <TextField
              size="small"
              label="Manufacturer"
              required
              value={newProduct.manufacturer}
              onChange={(e) => setNewProduct({ ...newProduct, manufacturer: e.target.value })}
              sx={{ flex: '1 1 180px' }}
            />
            <TextField
              size="small"
              label="GST rate (%)"
              required
              type="number"
              value={newProduct.gstRate}
              onChange={(e) => setNewProduct({ ...newProduct, gstRate: e.target.value })}
              inputProps={{ min: 0, max: 100, step: 0.01 }}
              sx={{ width: 140 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddProduct} disabled={createMedicineMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleAddProduct()}
            disabled={createMedicineMutation.isPending}
          >
            {createMedicineMutation.isPending ? 'Saving…' : 'Add product'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={bulkUploadOpen}
        onClose={() => bulkPhase !== 'uploading' && setBulkUploadOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Bulk upload medicines (async)</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {uploadError && (
              <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                {uploadError}
              </Alert>
            )}
            {jobStatusLine && (
              <Alert
                severity={
                  bulkPhase === 'error' ? 'error' : bulkPhase === 'done' ? 'success' : 'info'
                }
                sx={{ mb: 2 }}
              >
                {jobStatusLine}
              </Alert>
            )}
            {(bulkPhase === 'uploading' || bulkPhase === 'running') && (
              <LinearProgress sx={{ mb: 2 }} />
            )}
            <Typography variant="body2" color="textSecondary" paragraph>
              The Excel file is uploaded to secure storage and processed by a Cloud Function on the server.
              You can close this dialog; the import continues in the background. When it finishes, you will
              receive an email at your signed-in admin address (SMTP must be configured on Firebase Functions).
            </Typography>
            <input
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              id="bulk-upload-file"
              type="file"
              onChange={handleFileUpload}
              disabled={bulkPhase === 'uploading' || bulkPhase === 'running'}
            />
            <label htmlFor="bulk-upload-file">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<Upload />}
                disabled={bulkPhase === 'uploading' || bulkPhase === 'running'}
              >
                {bulkPhase === 'uploading' ? 'Uploading…' : 'Select Excel file'}
              </Button>
            </label>
            <Typography variant="caption" color="textSecondary" sx={{ mt: 2, display: 'block' }}>
              Required columns: Medicine Name, Type, Packaging, Manufacturer, GST Rate (%)
              <br />
              Optional columns: Code, Description
              <br />
              Same as before: matching by name (case-insensitive) updates existing rows; stock is not changed
              from the sheet.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setBulkUploadOpen(false);
              const fileInput = document.getElementById('bulk-upload-file') as HTMLInputElement;
              if (fileInput) fileInput.value = '';
            }}
            disabled={bulkPhase === 'uploading'}
          >
            {bulkPhase === 'done' || bulkPhase === 'error' ? 'Close' : 'Close (job continues)'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

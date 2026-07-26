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
  Grid,
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
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { searchMedicinesCatalog } from '../services/medicineSearch';
import { useMedicineSearch } from '../hooks/useMedicineSearch';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import * as XLSX from 'xlsx';
import { doc, setDoc, collection, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage, functions } from '../services/firebase';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useSearchParams } from 'react-router-dom';

export const InventoryPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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
  } = useMedicineSearch(searchTerm, {
    browseWhenEmpty: true,
    // Typesense-only — productId/HSN come from the index after reindex (no per-page Firestore reads).
    hydrate: false,
    limit: rowsPerPage,
    page,
    strict: true,
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
      // Gen1 functions hard-timeout at 540s; loop chunks until the catalog is fully indexed.
      const fn = httpsCallable(functions, 'adminReindexMedicinesTypesense', {
        timeout: 560000,
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
        const res = await fn(startAfterId ? { startAfterId } : {});
        const d = res.data as {
          indexed?: number;
          totalDocs?: number;
          scanned?: number;
          done?: boolean;
          nextStartAfterId?: string | null;
          synonymsUpserted?: number;
        };
        totalIndexed += d.indexed ?? 0;
        totalScanned += d.scanned ?? d.totalDocs ?? 0;
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
        msg.toLowerCase().includes('deadline') || msg.includes('DEADLINE') || msg.toLowerCase().includes('timeout')
          ? ' Cloud Function hit its time limit mid-catalog — click Rebuild again; progress in Typesense is kept (upsert). Or wait for the chunked rebuild deploy and retry.'
          : msg.toLowerCase().includes('not configured') || msg.includes('failed-precondition')
            ? ' Check Typesense host health and Functions config, then retry.'
            : ' Keep the tab open; large catalogs need several chunks (~8 min each).';
      setReindexMessage(`Search index rebuild failed: ${msg}.${hint}`);
    } finally {
      setReindexing(false);
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

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Inventory Management</Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={handleDownloadTemplate}
            sx={{ mr: 2 }}
          >
            Download Template
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<CloudSync />}
            onClick={() => void handleReindexTypesense()}
            disabled={reindexing}
            sx={{ mr: 2 }}
          >
            {reindexing ? 'Indexing…' : 'Rebuild search index'}
          </Button>
          <Button
            variant="contained"
            startIcon={<Upload />}
            onClick={() => setBulkUploadOpen(true)}
          >
            Bulk Upload Medicines
          </Button>
        </Box>
      </Box>

      {reindexMessage && (
        <Alert
          severity={reindexMessage.startsWith('Search index updated') ? 'success' : 'error'}
          onClose={() => setReindexMessage(null)}
          sx={{ mb: 2 }}
        >
          {reindexMessage}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {expiredCount > 0 && (
          <Grid item xs={12}>
            <Alert severity="error">{expiredCount} items have expired!</Alert>
          </Grid>
        )}
        {expiringCount > 0 && (
          <Grid item xs={12}>
            <Alert severity="warning">{expiringCount} items expiring within 30 days.</Alert>
          </Grid>
        )}
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search by name, product ID, code, or manufacturer..."
              value={searchTerm}
              onChange={(e) => {
                const next = e.target.value;
                setSearchTerm(next);
                startTransition(() => setPage(1));
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: searchLoading ? (
                  <InputAdornment position="end">
                    <CircularProgress color="inherit" size={18} />
                  </InputAdornment>
                ) : undefined,
              }}
              helperText={
                searchTerm.trim().length === 0
                  ? `Browsing catalog via Typesense (${found.toLocaleString()} total)`
                  : searchTerm.trim().length < 2
                    ? 'Type one more character…'
                    : searchLoading
                      ? 'Searching…'
                      : `${found.toLocaleString()} result${found === 1 ? '' : 's'}`
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={categoryFilter}
                label="Type"
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Types</MenuItem>
                {categories.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
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
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Stock Status</InputLabel>
              <Select
                value={stockFilter}
                label="Stock Status"
                onChange={(e) => {
                  setStockFilter(e.target.value);
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Stock</MenuItem>
                <MenuItem value="In Stock">In Stock</MenuItem>
                <MenuItem value="Low">Low Stock</MenuItem>
                <MenuItem value="Out">Out of Stock</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
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

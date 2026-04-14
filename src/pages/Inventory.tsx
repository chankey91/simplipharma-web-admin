import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Card,
  CardContent,
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
} from '@mui/material';
import {
  Search,
  Visibility,
  Upload,
  Download,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import { useMedicines, useExpiringMedicines, useExpiredMedicines } from '../hooks/useInventory';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { categoriesMatch } from '../utils/categoryMatch';
import { Loading } from '../components/Loading';
import * as XLSX from 'xlsx';
import { doc, setDoc, collection, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../services/firebase';

export const InventoryPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: medicines, isLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<string>('All');

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
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Client upload + server job lifecycle */
  const [bulkPhase, setBulkPhase] = useState<'idle' | 'uploading' | 'running' | 'done' | 'error'>('idle');
  const [jobStatusLine, setJobStatusLine] = useState('');
  const jobUnsubRef = useRef<(() => void) | null>(null);

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

  const categories = Array.from(new Set(medicines?.map(m => m.category).filter(Boolean) || []));

  useEffect(() => {
    if (categoryFilter === 'All' || !medicines?.length) return;
    const list = Array.from(new Set(medicines.map((m) => m.category).filter(Boolean))) as string[];
    if (list.some((c) => c === categoryFilter)) return;
    const canon = list.find((c) => categoriesMatch(c, categoryFilter));
    if (canon) setCategoryFilter(canon);
  }, [medicines, categoryFilter]);

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    medicines?.forEach((m) => {
      const mf = String(m.manufacturer || m.company || '').trim();
      if (mf) set.add(mf);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [medicines]);

  const filteredMedicines = medicines?.filter(medicine => {
    const name = String(medicine.name || '').toLowerCase();
    const code = String(medicine.code || '').toLowerCase();
    const manufacturerLower = String(medicine.manufacturer || '').toLowerCase();
    const search = searchTerm.toLowerCase();

    const matchesSearch =
      name.includes(search) ||
      code.includes(search) ||
      manufacturerLower.includes(search);
    
    const matchesCategory =
      categoryFilter === 'All' || categoriesMatch(medicine.category, categoryFilter);

    const mfLabel = String(medicine.manufacturer || medicine.company || '').trim();
    const matchesManufacturer =
      manufacturerFilter === 'All' || mfLabel === manufacturerFilter;
    
    const currentStock = medicine.currentStock ?? medicine.stock ?? 0;
    const matchesStock =
      stockFilter === 'All' ||
      (stockFilter === 'Low' && currentStock < 10 && currentStock > 0) ||
      (stockFilter === 'Out' && currentStock === 0) ||
      (stockFilter === 'In Stock' && currentStock > 0);
    
    return matchesSearch && matchesCategory && matchesManufacturer && matchesStock;
  }) || [];

  // Pagination
  const totalPages = Math.ceil(filteredMedicines.length / rowsPerPage);
  const paginatedMedicines = filteredMedicines.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const getStockColor = (stock: number) => {
    if (stock === 0) return 'error';
    if (stock < 10) return 'warning';
    return 'success';
  };

  const handleDownloadTemplate = () => {
    // Create sample data for template
    const templateData = [
      {
        'Medicine Name': 'Paracetamol 500mg',
        'Code': 'PARA500',
        'Type': 'Tablet',
        'Packaging': 'Strip of 10',
        'Manufacturer': 'ABC Pharma',
        'GST Rate (%)': 5,
        'Description': 'Pain reliever'
      },
      {
        'Medicine Name': 'Amoxicillin 250mg',
        'Code': 'AMOX250',
        'Type': 'Capsule',
        'Packaging': 'Bottle of 15',
        'Manufacturer': 'XYZ Pharma',
        'GST Rate (%)': 5,
        'Description': 'Antibiotic'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medicines');
    XLSX.writeFile(wb, 'medicine_bulk_upload_template.xlsx');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const user = auth.currentUser;
    if (!user) {
      setUploadError('You must be signed in to run a bulk import.');
      return;
    }

    setUploadError(null);
    setBulkPhase('uploading');
    setJobStatusLine('Reading and validating Excel…');

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        throw new Error('Excel file is empty. Please add medicine data.');
      }

      let validPreview = 0;
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i] as Record<string, unknown>;
        if (row['Medicine Name'] && row['Manufacturer'] && row['Type'] && row['Packaging']) {
          validPreview++;
        }
      }
      if (validPreview === 0) {
        throw new Error(
          'No valid rows found. Required columns: Medicine Name, Type, Packaging, Manufacturer.'
        );
      }

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

  if (isLoading) return <Loading message="Loading inventory..." />;

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
            variant="contained"
            startIcon={<Upload />}
            onClick={() => setBulkUploadOpen(true)}
          >
            Bulk Upload Medicines
          </Button>
        </Box>
      </Box>

      {/* Alerts */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {expiredMedicines && expiredMedicines.length > 0 && (
          <Grid item xs={12}>
            <Alert severity="error">{expiredMedicines.length} items have expired!</Alert>
          </Grid>
        )}
        {expiringMedicines && expiringMedicines.length > 0 && (
          <Grid item xs={12}>
            <Alert severity="warning">{expiringMedicines.length} items expiring within 30 days.</Alert>
          </Grid>
        )}
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search by name, code, or manufacturer..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
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
                {categories.map(cat => (
                  <MenuItem key={cat} value={cat}>{cat}</MenuItem>
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

      {/* Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Medicine Details</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Packaging</TableCell>
              <TableCell>Manufacturer</TableCell>
              <TableCell align="right">GST Rate</TableCell>
              <TableCell align="right">Stock</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedMedicines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No medicines found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedMedicines.map((medicine) => (
              <TableRow key={medicine.id} hover onClick={() => navigate(`/inventory/${medicine.id}`)} sx={{ cursor: 'pointer' }}>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">{medicine.name}</Typography>
                  <Typography variant="caption" color="textSecondary">{medicine.code || 'No code'}</Typography>
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
                    color={getStockColor(medicine.currentStock ?? medicine.stock ?? 0) as any}
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); navigate(`/inventory/${medicine.id}`); }}>
                    <Visibility />
                  </IconButton>
                </TableCell>
              </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {filteredMedicines.length > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, filteredMedicines.length)} of {filteredMedicines.length} medicines
          </Typography>
        </Box>
      )}

      {/* Bulk Upload Dialog */}
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

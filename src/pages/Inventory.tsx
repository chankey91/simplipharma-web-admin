import React, { useState } from 'react';
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
import { useMedicines, useExpiringMedicines, useExpiredMedicines, useCreateMedicine, useUpdateMedicine } from '../hooks/useInventory';
import { Medicine } from '../types';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import * as XLSX from 'xlsx';

export const InventoryPage: React.FC = () => {
  const { data: medicines, isLoading } = useMedicines();
  const { data: expiringMedicines } = useExpiringMedicines(30);
  const { data: expiredMedicines } = useExpiredMedicines();
  const createMedicineMutation = useCreateMedicine();
  const updateMedicineMutation = useUpdateMedicine();
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const categories = Array.from(new Set(medicines?.map(m => m.category).filter(Boolean) || []));

  const filteredMedicines = medicines?.filter(medicine => {
    const name = String(medicine.name || '').toLowerCase();
    const code = String(medicine.code || '').toLowerCase();
    const manufacturer = String(medicine.manufacturer || '').toLowerCase();
    const search = searchTerm.toLowerCase();

    const matchesSearch = name.includes(search) || code.includes(search) || manufacturer.includes(search);
    
    const matchesCategory = categoryFilter === 'All' || medicine.category === categoryFilter;
    
    const currentStock = medicine.currentStock ?? medicine.stock ?? 0;
    const matchesStock =
      stockFilter === 'All' ||
      (stockFilter === 'Low' && currentStock < 10 && currentStock > 0) ||
      (stockFilter === 'Out' && currentStock === 0) ||
      (stockFilter === 'In Stock' && currentStock > 0);
    
    return matchesSearch && matchesCategory && matchesStock;
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

    setUploadError(null);
    setUploadStatus('Reading Excel file...');
    setUploadProgress(10);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        throw new Error('Excel file is empty. Please add medicine data.');
      }

      setUploadStatus(`Processing ${jsonData.length} medicines...`);
      setUploadProgress(30);

      const medicinesToUpload: Omit<Medicine, 'id'>[] = [];
      const errors: string[] = [];

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i] as any;
        const rowNum = i + 2; // +2 because Excel is 1-indexed and has header

        try {
          // Validate required fields
          if (!row['Medicine Name']) {
            errors.push(`Row ${rowNum}: Medicine Name is required`);
            continue;
          }
          if (!row['Manufacturer']) {
            errors.push(`Row ${rowNum}: Manufacturer is required`);
            continue;
          }
          if (!row['Type']) {
            errors.push(`Row ${rowNum}: Type is required`);
            continue;
          }
          if (!row['Packaging']) {
            errors.push(`Row ${rowNum}: Packaging is required`);
            continue;
          }

          const medicine: Omit<Medicine, 'id'> = {
            name: String(row['Medicine Name'] || '').trim(),
            code: row['Code'] ? String(row['Code']).trim() : undefined,
            category: String(row['Type'] || '').trim(), // Type maps to category
            unit: String(row['Packaging'] || '').trim(), // Packaging maps to unit
            manufacturer: String(row['Manufacturer'] || '').trim(),
            stock: 0, // Default to 0, stock should not come from Excel
            currentStock: 0, // Default to 0
            price: 0, // Default price, not from Excel
            gstRate: row['GST Rate (%)'] ? parseFloat(String(row['GST Rate (%)'])) : 5,
            description: row['Description'] ? String(row['Description']).trim() : undefined,
          };

          medicinesToUpload.push(medicine);
        } catch (error: any) {
          errors.push(`Row ${rowNum}: ${error.message || 'Invalid data'}`);
        }

        setUploadProgress(30 + (i / jsonData.length) * 50);
      }

      if (errors.length > 0) {
        setUploadError(`Found ${errors.length} error(s):\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n... and ${errors.length - 10} more` : ''}`);
      }

      if (medicinesToUpload.length === 0) {
        throw new Error('No valid medicines found in the file.');
      }

      setUploadStatus(`Processing ${medicinesToUpload.length} medicines (checking for duplicates)...`);
      setUploadProgress(80);

      // Process medicines - check for duplicates by name and update or create
      let successCount = 0;
      let updateCount = 0;
      let createCount = 0;
      let failCount = 0;

      for (let i = 0; i < medicinesToUpload.length; i++) {
        try {
          const medicineToUpload = medicinesToUpload[i];
          
          // Check if medicine with same name exists in database (case-insensitive)
          const existingMedicine = medicines?.find(
            m => m.name.toLowerCase().trim() === medicineToUpload.name.toLowerCase().trim()
          );
          
          if (existingMedicine) {
            // Update existing medicine - overwrite all fields except stock
            await updateMedicineMutation.mutateAsync({
              medicineId: existingMedicine.id,
              updates: {
                name: medicineToUpload.name,
                code: medicineToUpload.code,
                category: medicineToUpload.category,
                unit: medicineToUpload.unit,
                manufacturer: medicineToUpload.manufacturer,
                gstRate: medicineToUpload.gstRate,
                description: medicineToUpload.description,
                // Stock is not updated from Excel upload
              }
            });
            
            updateCount++;
            successCount++;
            console.log(`Updated existing medicine: ${medicineToUpload.name}`);
          } else {
            // Create new medicine
            await createMedicineMutation.mutateAsync(medicineToUpload);
            createCount++;
            successCount++;
            console.log(`Created new medicine: ${medicineToUpload.name}`);
          }
        } catch (error: any) {
          failCount++;
          console.error(`Failed to process medicine ${medicinesToUpload[i].name}:`, error);
          errors.push(`Failed to process ${medicinesToUpload[i].name}: ${error.message || 'Unknown error'}`);
        }
        setUploadProgress(80 + ((i + 1) / medicinesToUpload.length) * 20);
      }

      setUploadStatus(`Upload complete! ${successCount} processed (${createCount} created, ${updateCount} updated), ${failCount} failed.`);
      setUploadProgress(100);

      if (errors.length > 0 && failCount > 0) {
        setUploadError(`Found ${errors.length} error(s):\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n... and ${errors.length - 10} more` : ''}`);
      }

      setTimeout(() => {
        setBulkUploadOpen(false);
        setUploadProgress(0);
        setUploadStatus('');
        setUploadError(null);
        // Reset file input
        const fileInput = document.getElementById('bulk-upload-file') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      }, 2000);
    } catch (error: any) {
      setUploadError(error.message || 'Failed to process Excel file');
      setUploadStatus('');
      setUploadProgress(0);
    }
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
          <Grid item xs={12} md={3}>
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
          <Grid item xs={12} md={3}>
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
      <Dialog open={bulkUploadOpen} onClose={() => !uploadProgress && setBulkUploadOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk Upload Medicines</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {uploadError && (
              <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                {uploadError}
              </Alert>
            )}
            {uploadStatus && (
              <Alert severity={uploadProgress === 100 ? 'success' : 'info'} sx={{ mb: 2 }}>
                {uploadStatus}
              </Alert>
            )}
            {uploadProgress > 0 && uploadProgress < 100 && (
              <LinearProgress variant="determinate" value={uploadProgress} sx={{ mb: 2 }} />
            )}
            <Typography variant="body2" color="textSecondary" paragraph>
              Upload an Excel file (.xlsx) with medicine data. Download the template to see the required format.
            </Typography>
            <input
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              id="bulk-upload-file"
              type="file"
              onChange={handleFileUpload}
              disabled={uploadProgress > 0 && uploadProgress < 100}
            />
            <label htmlFor="bulk-upload-file">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<Upload />}
                disabled={uploadProgress > 0 && uploadProgress < 100}
              >
                {uploadProgress > 0 ? 'Uploading...' : 'Select Excel File'}
              </Button>
            </label>
            <Typography variant="caption" color="textSecondary" sx={{ mt: 2, display: 'block' }}>
              Required columns: Medicine Name, Type, Packaging, Manufacturer, GST Rate (%)
              <br />
              Optional columns: Code, Description
              <br />
              Note: Medicines with the same name will be updated (not duplicated)
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            if (uploadProgress === 0 || uploadProgress === 100) {
              setBulkUploadOpen(false);
              setUploadProgress(0);
              setUploadStatus('');
              setUploadError(null);
              // Reset file input
              const fileInput = document.getElementById('bulk-upload-file') as HTMLInputElement;
              if (fileInput) fileInput.value = '';
            }
          }} disabled={uploadProgress > 0 && uploadProgress < 100}>
            {uploadProgress === 100 ? 'Close' : 'Cancel'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

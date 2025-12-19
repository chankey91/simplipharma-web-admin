import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Alert,
  Card,
  CardContent,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
} from '@mui/material';
import {
  QrCodeScanner,
  Save,
  Search,
} from '@mui/icons-material';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useMedicines, useUpdateStock, useAddStockBatch, useFindMedicineByBarcode } from '../hooks/useInventory';
import { Medicine } from '../types';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { format } from 'date-fns';

export const StockUpdatePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const medicineIdFromUrl = searchParams.get('medicineId');
  
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const updateStock = useUpdateStock();
  const addBatch = useAddStockBatch();
  const findMedicine = useFindMedicineByBarcode();
  
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [stockData, setStockData] = useState({
    quantity: '',
    batchNumber: '',
    mfgDate: '',
    expiryDate: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    purchasePrice: '',
    mrp: '',
  });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (medicineIdFromUrl && medicines) {
      const medicine = medicines.find(m => m.id === medicineIdFromUrl);
      if (medicine) {
        setSelectedMedicine(medicine);
      }
    }
  }, [medicineIdFromUrl, medicines]);

  const handleBarcodeScan = async (barcode: string) => {
    setBarcodeInput(barcode);
    setError(null);
    try {
      const result = await findMedicine.mutateAsync(barcode);
      if (result) {
        setSelectedMedicine(result);
        setSuccess('Medicine found!');
      } else {
        const medicine = medicines?.find(m => m.barcode === barcode || m.code === barcode);
        if (medicine) {
          setSelectedMedicine(medicine);
          setSuccess('Medicine found!');
        } else {
          setError('Medicine not found with this barcode');
        }
      }
    } catch (error) {
      setError('Error searching for medicine');
    }
  };

  const handleSave = async () => {
    if (!selectedMedicine) {
      setError('Please select a medicine');
      return;
    }
    if (!stockData.quantity || !stockData.batchNumber || !stockData.expiryDate) {
      setError('Please fill all required fields (Quantity, Batch Number, Expiry Date)');
      return;
    }

    try {
      await addBatch.mutateAsync({
        medicineId: selectedMedicine.id,
        batch: {
          batchNumber: stockData.batchNumber,
          quantity: parseInt(stockData.quantity),
          mfgDate: stockData.mfgDate ? new Date(stockData.mfgDate) : undefined,
          expiryDate: new Date(stockData.expiryDate),
          purchaseDate: stockData.purchaseDate ? new Date(stockData.purchaseDate) : new Date(),
          purchasePrice: stockData.purchasePrice ? parseFloat(stockData.purchasePrice) : undefined,
          mrp: stockData.mrp ? parseFloat(stockData.mrp) : undefined,
        },
      });

      setStockData({
        quantity: '',
        batchNumber: '',
        mfgDate: '',
        expiryDate: '',
        purchaseDate: new Date().toISOString().split('T')[0],
        purchasePrice: '',
        mrp: '',
      });
      setSuccess('Stock updated successfully!');
      
      // Update the main medicine data as well (latest batch info)
      await updateStock.mutateAsync({
        medicineId: selectedMedicine.id,
        updates: {
          expiryDate: new Date(stockData.expiryDate),
          batchNumber: stockData.batchNumber,
          mrp: stockData.mrp ? parseFloat(stockData.mrp) : selectedMedicine.mrp,
        }
      });

    } catch (error: any) {
      setError(error.message || 'Failed to update stock');
    }
  };

  if (medicinesLoading) return <Loading message="Loading medicines..." />;

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={3}>
        <Typography variant="h4">Update Stock Inventory</Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Find Medicine</Typography>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<QrCodeScanner />}
              onClick={() => setScannerOpen(true)}
              sx={{ mb: 2 }}
            >
              Scan Barcode
            </Button>
            <TextField
              fullWidth
              label="Enter Barcode/Code"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleBarcodeScan(barcodeInput)}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: (
                  <IconButton onClick={() => handleBarcodeScan(barcodeInput)}>
                    <Search />
                  </IconButton>
                ),
              }}
            />
            <FormControl fullWidth>
              <InputLabel>Or Select Medicine</InputLabel>
              <Select
                value={selectedMedicine?.id || ''}
                label="Or Select Medicine"
                onChange={(e) => setSelectedMedicine(medicines?.find(m => m.id === e.target.value) || null)}
              >
                {medicines?.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {selectedMedicine && (
              <Card sx={{ mt: 3, bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
                <CardContent>
                  <Typography variant="subtitle2" color="primary">Current Info</Typography>
                  <Typography variant="h6">{selectedMedicine.name}</Typography>
                  <Typography variant="body2">Current Stock: {selectedMedicine.currentStock ?? selectedMedicine.stock ?? 0}</Typography>
                  <Typography variant="body2">Category: {selectedMedicine.category}</Typography>
                </CardContent>
              </Card>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Add New Stock Batch</Typography>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Batch Number"
                  required
                  value={stockData.batchNumber}
                  onChange={(e) => setStockData({ ...stockData, batchNumber: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Quantity Received"
                  type="number"
                  required
                  value={stockData.quantity}
                  onChange={(e) => setStockData({ ...stockData, quantity: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Manufacturing Date (MFG)"
                  type="date"
                  value={stockData.mfgDate}
                  onChange={(e) => setStockData({ ...stockData, mfgDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Expiry Date"
                  type="date"
                  required
                  value={stockData.expiryDate}
                  onChange={(e) => setStockData({ ...stockData, expiryDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="MRP"
                  type="number"
                  value={stockData.mrp}
                  onChange={(e) => setStockData({ ...stockData, mrp: e.target.value })}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Purchase Price"
                  type="number"
                  value={stockData.purchasePrice}
                  onChange={(e) => setStockData({ ...stockData, purchasePrice: e.target.value })}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Purchase Date"
                  type="date"
                  value={stockData.purchaseDate}
                  onChange={(e) => setStockData({ ...stockData, purchaseDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>

            <Box mt={3} display="flex" justifyContent="flex-end">
              <Button
                variant="contained"
                size="large"
                startIcon={<Save />}
                onClick={handleSave}
                disabled={!selectedMedicine || addBatch.isPending}
              >
                Save Batch
              </Button>
            </Box>

            {selectedMedicine?.stockBatches && selectedMedicine.stockBatches.length > 0 && (
              <>
                <Divider sx={{ my: 4 }} />
                <Typography variant="h6" gutterBottom>Existing Batches for {selectedMedicine.name}</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Batch</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell>MFG</TableCell>
                        <TableCell>Expiry</TableCell>
                        <TableCell align="right">MRP</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedMedicine.stockBatches.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell>{batch.batchNumber}</TableCell>
                          <TableCell align="right">{batch.quantity}</TableCell>
                          <TableCell>{batch.mfgDate ? format(batch.mfgDate instanceof Date ? batch.mfgDate : batch.mfgDate.toDate(), 'MM/yy') : '-'}</TableCell>
                          <TableCell>{format(batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate(), 'MM/yy')}</TableCell>
                          <TableCell align="right">₹{batch.mrp?.toFixed(2) || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Paper>
        </Grid>
      </Grid>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScan}
      />
    </Box>
  );
};

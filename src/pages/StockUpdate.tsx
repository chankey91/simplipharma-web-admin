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
  Add,
  Search,
} from '@mui/icons-material';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useMedicines, useUpdateStock, useAddStockBatch, useFindMedicineByBarcode } from '../hooks/useInventory';
import { Medicine, StockBatch } from '../types';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';

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
    expiryDate: '',
    purchaseDate: '',
    purchasePrice: '',
  });
  const [updateMode, setUpdateMode] = useState<'single' | 'batch'>('single');
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
    
    // Try to find medicine by barcode
    try {
      const result = await findMedicine.mutateAsync(barcode);
      if (result) {
        setSelectedMedicine(result);
        setSuccess('Medicine found!');
      } else {
        // If not found, search in medicines list
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

  const handleSearchByBarcode = async () => {
    if (!barcodeInput) {
      setError('Please enter a barcode');
      return;
    }
    await handleBarcodeScan(barcodeInput);
  };

  const handleSave = async () => {
    if (!selectedMedicine) {
      setError('Please select a medicine');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      if (updateMode === 'single') {
        // Simple stock update
        if (!stockData.quantity) {
          setError('Please enter quantity');
          return;
        }

        await updateStock.mutateAsync({
          medicineId: selectedMedicine.id,
          updates: {
            stock: parseInt(stockData.quantity),
            currentStock: parseInt(stockData.quantity),
            expiryDate: stockData.expiryDate ? new Date(stockData.expiryDate) : undefined,
            batchNumber: stockData.batchNumber || undefined,
            barcode: selectedMedicine.barcode || undefined,
          },
        });
      } else {
        // Batch update
        if (!stockData.batchNumber || !stockData.quantity || !stockData.expiryDate) {
          setError('Please fill all required fields for batch update');
          return;
        }

        await addBatch.mutateAsync({
          medicineId: selectedMedicine.id,
          batch: {
            batchNumber: stockData.batchNumber,
            quantity: parseInt(stockData.quantity),
            expiryDate: new Date(stockData.expiryDate),
            purchaseDate: stockData.purchaseDate ? new Date(stockData.purchaseDate) : new Date(),
            purchasePrice: stockData.purchasePrice ? parseFloat(stockData.purchasePrice) : undefined,
          },
        });
      }

      // Reset form
      setStockData({
        quantity: '',
        batchNumber: '',
        expiryDate: '',
        purchaseDate: '',
        purchasePrice: '',
      });
      
      setSuccess('Stock updated successfully!');
      
      // Refresh medicine data
      setTimeout(() => {
        const updatedMedicine = medicines?.find(m => m.id === selectedMedicine.id);
        if (updatedMedicine) {
          setSelectedMedicine(updatedMedicine);
        }
      }, 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to update stock');
    }
  };

  const handleMedicineSelect = (medicineId: string) => {
    const medicine = medicines?.find(m => m.id === medicineId);
    if (medicine) {
      setSelectedMedicine(medicine);
      setError(null);
      setSuccess(null);
    }
  };

  if (medicinesLoading) {
    return <Loading message="Loading medicines..." />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Update Stock
      </Typography>

      <Grid container spacing={3}>
        {/* Left Column - Search and Selection */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Select Medicine
            </Typography>

            {/* Barcode Scanner */}
            <Box sx={{ mb: 2 }}>
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
                label="Or Enter Barcode/Code"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <IconButton onClick={handleSearchByBarcode}>
                      <Search />
                    </IconButton>
                  ),
                }}
                sx={{ mb: 2 }}
              />
            </Box>

            {/* Medicine Selection */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Select Medicine</InputLabel>
              <Select
                value={selectedMedicine?.id || ''}
                label="Select Medicine"
                onChange={(e) => handleMedicineSelect(e.target.value)}
              >
                {medicines?.map((medicine) => (
                  <MenuItem key={medicine.id} value={medicine.id}>
                    {medicine.name} - {medicine.code || 'N/A'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Selected Medicine Info */}
            {selectedMedicine && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    Selected Medicine
                  </Typography>
                  <Typography variant="body2">
                    <strong>Name:</strong> {selectedMedicine.name}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Code:</strong> {selectedMedicine.code || 'N/A'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Current Stock:</strong> {selectedMedicine.currentStock || selectedMedicine.stock || 0}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Price:</strong> ₹{selectedMedicine.price.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Paper>
        </Grid>

        {/* Right Column - Stock Update Form */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Stock Information
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            {/* Update Mode Selection */}
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Update Mode</InputLabel>
              <Select
                value={updateMode}
                label="Update Mode"
                onChange={(e) => setUpdateMode(e.target.value as 'single' | 'batch')}
              >
                <MenuItem value="single">Simple Update</MenuItem>
                <MenuItem value="batch">Batch Update (with Expiry)</MenuItem>
              </Select>
            </FormControl>

            {!selectedMedicine && (
              <Alert severity="info">
                Please select a medicine to update stock
              </Alert>
            )}

            {selectedMedicine && (
              <>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Quantity"
                      type="number"
                      value={stockData.quantity}
                      onChange={(e) => setStockData({ ...stockData, quantity: e.target.value })}
                      required
                    />
                  </Grid>

                  {updateMode === 'batch' && (
                    <>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Batch Number"
                          value={stockData.batchNumber}
                          onChange={(e) => setStockData({ ...stockData, batchNumber: e.target.value })}
                          required
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Expiry Date"
                          type="date"
                          value={stockData.expiryDate}
                          onChange={(e) => setStockData({ ...stockData, expiryDate: e.target.value })}
                          InputLabelProps={{ shrink: true }}
                          required
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Purchase Date"
                          type="date"
                          value={stockData.purchaseDate}
                          onChange={(e) => setStockData({ ...stockData, purchaseDate: e.target.value })}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Purchase Price"
                          type="number"
                          value={stockData.purchasePrice}
                          onChange={(e) => setStockData({ ...stockData, purchasePrice: e.target.value })}
                        />
                      </Grid>
                    </>
                  )}

                  {updateMode === 'single' && (
                    <>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Batch Number (Optional)"
                          value={stockData.batchNumber}
                          onChange={(e) => setStockData({ ...stockData, batchNumber: e.target.value })}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Expiry Date (Optional)"
                          type="date"
                          value={stockData.expiryDate}
                          onChange={(e) => setStockData({ ...stockData, expiryDate: e.target.value })}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                    </>
                  )}
                </Grid>

                <Box sx={{ mt: 3 }}>
                  <Button
                    variant="contained"
                    startIcon={<Save />}
                    onClick={handleSave}
                    disabled={updateStock.isPending || addBatch.isPending}
                    size="large"
                  >
                    Save Stock Update
                  </Button>
                </Box>
              </>
            )}

            {/* Existing Batches */}
            {selectedMedicine && selectedMedicine.stockBatches && selectedMedicine.stockBatches.length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" gutterBottom>
                  Existing Batches
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Batch Number</TableCell>
                        <TableCell>Quantity</TableCell>
                        <TableCell>Expiry Date</TableCell>
                        <TableCell>Purchase Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedMedicine.stockBatches.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell>{batch.batchNumber}</TableCell>
                          <TableCell>{batch.quantity}</TableCell>
                          <TableCell>
                            {batch.expiryDate instanceof Date
                              ? batch.expiryDate.toLocaleDateString()
                              : batch.expiryDate.toDate().toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {batch.purchaseDate
                              ? batch.purchaseDate instanceof Date
                                ? batch.purchaseDate.toLocaleDateString()
                                : batch.purchaseDate.toDate().toLocaleDateString()
                              : 'N/A'}
                          </TableCell>
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

      {/* Barcode Scanner Modal */}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScan}
      />
    </Box>
  );
};

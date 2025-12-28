import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Divider,
  IconButton,
  Card,
  CardContent,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  ArrowBack,
  Add,
  QrCode,
  PictureAsPdf,
  Edit,
} from '@mui/icons-material';
import { useMedicines, useAddStockBatch } from '../hooks/useInventory';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import JsBarcode from 'jsbarcode';

export const MedicineDetailsPage: React.FC = () => {
  const { medicineId } = useParams<{ medicineId: string }>();
  const navigate = useNavigate();
  const { data: medicines, isLoading } = useMedicines();
  const addBatchMutation = useAddStockBatch();
  
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchData, setBatchData] = useState({
    batchNumber: '',
    quantity: '',
    mfgDate: '',
    expiryDate: '',
    mrp: '',
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
  });
  const [barcodeViewDialog, setBarcodeViewDialog] = useState<{ open: boolean; batchNumber: string; barcodeData: string | null }>({
    open: false,
    batchNumber: '',
    barcodeData: null,
  });
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const medicine = medicines?.find(m => m.id === medicineId);

  if (isLoading) return <Loading message="Loading medicine details..." />;
  if (!medicine) return <Alert severity="error">Medicine not found</Alert>;

  // Debug: Log batch data to console (especially for specific medicine)
  React.useEffect(() => {
    if (medicine?.id === '0IXu5mRZu10DpmnpSXSg') {
      console.log('[DEBUG MedicineDetails] Medicine ID:', medicine.id);
      console.log('[DEBUG MedicineDetails] Medicine batches:', medicine.stockBatches);
      if (medicine.stockBatches) {
        medicine.stockBatches.forEach((batch, index) => {
          console.log(`[DEBUG MedicineDetails] Batch ${index} (${batch.batchNumber}):`, {
            batchNumber: batch.batchNumber,
            mrp: batch.mrp,
            mrpType: typeof batch.mrp,
            mrpIsUndefined: batch.mrp === undefined,
            mrpIsNull: batch.mrp === null,
            quantity: batch.quantity,
            fullBatch: batch
          });
        });
      }
    }
  }, [medicine?.id, medicine?.stockBatches]);

  // Helper function to get latest MRP from batches
  const getLatestMRP = (): string => {
    if (medicine.stockBatches && medicine.stockBatches.length > 0) {
      // Get the latest batch by purchase date that has an MRP
      const sortedBatches = [...medicine.stockBatches].sort((a, b) => {
        const dateA = a.purchaseDate 
          ? (a.purchaseDate instanceof Date ? a.purchaseDate : a.purchaseDate.toDate())
          : new Date(0);
        const dateB = b.purchaseDate 
          ? (b.purchaseDate instanceof Date ? b.purchaseDate : b.purchaseDate.toDate())
          : new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      const latestBatch = sortedBatches.find(b => b.mrp);
      if (latestBatch?.mrp) {
        return `₹${latestBatch.mrp.toFixed(2)}`;
      }
    }
    return medicine.mrp ? `₹${medicine.mrp.toFixed(2)}` : 'N/A';
  };

  const generateBarcode = (batchNumber: string): string | null => {
    if (!barcodeCanvasRef.current || !medicine) return null;
    
    const barcodeValue = `${medicine.code || medicine.id}-${batchNumber}`;
    try {
      JsBarcode(barcodeCanvasRef.current, barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 50,
        displayValue: true,
        fontSize: 14,
      });
      return barcodeCanvasRef.current.toDataURL();
    } catch (error) {
      console.error('Barcode generation error:', error);
      return null;
    }
  };

  const handleViewBarcode = (batchNumber: string) => {
    const barcodeData = generateBarcode(batchNumber);
    setBarcodeViewDialog({
      open: true,
      batchNumber,
      barcodeData,
    });
  };

  const handleAddBatch = async () => {
    if (!medicine || !batchData.batchNumber || !batchData.quantity || !batchData.expiryDate) {
      alert('Please fill all required fields (Batch Number, Quantity, Expiry Date)');
      return;
    }

    try {
      await addBatchMutation.mutateAsync({
        medicineId: medicine.id,
        batch: {
          batchNumber: batchData.batchNumber,
          quantity: parseInt(batchData.quantity),
          mfgDate: batchData.mfgDate ? new Date(batchData.mfgDate) : undefined,
          expiryDate: new Date(batchData.expiryDate),
          purchaseDate: batchData.purchaseDate ? new Date(batchData.purchaseDate) : new Date(),
          purchasePrice: batchData.purchasePrice ? parseFloat(batchData.purchasePrice) : undefined,
          mrp: batchData.mrp ? parseFloat(batchData.mrp) : undefined,
        },
      });
      setBatchDialogOpen(false);
      setBatchData({
        batchNumber: '',
        quantity: '',
        mfgDate: '',
        expiryDate: '',
        mrp: '',
        purchasePrice: '',
        purchaseDate: new Date().toISOString().split('T')[0],
      });
    } catch (error: any) {
      alert(error.message || 'Failed to add batch');
    }
  };

  const handleGeneratePDF = () => {
    if (!medicine || !medicine.stockBatches || medicine.stockBatches.length === 0) {
      alert('No batches available to generate barcodes');
      return;
    }
    
    // For now, open all barcodes in a new window
    // In production, use jsPDF to create a proper PDF
    const barcodes = medicine.stockBatches.map(batch => {
      const canvas = document.createElement('canvas');
      const barcodeValue = `${medicine.code || medicine.id}-${batch.batchNumber}`;
      JsBarcode(canvas, barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 50,
        displayValue: true,
      });
      return canvas.toDataURL();
    });

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head><title>Barcodes for ${medicine.name}</title></head>
          <body style="padding: 20px; text-align: center;">
            <h2>Barcodes for ${medicine.name}</h2>
            ${barcodes.map((barcode, idx) => `
              <div style="margin: 20px; display: inline-block;">
                <p>Batch: ${medicine.stockBatches![idx].batchNumber}</p>
                <img src="${barcode}" style="border: 1px solid #ccc; padding: 10px;" />
              </div>
            `).join('')}
          </body>
        </html>
      `);
    }
  };

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Inventory', path: '/inventory' },
        { label: medicine?.name || 'Medicine Details' }
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/inventory')} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">{medicine.name}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          startIcon={<Edit />}
          onClick={() => navigate(`/inventory/stock-update?medicineId=${medicine.id}`)}
          sx={{ mr: 2 }}
        >
          Update Stock
        </Button>
        <Button
          variant="contained"
          startIcon={<PictureAsPdf />}
          onClick={handleGeneratePDF}
          disabled={!medicine.stockBatches || medicine.stockBatches.length === 0}
        >
          Export Barcodes
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Left: General Info */}
        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>General Information</Typography>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Category</Typography>
                <Typography variant="body1">{medicine.category}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Manufacturer</Typography>
                <Typography variant="body1">{medicine.manufacturer}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Composition</Typography>
                <Typography variant="body1">{medicine.composition || 'N/A'}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Item Code / Barcode</Typography>
                <Typography variant="body1">{medicine.code || medicine.barcode || 'N/A'}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">MRP</Typography>
                <Typography variant="body1" fontWeight="medium">{getLatestMRP()}</Typography>
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Stock Summary</Typography>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Total Stock:</Typography>
                <Typography fontWeight="bold">{medicine.currentStock ?? medicine.stock ?? 0}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Latest MRP:</Typography>
                <Typography fontWeight="bold">{getLatestMRP()}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between">
                <Typography color="textSecondary">Expiry Status:</Typography>
                {medicine.expiryDate ? (
                  <Chip
                    label={format(medicine.expiryDate instanceof Date ? medicine.expiryDate : medicine.expiryDate.toDate(), 'MMM yyyy')}
                    size="small"
                    color="primary"
                  />
                ) : <Typography>N/A</Typography>}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Batch Listing */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Batch-wise Inventory</Typography>
              <Button
                size="small"
                variant="contained"
                startIcon={<Add />}
                onClick={() => setBatchDialogOpen(true)}
              >
                Add New Batch
              </Button>
            </Box>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Batch No.</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>MFG</TableCell>
                    <TableCell>Expiry</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">Barcode</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {medicine.stockBatches && medicine.stockBatches.length > 0 ? (
                    medicine.stockBatches.map((batch) => {
                      // Ensure MRP is properly converted to number - handle all cases
                      let mrpValue: number | null = null;
                      
                      if (batch.mrp !== undefined && batch.mrp !== null) {
                        if (typeof batch.mrp === 'number') {
                          mrpValue = isNaN(batch.mrp) ? null : batch.mrp;
                        } else if (typeof batch.mrp === 'string') {
                          const trimmed = batch.mrp.trim();
                          if (trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined') {
                            const parsed = parseFloat(trimmed);
                            mrpValue = !isNaN(parsed) ? parsed : null;
                          }
                        }
                      }
                      
                      // Debug for specific medicine
                      if (medicine.id === '0IXu5mRZu10DpmnpSXSg') {
                        console.log(`[DEBUG Display] Batch ${batch.batchNumber} MRP:`, {
                          batchMrp: batch.mrp,
                          mrpType: typeof batch.mrp,
                          mrpValue: mrpValue,
                          willDisplay: mrpValue !== null && !isNaN(mrpValue)
                        });
                      }
                      
                      return (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{batch.batchNumber}</Typography>
                        </TableCell>
                        <TableCell align="right">{batch.quantity}</TableCell>
                        <TableCell>{batch.mfgDate ? format(batch.mfgDate instanceof Date ? batch.mfgDate : batch.mfgDate.toDate(), 'MM/yy') : '-'}</TableCell>
                        <TableCell>
                          <Typography variant="body2" color={new Date() > (batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate()) ? 'error.main' : 'inherit'}>
                            {format(batch.expiryDate instanceof Date ? batch.expiryDate : batch.expiryDate.toDate(), 'MM/yy')}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {mrpValue !== null && !isNaN(mrpValue) 
                            ? `₹${mrpValue.toFixed(2)}` 
                            : '-'}
                        </TableCell>
                        <TableCell align="right">
                          <IconButton 
                            size="small" 
                            title="View/Print Barcode"
                            onClick={() => handleViewBarcode(batch.batchNumber)}
                          >
                            <QrCode />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography color="textSecondary" sx={{ py: 2 }}>No batches found. Add a batch to get started.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Box mt={3}>
            <Typography variant="h6" gutterBottom>Medicine Description</Typography>
            <Paper sx={{ p: 3 }}>
              <Typography variant="body1">{medicine.description || 'No description available for this medicine.'}</Typography>
              
              <Grid container spacing={2} sx={{ mt: 2 }}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="primary">Dosage</Typography>
                  <Typography variant="body2">{medicine.dosage || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="primary">Side Effects</Typography>
                  <Typography variant="body2">{medicine.sideEffects || 'N/A'}</Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>
        </Grid>
      </Grid>

      {/* Add Batch Dialog */}
      <Dialog open={batchDialogOpen} onClose={() => setBatchDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Batch - {medicine.name}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Batch Number"
                required
                value={batchData.batchNumber}
                onChange={(e) => setBatchData({ ...batchData, batchNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Quantity"
                type="number"
                required
                value={batchData.quantity}
                onChange={(e) => setBatchData({ ...batchData, quantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturing Date (MFG)"
                type="date"
                value={batchData.mfgDate}
                onChange={(e) => setBatchData({ ...batchData, mfgDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Date"
                type="date"
                required
                value={batchData.expiryDate}
                onChange={(e) => setBatchData({ ...batchData, expiryDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={batchData.mrp}
                onChange={(e) => setBatchData({ ...batchData, mrp: e.target.value })}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                value={batchData.purchasePrice}
                onChange={(e) => setBatchData({ ...batchData, purchasePrice: e.target.value })}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Purchase Date"
                type="date"
                value={batchData.purchaseDate}
                onChange={(e) => setBatchData({ ...batchData, purchaseDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddBatch}
            disabled={addBatchMutation.isPending}
          >
            {addBatchMutation.isPending ? 'Adding...' : 'Add Batch'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Barcode View Dialog */}
      <Dialog open={barcodeViewDialog.open} onClose={() => setBarcodeViewDialog({ open: false, batchNumber: '', barcodeData: null })} maxWidth="xs" fullWidth>
        <DialogTitle>Barcode - Batch {barcodeViewDialog.batchNumber}</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {barcodeViewDialog.barcodeData ? (
            <Box>
              <img src={barcodeViewDialog.barcodeData} alt="Barcode" style={{ maxWidth: '100%' }} />
              <Button
                variant="outlined"
                fullWidth
                sx={{ mt: 2 }}
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = barcodeViewDialog.barcodeData!;
                  link.download = `barcode-${barcodeViewDialog.batchNumber}.png`;
                  link.click();
                }}
              >
                Download Barcode
              </Button>
            </Box>
          ) : (
            <Typography>Error generating barcode</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBarcodeViewDialog({ open: false, batchNumber: '', barcodeData: null })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Hidden canvas for barcode generation */}
      <canvas ref={barcodeCanvasRef} style={{ display: 'none' }} />
    </Box>
  );
};

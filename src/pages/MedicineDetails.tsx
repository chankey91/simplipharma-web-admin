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
import { useMedicines, useAddStockBatch, useUpdateMedicine } from '../hooks/useInventory';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import QRCode from 'qrcode';

export const MedicineDetailsPage: React.FC = () => {
  const { medicineId } = useParams<{ medicineId: string }>();
  const navigate = useNavigate();
  const { data: medicines, isLoading } = useMedicines();
  const addBatchMutation = useAddStockBatch();
  const updateMedicineMutation = useUpdateMedicine();
  
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    code: '',
    category: '',
    unit: '',
    manufacturer: '',
    gstRate: 5,
    description: '',
    composition: '',
    dosage: '',
    sideEffects: '',
  });
  const [batchData, setBatchData] = useState({
    batchNumber: '',
    quantity: '',
    mfgDate: '',
    expiryDate: '',
    mrp: '',
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
  });
  const [qrCodeViewDialog, setQrCodeViewDialog] = useState<{ open: boolean; batchNumber: string; qrCodeData: string | null }>({
    open: false,
    batchNumber: '',
    qrCodeData: null,
  });
  
  const medicine = medicines?.find(m => m.id === medicineId);

  // Initialize edit data when medicine loads or edit dialog opens
  React.useEffect(() => {
    if (medicine && editDialogOpen) {
      setEditData({
        name: medicine.name || '',
        code: medicine.code || '',
        category: medicine.category || '',
        unit: medicine.unit || '',
        manufacturer: medicine.manufacturer || '',
        gstRate: medicine.gstRate !== undefined && medicine.gstRate !== null ? medicine.gstRate : 5,
        description: medicine.description || '',
        composition: medicine.composition || '',
        dosage: medicine.dosage || '',
        sideEffects: medicine.sideEffects || '',
      });
    }
  }, [medicine, editDialogOpen]);

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

  const generateQRCode = async (batchNumber: string): Promise<string | null> => {
    if (!medicine) return null;
    
    const qrData = JSON.stringify({
      medicineId: medicine.id,
      medicineName: medicine.name,
      medicineCode: medicine.code || medicine.id,
      batchNumber: batchNumber,
    });
    
    try {
      const qrDataUrl = await QRCode.toDataURL(qrData, { width: 200, margin: 1 });
      return qrDataUrl;
    } catch (error) {
      console.error('QR code generation error:', error);
      return null;
    }
  };

  const handleViewQRCode = async (batchNumber: string) => {
    const qrCodeData = await generateQRCode(batchNumber);
    setQrCodeViewDialog({
      open: true,
      batchNumber,
      qrCodeData,
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

  const handleEditGeneralInfo = async () => {
    if (!medicine) return;
    
    try {
      await updateMedicineMutation.mutateAsync({
        medicineId: medicine.id,
        updates: {
          name: editData.name,
          code: editData.code || undefined,
          category: editData.category,
          unit: editData.unit || undefined,
          manufacturer: editData.manufacturer,
          gstRate: editData.gstRate,
          description: editData.description || undefined,
          composition: editData.composition || undefined,
          dosage: editData.dosage || undefined,
          sideEffects: editData.sideEffects || undefined,
        }
      });
      setEditDialogOpen(false);
    } catch (error: any) {
      alert(error.message || 'Failed to update medicine');
    }
  };

  const handleGeneratePDF = async () => {
    if (!medicine || !medicine.stockBatches || medicine.stockBatches.length === 0) {
      alert('No batches available to generate QR codes');
      return;
    }
    
    // Generate QR codes for all batches
    const qrCodes = await Promise.all(
      medicine.stockBatches.map(async (batch) => {
        const qrData = JSON.stringify({
          medicineId: medicine.id,
          medicineName: medicine.name,
          medicineCode: medicine.code || medicine.id,
          batchNumber: batch.batchNumber,
        });
        try {
          return await QRCode.toDataURL(qrData, { width: 200, margin: 1 });
        } catch (error) {
          console.error(`Error generating QR code for batch ${batch.batchNumber}:`, error);
          return null;
        }
      })
    );

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head><title>QR Codes for ${medicine.name}</title></head>
          <body style="padding: 20px; text-align: center;">
            <h2>QR Codes for ${medicine.name}</h2>
            ${qrCodes.map((qrCode, idx) => qrCode ? `
              <div style="margin: 20px; display: inline-block;">
                <p>Batch: ${medicine.stockBatches![idx].batchNumber}</p>
                <img src="${qrCode}" style="border: 1px solid #ccc; padding: 10px;" />
              </div>
            ` : '').join('')}
          </body>
        </html>
      `);
      newWindow.document.close();
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
          Export QR Codes
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Left: General Info */}
        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">General Information</Typography>
                <IconButton size="small" color="primary" onClick={() => setEditDialogOpen(true)}>
                  <Edit />
                </IconButton>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Medicine Name</Typography>
                <Typography variant="body1" fontWeight="medium">{medicine.name}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Type</Typography>
                <Typography variant="body1">{medicine.category}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Packaging</Typography>
                <Typography variant="body1">{medicine.unit || 'N/A'}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Manufacturer</Typography>
                <Typography variant="body1">{medicine.manufacturer}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Item Code</Typography>
                <Typography variant="body1">{medicine.code || 'N/A'}</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">GST Rate</Typography>
                <Typography variant="body1" fontWeight="medium">{medicine.gstRate || 5}%</Typography>
              </Box>
              <Box mb={2}>
                <Typography variant="caption" color="textSecondary">Composition</Typography>
                <Typography variant="body1">{medicine.composition || 'N/A'}</Typography>
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
                <Typography color="textSecondary">GST Rate:</Typography>
                <Typography fontWeight="bold">{medicine.gstRate || 5}%</Typography>
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
                    <TableCell>Expiry</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">QR Code</TableCell>
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
                          const trimmed = String(batch.mrp).trim();
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
                            title="View/Print QR Code"
                            onClick={() => handleViewQRCode(batch.batchNumber)}
                          >
                            <QrCode />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
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

      {/* Edit General Information Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit General Information</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Medicine Name"
                required
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Item Code"
                value={editData.code}
                onChange={(e) => setEditData({ ...editData, code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Type"
                required
                value={editData.category}
                onChange={(e) => setEditData({ ...editData, category: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Packaging"
                value={editData.unit}
                onChange={(e) => setEditData({ ...editData, unit: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturer"
                required
                value={editData.manufacturer}
                onChange={(e) => setEditData({ ...editData, manufacturer: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                required
                value={editData.gstRate}
                onChange={(e) => setEditData({ ...editData, gstRate: parseFloat(e.target.value) || 5 })}
                inputProps={{ min: 0, max: 100, step: 0.01 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Composition"
                value={editData.composition}
                onChange={(e) => setEditData({ ...editData, composition: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={3}
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Dosage"
                value={editData.dosage}
                onChange={(e) => setEditData({ ...editData, dosage: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Side Effects"
                value={editData.sideEffects}
                onChange={(e) => setEditData({ ...editData, sideEffects: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEditGeneralInfo}
            disabled={updateMedicineMutation.isPending || !editData.name || !editData.category || !editData.manufacturer}
          >
            {updateMedicineMutation.isPending ? 'Updating...' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR Code View Dialog */}
      <Dialog open={qrCodeViewDialog.open} onClose={() => setQrCodeViewDialog({ open: false, batchNumber: '', qrCodeData: null })} maxWidth="xs" fullWidth>
        <DialogTitle>QR Code - Batch {qrCodeViewDialog.batchNumber}</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {qrCodeViewDialog.qrCodeData ? (
            <Box>
              <img src={qrCodeViewDialog.qrCodeData} alt="QR Code" style={{ maxWidth: '100%' }} />
              <Button
                variant="contained"
                fullWidth
                sx={{ mt: 2 }}
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = qrCodeViewDialog.qrCodeData!;
                  link.download = `qr-code-${qrCodeViewDialog.batchNumber}.png`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                Download QR Code
              </Button>
            </Box>
          ) : (
            <Typography>Error generating QR code</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrCodeViewDialog({ open: false, batchNumber: '', qrCodeData: null })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

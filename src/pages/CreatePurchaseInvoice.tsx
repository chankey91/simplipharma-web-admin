import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  TextField,
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
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Autocomplete,
  Alert,
  Chip,
  Divider,
  Card,
  CardContent,
} from '@mui/material';
import {
  ArrowBack,
  Add,
  Delete,
  Save,
  Search,
  QrCode,
} from '@mui/icons-material';
import { useVendors } from '../hooks/useVendors';
import { useMedicines, useCreateMedicine } from '../hooks/useInventory';
import { useCreatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { PurchaseInvoiceItem, Medicine, Vendor } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import QRCode from 'qrcode';

export const CreatePurchaseInvoicePage: React.FC = () => {
  const navigate = useNavigate();
  const { data: vendors } = useVendors();
  const { data: medicines } = useMedicines();
  const createMedicineMutation = useCreateMedicine();
  const createInvoiceMutation = useCreatePurchaseInvoice();
  
  const [invoiceData, setInvoiceData] = useState({
    invoiceNumber: '',
    vendorId: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  
  const [items, setItems] = useState<PurchaseInvoiceItem[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [addMedicineDialog, setAddMedicineDialog] = useState(false);
  const [newMedicineData, setNewMedicineData] = useState({
    name: '',
    code: '',
    type: '', // Displayed as "Type" but stored as category
    packaging: '',
    manufacturer: '',
    gstRate: '5',
  });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; itemIndex: number | null }>({
    open: false,
    itemIndex: null,
  });
  const [qrCodeDialog, setQrCodeDialog] = useState<{ open: boolean; qrCode: string | null; itemName: string }>({
    open: false,
    qrCode: null,
    itemName: '',
  });
  const [currentItem, setCurrentItem] = useState<{
    medicineId?: string;
    medicineName?: string;
    batchNumber?: string;
    expiryDate?: string;
    expiryMonth?: string;
    expiryYear?: string;
    quantity?: string | number;
    freeQuantity?: string | number;
    unitPrice?: string | number;
    purchasePrice?: string | number;
    mrp?: string | number;
    gstRate?: string | number;
    discountPercentage?: string | number;
  }>({
    medicineId: '',
    medicineName: '',
    batchNumber: '',
    expiryDate: '',
    expiryMonth: '',
    expiryYear: '',
    quantity: '',
    freeQuantity: '',
    unitPrice: '',
    purchasePrice: '',
    mrp: '',
    gstRate: '',
    discountPercentage: '',
  });

  const selectedVendor = vendors?.find(v => v.id === invoiceData.vendorId);

  const calculateTotals = () => {
    const subTotal = items.reduce((sum, item) => sum + item.totalAmount, 0);
    return { subTotal, totalAmount: subTotal };
  };

  const { subTotal, totalAmount } = calculateTotals();

  const handleAddItem = () => {
    if (!selectedMedicine) {
      alert('Please select a medicine');
      return;
    }
    setCurrentItem({
      medicineId: selectedMedicine.id,
      medicineName: selectedMedicine.name,
      batchNumber: '',
      expiryDate: '',
      expiryMonth: '',
      expiryYear: '',
      quantity: '',
      freeQuantity: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
      gstRate: selectedMedicine.gstRate || 5, // Get GST rate from medicine master data
      discountPercentage: '',
    });
    setItemDialog({ open: true, itemIndex: null });
  };

  const generateQRCode = async (data: string): Promise<string> => {
    try {
      const qrDataUrl = await QRCode.toDataURL(data, { width: 200, margin: 1 });
      return qrDataUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      return '';
    }
  };

  const handleSaveItem = async () => {
    if (!currentItem.medicineId || !currentItem.batchNumber || !currentItem.quantity || 
        !currentItem.expiryMonth || !currentItem.expiryYear || !currentItem.purchasePrice) {
      alert('Please fill all required fields');
      return;
    }

    const quantity = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
    const freeQuantity = currentItem.freeQuantity ? (typeof currentItem.freeQuantity === 'number' ? currentItem.freeQuantity : parseFloat(String(currentItem.freeQuantity || '0'))) : 0;
    const purchasePrice = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
    // Get GST rate from medicine master data (from selectedMedicine)
    const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
    const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
    const discountPercentage = currentItem.discountPercentage ? (typeof currentItem.discountPercentage === 'number' ? currentItem.discountPercentage : parseFloat(String(currentItem.discountPercentage || '0'))) : 0;
    
    // Calculate total: (purchasePrice * quantity) - discount + GST
    const baseAmount = purchasePrice * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const gstAmount = (amountAfterDiscount * gstRate) / 100;
    const totalAmount = amountAfterDiscount + gstAmount;

    // Create expiry date from month/year
    const expiryDate = new Date(parseInt(currentItem.expiryYear || '2024'), parseInt(currentItem.expiryMonth || '1') - 1, 1);

    // Generate QR code data
    const qrData = JSON.stringify({
      medicineId: currentItem.medicineId,
      medicineName: currentItem.medicineName,
      batchNumber: currentItem.batchNumber,
      expiryDate: format(expiryDate, 'MM/yyyy'),
      quantity,
      freeQuantity,
      purchasePrice,
      mrp: currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp))) : undefined,
    });
    const qrCode = await generateQRCode(qrData);

    const newItem: PurchaseInvoiceItem = {
      medicineId: currentItem.medicineId,
      medicineName: currentItem.medicineName || '',
      batchNumber: currentItem.batchNumber,
      expiryDate,
      quantity,
      freeQuantity: freeQuantity > 0 ? freeQuantity : undefined,
      unitPrice: purchasePrice,
      purchasePrice,
      mrp: currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp))) : undefined,
      gstRate: gstRate > 0 ? gstRate : undefined,
      discountPercentage: discountPercentage > 0 ? discountPercentage : undefined,
      totalAmount,
      qrCode: qrCode || undefined,
    };

    if (itemDialog.itemIndex !== null) {
      const newItems = [...items];
      newItems[itemDialog.itemIndex] = newItem;
      setItems(newItems);
    } else {
      setItems([...items, newItem]);
    }

    setItemDialog({ open: false, itemIndex: null });
    setSelectedMedicine(null);
    setCurrentItem({
      medicineId: '',
      medicineName: '',
      batchNumber: '',
      expiryDate: '',
      expiryMonth: '',
      expiryYear: '',
      quantity: '',
      freeQuantity: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
      gstRate: selectedMedicine?.gstRate || 5, // Reset to medicine's GST rate
      discountPercentage: '',
    });
  };

  const handleEditItem = (index: number) => {
    const item = items[index];
    const expiryDate = item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate();
    setCurrentItem({
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      expiryDate: format(expiryDate, 'MM/yyyy'),
      expiryMonth: String(expiryDate.getMonth() + 1).padStart(2, '0'),
      expiryYear: String(expiryDate.getFullYear()),
      quantity: item.quantity.toString(),
      freeQuantity: item.freeQuantity?.toString() || '',
      unitPrice: item.unitPrice.toString(),
      purchasePrice: item.purchasePrice.toString(),
      mrp: item.mrp?.toString() || '',
      gstRate: item.gstRate || selectedMedicine?.gstRate || 5, // Use item's GST rate or medicine's default
      discountPercentage: item.discountPercentage?.toString() || '',
    });
    setItemDialog({ open: true, itemIndex: index });
  };

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleViewQRCode = (qrCode: string | null, itemName: string) => {
    if (qrCode) {
      setQrCodeDialog({ open: true, qrCode, itemName });
    }
  };

  const handleDownloadQRCode = () => {
    if (qrCodeDialog.qrCode) {
      const link = document.createElement('a');
      link.href = qrCodeDialog.qrCode;
      link.download = `qr-code-${qrCodeDialog.itemName.replace(/\s+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleAddMedicine = async () => {
    if (!newMedicineData.name || !newMedicineData.code || !newMedicineData.type || !newMedicineData.packaging || !newMedicineData.manufacturer || !newMedicineData.gstRate) {
      alert('Please fill all required fields');
      return;
    }

    try {
      const medicineId = await createMedicineMutation.mutateAsync({
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type, // Store type as category
        manufacturer: newMedicineData.manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        gstRate: newMedicineData.gstRate ? parseFloat(newMedicineData.gstRate) : 5,
        // Store packaging in description or a custom field if available
        description: `Packaging: ${newMedicineData.packaging}`,
      });

      const newMedicine = medicines?.find(m => m.id === medicineId) || {
        id: medicineId,
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type,
        manufacturer: newMedicineData.manufacturer,
      } as Medicine;

      setSelectedMedicine(newMedicine as Medicine);
      setAddMedicineDialog(false);
      setNewMedicineData({ name: '', code: '', type: '', packaging: '', manufacturer: '', gstRate: '5' });
    } catch (error: any) {
      alert(error.message || 'Failed to add medicine');
    }
  };

  const handleSaveInvoice = async () => {
    const user = auth.currentUser;
    if (!user) {
      alert('Please login to continue');
      return;
    }

    if (!invoiceData.invoiceNumber || !invoiceData.vendorId || items.length === 0) {
      alert('Please fill invoice number, select vendor, and add at least one item');
      return;
    }

    try {
      await createInvoiceMutation.mutateAsync({
        invoiceData: {
          invoiceNumber: invoiceData.invoiceNumber,
          vendorId: invoiceData.vendorId,
          vendorName: selectedVendor?.vendorName || '',
          invoiceDate: new Date(invoiceData.invoiceDate),
          items,
          subTotal,
          taxAmount: 0,
          totalAmount,
          paymentStatus: 'Unpaid',
          notes: invoiceData.notes || undefined,
          createdBy: user.uid,
          createdAt: new Date(),
        },
        updateStock: true,
      });

      navigate('/purchases');
    } catch (error: any) {
      alert(error.message || 'Failed to create invoice');
    }
  };

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Purchase Invoices', path: '/purchases' },
        { label: 'Create Invoice' }
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/purchases')} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">Create Purchase Invoice</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<Save />} onClick={handleSaveInvoice}>
          Save Invoice
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Left: Invoice Details */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Details</Typography>
            <TextField
              fullWidth
              label="Invoice Number"
              required
              value={invoiceData.invoiceNumber}
              onChange={(e) => setInvoiceData({ ...invoiceData, invoiceNumber: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Invoice Date"
              type="date"
              required
              value={invoiceData.invoiceDate}
              onChange={(e) => setInvoiceData({ ...invoiceData, invoiceDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Vendor</InputLabel>
              <Select
                value={invoiceData.vendorId}
                label="Vendor"
                onChange={(e) => setInvoiceData({ ...invoiceData, vendorId: e.target.value })}
              >
                {vendors?.filter(v => v.isActive !== false).map((vendor) => (
                  <MenuItem key={vendor.id} value={vendor.id}>
                    {vendor.vendorName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedVendor && (
              <Card variant="outlined" sx={{ mb: 2, bgcolor: 'rgba(33, 150, 243, 0.05)' }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" gutterBottom>Vendor Info</Typography>
                  <Typography variant="body2">{selectedVendor.vendorName}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    GST: {selectedVendor.gstNumber}
                  </Typography>
                </CardContent>
              </Card>
            )}
            <TextField
              fullWidth
              label="Notes"
              multiline
              rows={3}
              value={invoiceData.notes}
              onChange={(e) => setInvoiceData({ ...invoiceData, notes: e.target.value })}
            />
          </Paper>

          {/* Totals */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Summary</Typography>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal:</Typography>
              <Typography>₹{subTotal.toFixed(2)}</Typography>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between">
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{totalAmount.toFixed(2)}</Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Right: Items */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Invoice Items</Typography>
              <Box display="flex" gap={2}>
                <Autocomplete
                  options={medicines || []}
                  getOptionLabel={(option) => `${option.name} - ${option.code || 'N/A'}`}
                  value={selectedMedicine}
                  onChange={(_, newValue) => setSelectedMedicine(newValue)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Search Medicine"
                      placeholder="Type to search..."
                      size="small"
                      sx={{ minWidth: 250 }}
                    />
                  )}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setAddMedicineDialog(true)}
                >
                  Add New Medicine
                </Button>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddItem}
                  disabled={!selectedMedicine}
                >
                  Add Item
                </Button>
              </Box>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Free Qty</TableCell>
                    <TableCell align="right">Total Qty</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center">
                        <Typography color="textSecondary" sx={{ py: 2 }}>
                          No items added. Search and add medicines to create invoice.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{item.medicineName}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            Exp: {format(item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate(), 'MM/yyyy')}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.batchNumber}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">
                          {item.freeQuantity && item.freeQuantity > 0 ? item.freeQuantity : '-'}
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="medium">
                            {item.quantity + (item.freeQuantity || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">₹{item.purchasePrice.toFixed(2)}</TableCell>
                        <TableCell align="right">₹{item.totalAmount.toFixed(2)}</TableCell>
                        <TableCell align="center">
                          {item.qrCode ? (
                            <IconButton 
                              size="small" 
                              onClick={() => handleViewQRCode(item.qrCode || null, item.medicineName)}
                              color="primary"
                              title="View QR Code"
                            >
                              <QrCode />
                            </IconButton>
                          ) : (
                            <Typography variant="caption" color="textSecondary">-</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" onClick={() => handleEditItem(index)}>
                            <Search />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDeleteItem(index)}>
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Add Item Dialog */}
      <Dialog open={itemDialog.open} onClose={() => setItemDialog({ open: false, itemIndex: null })} maxWidth="sm" fullWidth>
        <DialogTitle>
          {itemDialog.itemIndex !== null ? 'Edit Item' : 'Add Item'} - {currentItem.medicineName}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Batch Number"
                required
                value={currentItem.batchNumber}
                onChange={(e) => setCurrentItem({ ...currentItem, batchNumber: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Quantity"
                type="number"
                required
                value={currentItem.quantity}
                onChange={(e) => {
                  setCurrentItem({ 
                    ...currentItem, 
                    quantity: e.target.value,
                  });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Free Quantity"
                type="number"
                value={currentItem.freeQuantity}
                onChange={(e) => setCurrentItem({ ...currentItem, freeQuantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Expiry Month</InputLabel>
                <Select
                  value={currentItem.expiryMonth}
                  label="Expiry Month"
                  required
                  onChange={(e) => setCurrentItem({ ...currentItem, expiryMonth: e.target.value })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                    <MenuItem key={month} value={String(month).padStart(2, '0')}>
                      {String(month).padStart(2, '0')}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Year"
                type="number"
                required
                value={currentItem.expiryYear}
                onChange={(e) => setCurrentItem({ ...currentItem, expiryYear: e.target.value })}
                inputProps={{ min: 2020, max: 2100 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                required
                value={currentItem.purchasePrice}
                onChange={(e) => {
                  setCurrentItem({ 
                    ...currentItem, 
                    purchasePrice: e.target.value,
                    unitPrice: e.target.value,
                  });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={currentItem.mrp}
                onChange={(e) => setCurrentItem({ ...currentItem, mrp: e.target.value })}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                value={(() => {
                  // Get GST rate from medicine master data
                  const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
                  return selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                })()}
                InputProps={{ 
                  readOnly: true
                }}
                helperText="From medicine master data"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Discount Percentage (%)"
                type="number"
                value={currentItem.discountPercentage}
                onChange={(e) => setCurrentItem({ ...currentItem, discountPercentage: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Total Amount"
                value={(() => {
                  const qty = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
                  const price = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
                  // Get GST rate from medicine master data
                  const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
                  const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                  const discountPercentage = currentItem.discountPercentage ? (typeof currentItem.discountPercentage === 'number' ? currentItem.discountPercentage : parseFloat(String(currentItem.discountPercentage || '0'))) : 0;
                  const baseAmount = price * qty;
                  const discountAmount = (baseAmount * discountPercentage) / 100;
                  const amountAfterDiscount = baseAmount - discountAmount;
                  const gstAmount = (amountAfterDiscount * gstRate) / 100;
                  return (amountAfterDiscount + gstAmount).toFixed(2);
                })()}
                InputProps={{ 
                  readOnly: true,
                  startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography>
                }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialog({ open: false, itemIndex: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveItem}>
            {itemDialog.itemIndex !== null ? 'Update' : 'Add'} Item
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR Code View Dialog */}
      <Dialog 
        open={qrCodeDialog.open} 
        onClose={() => setQrCodeDialog({ open: false, qrCode: null, itemName: '' })} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>QR Code - {qrCodeDialog.itemName}</DialogTitle>
        <DialogContent>
          {qrCodeDialog.qrCode ? (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <img src={qrCodeDialog.qrCode} alt="QR Code" style={{ maxWidth: '100%', marginBottom: 16 }} />
              <Button
                variant="contained"
                fullWidth
                onClick={handleDownloadQRCode}
              >
                Download QR Code
              </Button>
            </Box>
          ) : (
            <Typography>No QR code available</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrCodeDialog({ open: false, qrCode: null, itemName: '' })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add Medicine Dialog */}
      <Dialog open={addMedicineDialog} onClose={() => setAddMedicineDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Medicine to Master</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Medicine Name"
                required
                value={newMedicineData.name}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Code"
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
                value={newMedicineData.packaging}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, packaging: e.target.value })}
                placeholder="e.g., 10 ml, 15 Tablet, 10 Capsule"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturer"
                required
                value={newMedicineData.manufacturer}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, manufacturer: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                required
                value={newMedicineData.gstRate}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, gstRate: e.target.value })}
                inputProps={{ min: 0, max: 100, step: 0.01 }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddMedicineDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddMedicine} disabled={createMedicineMutation.isPending}>
            Add to Master
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};


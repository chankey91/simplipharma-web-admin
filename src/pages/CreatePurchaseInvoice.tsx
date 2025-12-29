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
} from '@mui/icons-material';
import { useVendors } from '../hooks/useVendors';
import { useMedicines, useCreateMedicine } from '../hooks/useInventory';
import { useCreatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { PurchaseInvoiceItem, Medicine, Vendor } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';

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
    taxPercentage: 18,
    discount: 0,
    notes: '',
  });
  
  const [items, setItems] = useState<PurchaseInvoiceItem[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [addMedicineDialog, setAddMedicineDialog] = useState(false);
  const [newMedicineData, setNewMedicineData] = useState({
    name: '',
    code: '',
    category: '',
    manufacturer: '',
    mrp: '',
  });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; itemIndex: number | null }>({
    open: false,
    itemIndex: null,
  });
  const [currentItem, setCurrentItem] = useState<{
    medicineId?: string;
    medicineName?: string;
    batchNumber?: string;
    mfgDate?: string;
    expiryDate?: string;
    quantity?: string | number;
    unitPrice?: string | number;
    purchasePrice?: string | number;
    mrp?: string | number;
  }>({
    medicineId: '',
    medicineName: '',
    batchNumber: '',
    mfgDate: '',
    expiryDate: '',
    quantity: '',
    unitPrice: '',
    purchasePrice: '',
    mrp: '',
  });

  const selectedVendor = vendors?.find(v => v.id === invoiceData.vendorId);

  const calculateTotals = () => {
    const subTotal = items.reduce((sum, item) => sum + item.totalAmount, 0);
    const discountAmount = (subTotal * (invoiceData.discount || 0)) / 100;
    const taxableAmount = subTotal - discountAmount;
    const taxAmount = (taxableAmount * invoiceData.taxPercentage) / 100;
    const totalAmount = taxableAmount + taxAmount;
    
    return { subTotal, discountAmount, taxAmount, totalAmount };
  };

  const { subTotal, discountAmount, taxAmount, totalAmount } = calculateTotals();

  const handleAddItem = () => {
    if (!selectedMedicine) {
      alert('Please select a medicine');
      return;
    }
    setCurrentItem({
      medicineId: selectedMedicine.id,
      medicineName: selectedMedicine.name,
      batchNumber: '',
      mfgDate: '',
      expiryDate: '',
      quantity: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
    });
    setItemDialog({ open: true, itemIndex: null });
  };

  const handleSaveItem = () => {
    if (!currentItem.medicineId || !currentItem.batchNumber || !currentItem.quantity || 
        !currentItem.expiryDate || !currentItem.purchasePrice) {
      alert('Please fill all required fields');
      return;
    }

    const quantity = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
    const purchasePrice = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
    const totalAmount = quantity * purchasePrice;

    const newItem: PurchaseInvoiceItem = {
      medicineId: currentItem.medicineId,
      medicineName: currentItem.medicineName || '',
      batchNumber: currentItem.batchNumber,
      mfgDate: currentItem.mfgDate ? new Date(currentItem.mfgDate) : new Date(),
      expiryDate: new Date(currentItem.expiryDate),
      quantity,
      unitPrice: purchasePrice,
      purchasePrice,
      mrp: currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp))) : undefined,
      totalAmount,
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
      mfgDate: '',
      expiryDate: '',
      quantity: '',
      unitPrice: '',
      purchasePrice: '',
      mrp: '',
    });
  };

  const handleEditItem = (index: number) => {
    const item = items[index];
    setCurrentItem({
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      mfgDate: item.mfgDate instanceof Date 
        ? item.mfgDate.toISOString().split('T')[0]
        : item.mfgDate.toDate().toISOString().split('T')[0],
      expiryDate: item.expiryDate instanceof Date
        ? item.expiryDate.toISOString().split('T')[0]
        : item.expiryDate.toDate().toISOString().split('T')[0],
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      purchasePrice: item.purchasePrice.toString(),
      mrp: item.mrp?.toString() || '',
    });
    setItemDialog({ open: true, itemIndex: index });
  };

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleAddMedicine = async () => {
    if (!newMedicineData.name || !newMedicineData.manufacturer || !newMedicineData.category) {
      alert('Please fill all required fields');
      return;
    }

    try {
      const medicineId = await createMedicineMutation.mutateAsync({
        name: newMedicineData.name,
        code: newMedicineData.code || undefined,
        category: newMedicineData.category,
        manufacturer: newMedicineData.manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        mrp: newMedicineData.mrp ? parseFloat(newMedicineData.mrp) : undefined,
      });

      const newMedicine = medicines?.find(m => m.id === medicineId) || {
        id: medicineId,
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.category,
        manufacturer: newMedicineData.manufacturer,
      } as Medicine;

      setSelectedMedicine(newMedicine as Medicine);
      setAddMedicineDialog(false);
      setNewMedicineData({ name: '', code: '', category: '', manufacturer: '', mrp: '' });
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
          taxAmount,
          taxPercentage: invoiceData.taxPercentage,
          discount: discountAmount,
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
              label="Tax Percentage (%)"
              type="number"
              value={invoiceData.taxPercentage}
              onChange={(e) => setInvoiceData({ ...invoiceData, taxPercentage: parseFloat(e.target.value) || 0 })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Discount (%)"
              type="number"
              value={invoiceData.discount}
              onChange={(e) => setInvoiceData({ ...invoiceData, discount: parseFloat(e.target.value) || 0 })}
              sx={{ mb: 2 }}
            />
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
            {invoiceData.discount > 0 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Discount ({invoiceData.discount}%):</Typography>
                <Typography color="error">-₹{discountAmount.toFixed(2)}</Typography>
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax ({invoiceData.taxPercentage}%):</Typography>
              <Typography>₹{taxAmount.toFixed(2)}</Typography>
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
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
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
                            Exp: {format(item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate(), 'MM/yy')}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.batchNumber}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">₹{item.purchasePrice.toFixed(2)}</TableCell>
                        <TableCell align="right">₹{item.totalAmount.toFixed(2)}</TableCell>
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
                  const qty = e.target.value;
                  const price = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
                  setCurrentItem({ 
                    ...currentItem, 
                    quantity: qty,
                  });
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Manufacturing Date (MFG)"
                type="date"
                value={currentItem.mfgDate}
                onChange={(e) => setCurrentItem({ ...currentItem, mfgDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Date"
                type="date"
                required
                value={currentItem.expiryDate}
                onChange={(e) => setCurrentItem({ ...currentItem, expiryDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                required
                value={currentItem.purchasePrice}
                onChange={(e) => {
                  const price = e.target.value;
                  const qty = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
                  setCurrentItem({ 
                    ...currentItem, 
                    purchasePrice: price,
                    unitPrice: price,
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
                label="Total Amount"
                value={((typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'))) * (typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0')))).toFixed(2)}
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
                value={newMedicineData.code}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Category"
                required
                value={newMedicineData.category}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, category: e.target.value })}
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
                label="MRP"
                type="number"
                value={newMedicineData.mrp}
                onChange={(e) => setNewMedicineData({ ...newMedicineData, mrp: e.target.value })}
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


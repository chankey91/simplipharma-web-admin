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
    expiryDate: '', // MM/YYYY format
    quantity: '',
    freeQuantity: '',
    unitPrice: '',
    purchasePrice: '',
    mrp: '',
    gstRate: '',
    discountPercentage: '',
  });
  const [expiryDateError, setExpiryDateError] = useState<string>('');

  const selectedVendor = vendors?.find(v => v.id === invoiceData.vendorId);

  const calculateTotals = () => {
    // Calculate subtotal: sum of (purchasePrice * quantity) for all items
    const subTotal = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      return sum + (purchasePrice * quantity);
    }, 0);

    // Calculate total discount amount: sum of discount amounts from discount percentage
    const totalDiscount = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      const discountPercentage = item.discountPercentage || 0;
      
      const baseAmount = purchasePrice * quantity;
      const discountAmount = (baseAmount * discountPercentage) / 100;
      
      return sum + discountAmount;
    }, 0);

    // Calculate total tax amount: sum of GST amounts from GST rate
    const totalTax = items.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = item.purchasePrice || 0;
      const discountPercentage = item.discountPercentage || 0;
      const gstRate = item.gstRate || 0;
      
      const baseAmount = purchasePrice * quantity;
      const discountAmount = (baseAmount * discountPercentage) / 100;
      const amountAfterDiscount = baseAmount - discountAmount;
      const gstAmount = (amountAfterDiscount * gstRate) / 100;
      
      return sum + gstAmount;
    }, 0);

    // Calculate total: subtotal - discount + tax
    const calculatedTotal = subTotal - totalDiscount + totalTax;
    
    // Calculate round off
    const roundoff = Math.round(calculatedTotal) - calculatedTotal;
    const grandTotal = Math.round(calculatedTotal);

    return { subTotal, totalDiscount, totalTax, roundoff, grandTotal };
  };

  const { subTotal, totalDiscount, totalTax, roundoff, grandTotal } = calculateTotals();

  const handleAddItem = () => {
    if (!selectedMedicine) {
      alert('Please select a medicine');
      return;
    }
    setExpiryDateError(''); // Clear error when opening dialog
    setCurrentItem({
      medicineId: selectedMedicine.id,
      medicineName: selectedMedicine.name,
      batchNumber: '',
      expiryDate: '', // MM/YYYY format
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
        !currentItem.expiryDate || !currentItem.purchasePrice) {
      alert('Please fill all required fields');
      return;
    }

    // Validate expiry date format
    if (expiryDateError) {
      alert(`Expiry date error: ${expiryDateError}`);
      return;
    }

    // Parse expiry date from MM/YYYY format
    const expiryParts = currentItem.expiryDate.trim().split('/');
    if (expiryParts.length !== 2) {
      setExpiryDateError('Format must be MM/YYYY (e.g., 12/2025)');
      alert('Expiry date must be in MM/YYYY format (e.g., 12/2025)');
      return;
    }

    const expiryMonth = parseInt(expiryParts[0]);
    const expiryYear = parseInt(expiryParts[1]);
    const currentYear = new Date().getFullYear();
    
    // Detailed validation
    if (expiryParts[0].length !== 2) {
      setExpiryDateError('Month must be 2 digits (e.g., 01, 02, ..., 12)');
      alert('Month must be 2 digits (e.g., 01, 02, ..., 12)');
      return;
    }
    
    if (expiryParts[1].length !== 4) {
      setExpiryDateError('Year must be 4 digits (e.g., 2025)');
      alert('Year must be 4 digits (e.g., 2025)');
      return;
    }
    
    if (isNaN(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
      setExpiryDateError('Month must be between 01 and 12');
      alert('Invalid month. Month must be between 01 and 12');
      return;
    }
    
    if (isNaN(expiryYear)) {
      setExpiryDateError('Year must be a valid number');
      alert('Invalid year. Year must be a valid number');
      return;
    }
    
    if (expiryYear < currentYear || expiryYear > currentYear + 20) {
      setExpiryDateError(`Year must be between ${currentYear} and ${currentYear + 20}`);
      alert(`Invalid year. Year must be between ${currentYear} and ${currentYear + 20}`);
      return;
    }

    const quantity = typeof currentItem.quantity === 'number' ? currentItem.quantity : parseFloat(String(currentItem.quantity || '0'));
    const freeQuantity = currentItem.freeQuantity ? (typeof currentItem.freeQuantity === 'number' ? currentItem.freeQuantity : parseFloat(String(currentItem.freeQuantity || '0'))) : 0;
    const purchasePrice = typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'));
    const mrp = currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp || '0'))) : 0;
    // Get GST rate from medicine master data (from selectedMedicine)
    const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
    const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
    const discountPercentage = currentItem.discountPercentage ? (typeof currentItem.discountPercentage === 'number' ? currentItem.discountPercentage : parseFloat(String(currentItem.discountPercentage || '0'))) : 0;
    
    // Calculate standard discount from MRP and Purchase Price
    // Formula: Standard Discount = (1 - (Purchase Price * (1 + GST/100) / MRP)) * 100
    let standardDiscount: number | undefined = undefined;
    if (mrp > 0 && purchasePrice > 0) {
      const priceWithGST = purchasePrice * (1 + gstRate / 100);
      standardDiscount = (1 - (priceWithGST / mrp)) * 100;
    } else {
      // Default to 20% if MRP or Purchase Price not available
      standardDiscount = 20;
    }
    
    // Calculate total: (purchasePrice * quantity) - discount + GST
    // Formula: Purchase Price - Discount + GST
    const baseAmount = purchasePrice * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    const amountAfterDiscount = baseAmount - discountAmount;
    const gstAmount = (amountAfterDiscount * gstRate) / 100;
    const totalAmount = amountAfterDiscount + gstAmount;

    // Create expiry date from MM/YYYY format
    const expiryDate = new Date(expiryYear, expiryMonth - 1, 1);

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
      standardDiscount: standardDiscount !== undefined ? standardDiscount : undefined,
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
    setExpiryDateError(''); // Clear error when dialog closes
    setCurrentItem({
      medicineId: '',
      medicineName: '',
      batchNumber: '',
      expiryDate: '',
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
    setExpiryDateError(''); // Clear error when editing
    setCurrentItem({
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      expiryDate: format(expiryDate, 'MM/yyyy'), // Single field in MM/YYYY format
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
      // Check if medicine with same name already exists
      const existingMedicine = medicines?.find(
        m => m.name.toLowerCase().trim() === newMedicineData.name.toLowerCase().trim()
      );
      
      if (existingMedicine) {
        // Medicine already exists - use the existing one
        setSelectedMedicine(existingMedicine);
        setAddMedicineDialog(false);
        setNewMedicineData({ name: '', code: '', type: '', packaging: '', manufacturer: '', gstRate: '5' });
        alert(`Medicine "${existingMedicine.name}" already exists. Selected from existing medicines.`);
        return;
      }

      // Medicine doesn't exist - create new one
      const medicineId = await createMedicineMutation.mutateAsync({
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type, // Store type as category
        unit: newMedicineData.packaging, // Store packaging as unit
        manufacturer: newMedicineData.manufacturer,
        stock: 0,
        currentStock: 0,
        price: 0,
        gstRate: newMedicineData.gstRate ? parseFloat(newMedicineData.gstRate) : 5,
        description: `Packaging: ${newMedicineData.packaging}`,
      });

      const newMedicine = medicines?.find(m => m.id === medicineId) || {
        id: medicineId,
        name: newMedicineData.name,
        code: newMedicineData.code,
        category: newMedicineData.type,
        manufacturer: newMedicineData.manufacturer,
        unit: newMedicineData.packaging,
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
          taxAmount: totalTax,
          discount: totalDiscount > 0 ? totalDiscount : undefined,
          totalAmount: grandTotal,
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
            {totalDiscount > 0 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Discount:</Typography>
                <Typography color="error">-₹{totalDiscount.toFixed(2)}</Typography>
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax:</Typography>
              <Typography>₹{totalTax.toFixed(2)}</Typography>
            </Box>
            {Math.abs(roundoff) > 0.01 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Round Off:</Typography>
                <Typography>{roundoff > 0 ? '+' : ''}₹{roundoff.toFixed(2)}</Typography>
              </Box>
            )}
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between">
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{grandTotal.toFixed(2)}</Typography>
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
                    <TableCell align="right">GST %</TableCell>
                    <TableCell align="right">Discount %</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} align="center">
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
                        <TableCell align="right">
                          {item.gstRate !== undefined ? `${item.gstRate}%` : '-'}
                        </TableCell>
                        <TableCell align="right">
                          {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '-'}
                        </TableCell>
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
      <Dialog open={itemDialog.open} onClose={() => {
        setItemDialog({ open: false, itemIndex: null });
        setExpiryDateError(''); // Clear error when dialog closes
      }} maxWidth="sm" fullWidth>
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
              <TextField
                fullWidth
                label="Expiry Date"
                required
                value={currentItem.expiryDate}
                onChange={(e) => {
                  let value = e.target.value;
                  // Allow only numbers and forward slash
                  value = value.replace(/[^0-9/]/g, '');
                  
                  // Auto-format: insert slash after 2 digits if user types 3 digits without slash
                  if (value.length === 3 && !value.includes('/')) {
                    value = value.substring(0, 2) + '/' + value.substring(2);
                  }
                  
                  // Limit to 7 characters (MM/YYYY)
                  if (value.length <= 7) {
                    setCurrentItem({ ...currentItem, expiryDate: value });
                    
                    // Clear error while typing if format looks correct
                    if (value.length > 0 && !value.includes('/') && value.length <= 2) {
                      setExpiryDateError('');
                    } else if (value.length === 0) {
                      setExpiryDateError('');
                    }
                  }
                }}
                onBlur={() => {
                  // Final validation on blur
                  const value = currentItem.expiryDate?.trim() || '';
                  const currentYear = new Date().getFullYear();
                  
                  if (value.length === 0) {
                    setExpiryDateError(''); // Empty - let required validation handle it
                    return;
                  }
                  
                  const parts = value.split('/');
                  
                  // Check format structure
                  if (parts.length !== 2) {
                    setExpiryDateError('Format must be MM/YYYY (e.g., 12/2025)');
                    return;
                  }
                  
                  const monthStr = parts[0].trim();
                  const yearStr = parts[1].trim();
                  
                  // Check month format and value
                  if (monthStr.length !== 2) {
                    setExpiryDateError('Month must be 2 digits (e.g., 01, 02, ..., 12)');
                    return;
                  }
                  
                  const month = parseInt(monthStr);
                  if (isNaN(month) || month < 1 || month > 12) {
                    setExpiryDateError('Month must be between 01 and 12');
                    return;
                  }
                  
                  // Check year format and value
                  if (yearStr.length !== 4) {
                    setExpiryDateError('Year must be 4 digits (e.g., 2025)');
                    return;
                  }
                  
                  const year = parseInt(yearStr);
                  if (isNaN(year)) {
                    setExpiryDateError('Year must be a valid number');
                    return;
                  }
                  
                  if (year < currentYear || year > currentYear + 20) {
                    setExpiryDateError(`Year must be between ${currentYear} and ${currentYear + 20}`);
                    return;
                  }
                  
                  // All validations passed
                  setExpiryDateError('');
                }}
                placeholder="MM/YYYY"
                error={!!expiryDateError}
                helperText={expiryDateError || "Format: MM/YYYY (e.g., 12/2025)"}
                inputProps={{ maxLength: 7 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={currentItem.mrp}
                onChange={(e) => {
                  const mrpValue = e.target.value;
                  const mrp = mrpValue ? (typeof mrpValue === 'number' ? mrpValue : parseFloat(String(mrpValue || '0'))) : 0;
                  
                  // Get GST rate from medicine master data
                  const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
                  const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                  
                  // Calculate Purchase Price: (MRP * 0.80) / (1 + GST rate/100)
                  // Step 1: Apply 20% standard discount
                  // Step 2: Remove inclusive GST
                  let calculatedPurchasePrice = '';
                  if (mrp > 0) {
                    const afterDiscount = mrp * 0.80;
                    const purchasePrice = afterDiscount / (1 + gstRate / 100);
                    calculatedPurchasePrice = purchasePrice.toFixed(2);
                  }
                  
                  setCurrentItem({ 
                    ...currentItem, 
                    mrp: mrpValue,
                    ...(calculatedPurchasePrice && {
                      purchasePrice: calculatedPurchasePrice,
                      unitPrice: calculatedPurchasePrice,
                    })
                  });
                }}
                InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>₹</Typography> }}
                helperText="Enter MRP to auto-calculate Purchase Price (20% discount + GST removal)"
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
                label="Standard Discount (%)"
                type="number"
                value={(() => {
                  const mrp = currentItem.mrp ? (typeof currentItem.mrp === 'number' ? currentItem.mrp : parseFloat(String(currentItem.mrp || '0'))) : 0;
                  const purchasePrice = currentItem.purchasePrice ? (typeof currentItem.purchasePrice === 'number' ? currentItem.purchasePrice : parseFloat(String(currentItem.purchasePrice || '0'))) : 0;
                  
                  // Get GST rate from medicine master data
                  const selectedMed = medicines?.find(m => m.id === currentItem.medicineId);
                  const gstRate = selectedMed?.gstRate || (currentItem.gstRate ? (typeof currentItem.gstRate === 'number' ? currentItem.gstRate : parseFloat(String(currentItem.gstRate || '0'))) : 5);
                  
                  // Calculate standard discount from MRP and Purchase Price
                  // Formula: Standard Discount = (1 - (Purchase Price * (1 + GST/100) / MRP)) * 100
                  if (mrp > 0 && purchasePrice > 0) {
                    const priceWithGST = purchasePrice * (1 + gstRate / 100);
                    const standardDiscount = (1 - (priceWithGST / mrp)) * 100;
                    return standardDiscount.toFixed(2);
                  }
                  // Default to 20% if MRP or Purchase Price not available
                  return '20.00';
                })()}
                InputProps={{ 
                  readOnly: true
                }}
                helperText="Calculated from MRP and Purchase Price"
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
                  
                  // Formula: Purchase Price - Discount + GST
                  // Step 1: Calculate base amount (Purchase Price * Quantity)
                  const baseAmount = price * qty;
                  // Step 2: Calculate discount amount
                  const discountAmount = (baseAmount * discountPercentage) / 100;
                  // Step 3: Subtract discount from base amount
                  const amountAfterDiscount = baseAmount - discountAmount;
                  // Step 4: Calculate GST on discounted amount
                  const gstAmount = (amountAfterDiscount * gstRate) / 100;
                  // Step 5: Add GST to get total amount
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
              <Autocomplete
                freeSolo
                options={medicines || []}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  return option.name || '';
                }}
                inputValue={newMedicineData.name}
                onInputChange={(_, newInputValue) => {
                  setNewMedicineData({ ...newMedicineData, name: newInputValue });
                }}
                onChange={(_, newValue) => {
                  if (newValue && typeof newValue === 'object') {
                    // User selected existing medicine - auto-fill all fields
                    const selectedMed = newValue as Medicine;
                    setNewMedicineData({
                      name: selectedMed.name || '',
                      code: selectedMed.code || '',
                      type: selectedMed.category || '',
                      packaging: selectedMed.unit || '',
                      manufacturer: selectedMed.manufacturer || '',
                      gstRate: String(selectedMed.gstRate || 5),
                    });
                  } else if (typeof newValue === 'string') {
                    // User typed new name - keep the typed value
                    setNewMedicineData({ ...newMedicineData, name: newValue });
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    label="Medicine Name"
                    required
                    helperText="Start typing to see suggestions or type a new name"
                  />
                )}
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


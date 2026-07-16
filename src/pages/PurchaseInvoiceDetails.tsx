import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Divider,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  InputAdornment,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  ArrowBack,
  Print,
  Search,
  Delete,
  QrCode,
  Payment,
  AttachMoney,
} from '@mui/icons-material';
import { usePurchaseInvoice, useUpdatePurchaseInvoice, useUpdatePurchaseInvoicePayment } from '../hooks/usePurchaseInvoices';
import { format } from 'date-fns';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generatePurchaseInvoice } from '../utils/invoice';
import { PurchaseInvoiceItem } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';
import { setStockBatchNonReturnable } from '../services/inventory';

export const PurchaseInvoiceDetailsPage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = usePurchaseInvoice(invoiceId || '');
  const updateInvoiceMutation = useUpdatePurchaseInvoice();
  const updatePaymentMutation = useUpdatePurchaseInvoicePayment();
  const { alert, confirm, prompt } = useAppDialog();
  const [paymentDialog, setPaymentDialog] = useState({
    open: false,
    amount: '',
    method: 'Cash' as 'Cash' | 'Online',
    transactionId: '',
  });
  const [items, setItems] = useState<PurchaseInvoiceItem[]>([]);
  const [itemDialog, setItemDialog] = useState<{ open: boolean; itemIndex: number | null }>({
    open: false,
    itemIndex: null,
  });
  const [currentItem, setCurrentItem] = useState<{
    medicineName: string;
    batchNumber: string;
    quantity: string;
    freeQuantity: string;
    schemePaidQty: string;
    schemeFreeQty: string;
    expiryDate: string;
    mrp: string;
    standardDiscount: string;
    purchasePrice: string;
    gstRate: string;
    discountPercentage: string;
    nonReturnable: boolean;
  }>({
    medicineName: '',
    batchNumber: '',
    quantity: '',
    freeQuantity: '',
    schemePaidQty: '',
    schemeFreeQty: '',
    expiryDate: '',
    mrp: '',
    standardDiscount: '',
    purchasePrice: '',
    gstRate: '',
    discountPercentage: '',
    nonReturnable: false,
  });

  useEffect(() => {
    if (invoice?.items) {
      setItems(invoice.items);
    }
  }, [invoice]);

  const toMonthYearInput = (dateValue?: Date | any): string => {
    if (!dateValue) return '';
    const d = dateValue instanceof Date ? dateValue : dateValue?.toDate?.() || new Date(dateValue);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return format(d, 'MM/yyyy');
  };

  const parseDateFromMonthYearInput = (value: string): Date | undefined => {
    if (!value) return undefined;
    const [month, year] = value.split('/').map(Number);
    if (!year || !month || month < 1 || month > 12) return undefined;
    return new Date(year, month - 1, 1);
  };

  const parseNumber = (value: string): number => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const getPurchasePriceFromItem = (item: PurchaseInvoiceItem) => {
    const mrp = item.mrp || 0;
    const gstRate = item.gstRate || 5;
    const standardDiscount = item.standardDiscount ?? 20;

    if (mrp > 0) {
      const afterStandardDiscount = mrp * (1 - standardDiscount / 100);
      return afterStandardDiscount / (1 + gstRate / 100);
    }

    return item.purchasePrice || 0;
  };

  const calculateTotals = (invoiceItems: PurchaseInvoiceItem[]) => {
    const subTotal = invoiceItems.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const purchasePrice = getPurchasePriceFromItem(item);
      return sum + purchasePrice * quantity;
    }, 0);

    const totalDiscount = invoiceItems.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      const discountPercentage = item.discountPercentage || 0;
      const purchasePrice = getPurchasePriceFromItem(item);
      const totalAmount = purchasePrice * quantity;
      return sum + (totalAmount * discountPercentage) / 100;
    }, 0);

    const amountAfterDiscount = subTotal - totalDiscount;
    const avgGstRate = invoiceItems.length > 0
      ? invoiceItems.reduce((sum, item) => sum + (item.gstRate || 5), 0) / invoiceItems.length
      : 5;
    const totalTax = (amountAfterDiscount * avgGstRate) / 100;
    const calculatedTotal = subTotal - totalDiscount + totalTax;
    const roundoff = Math.round(calculatedTotal) - calculatedTotal;
    const grandTotal = Math.round(calculatedTotal);

    return { subTotal, totalDiscount, totalTax, roundoff, grandTotal };
  };

  const handleEditItem = (index: number) => {
    const item = items[index];
    setCurrentItem({
      medicineName: item.medicineName || '',
      batchNumber: item.batchNumber || '',
      quantity: String(item.quantity ?? ''),
      freeQuantity: item.freeQuantity !== undefined ? String(item.freeQuantity) : '',
      schemePaidQty: item.schemePaidQty !== undefined ? String(item.schemePaidQty) : '',
      schemeFreeQty: item.schemeFreeQty !== undefined ? String(item.schemeFreeQty) : '',
      expiryDate: toMonthYearInput(item.expiryDate),
      mrp: item.mrp !== undefined ? String(item.mrp) : '',
      standardDiscount: item.standardDiscount !== undefined ? String(item.standardDiscount) : '',
      purchasePrice: String(item.purchasePrice ?? ''),
      gstRate: item.gstRate !== undefined ? String(item.gstRate) : '',
      discountPercentage: item.discountPercentage !== undefined ? String(item.discountPercentage) : '',
      nonReturnable: item.nonReturnable === true,
    });
    setItemDialog({ open: true, itemIndex: index });
  };

  const persistItems = async (updatedItems: PurchaseInvoiceItem[]) => {
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    const { subTotal, totalDiscount, totalTax, grandTotal } = calculateTotals(updatedItems);
    await updateInvoiceMutation.mutateAsync({
      invoiceId: invoice.id,
      invoiceData: {
        items: updatedItems,
        subTotal,
        taxAmount: totalTax,
        discount: totalDiscount > 0 ? totalDiscount : undefined,
        totalAmount: grandTotal,
      },
    });
    setItems(updatedItems);
  };

  const handleDeleteItem = async (index: number) => {
    const updatedItems = items.filter((_, i) => i !== index);
    if (updatedItems.length === 0) {
      await alert('Invoice must have at least one item.', { severity: 'warning' });
      return;
    }
    try {
      await persistItems(updatedItems);
    } catch (error: any) {
      await alert(error?.message || 'Failed to delete item', { severity: 'error' });
    }
  };

  const handleSaveItem = async () => {
    if (itemDialog.itemIndex === null) return;
    if (!currentItem.batchNumber || !currentItem.quantity || !currentItem.purchasePrice || !currentItem.expiryDate) {
      await alert('Please fill batch, quantity, expiry and purchase price.', { severity: 'warning' });
      return;
    }

    const oldItem = items[itemDialog.itemIndex];
    const quantity = parseNumber(currentItem.quantity);
    const freeQuantity = currentItem.freeQuantity ? parseNumber(currentItem.freeQuantity) : undefined;
    const mrp = currentItem.mrp ? parseNumber(currentItem.mrp) : undefined;
    const standardDiscount = currentItem.standardDiscount ? parseNumber(currentItem.standardDiscount) : undefined;
    const purchasePrice = parseNumber(currentItem.purchasePrice);
    const gstRate = currentItem.gstRate ? parseNumber(currentItem.gstRate) : undefined;
    const discountPercentage = currentItem.discountPercentage
      ? parseNumber(currentItem.discountPercentage)
      : undefined;
    const spRaw = currentItem.schemePaidQty ? Math.floor(parseNumber(currentItem.schemePaidQty)) : NaN;
    const sfRaw = currentItem.schemeFreeQty ? Math.floor(parseNumber(currentItem.schemeFreeQty)) : NaN;
    const schemePaidQty =
      !isNaN(spRaw) && !isNaN(sfRaw) && spRaw > 0 && sfRaw > 0 ? spRaw : undefined;
    const schemeFreeQty = schemePaidQty != null ? sfRaw : undefined;
    const expiryDate = parseDateFromMonthYearInput(currentItem.expiryDate);

    const totalAmount = purchasePrice * quantity;
    const updatedItem: PurchaseInvoiceItem = {
      medicineId: oldItem.medicineId,
      medicineName: currentItem.medicineName || oldItem.medicineName,
      batchNumber: currentItem.batchNumber,
      quantity,
      purchasePrice,
      unitPrice: purchasePrice,
      totalAmount,
      expiryDate: expiryDate || oldItem.expiryDate,
      ...(oldItem.mfgDate ? { mfgDate: oldItem.mfgDate } : {}),
      ...(freeQuantity !== undefined ? { freeQuantity } : {}),
      ...(schemePaidQty != null && schemeFreeQty != null ? { schemePaidQty, schemeFreeQty } : {}),
      ...(mrp !== undefined ? { mrp } : {}),
      ...(standardDiscount !== undefined ? { standardDiscount } : {}),
      ...(gstRate !== undefined ? { gstRate } : {}),
      ...(discountPercentage !== undefined ? { discountPercentage } : {}),
      ...(oldItem.qrCode ? { qrCode: oldItem.qrCode } : {}),
      ...(currentItem.nonReturnable === true ? { nonReturnable: true } : {}),
    };

    const updatedItems = [...items];
    updatedItems[itemDialog.itemIndex] = updatedItem;

    try {
      await persistItems(updatedItems);
      if (updatedItem.medicineId && updatedItem.batchNumber) {
        try {
          await setStockBatchNonReturnable(
            updatedItem.medicineId,
            updatedItem.batchNumber,
            updatedItem.nonReturnable === true
          );
        } catch (syncErr) {
          console.warn('Failed to sync non-returnable flag to inventory batch:', syncErr);
        }
      }
      setItemDialog({ open: false, itemIndex: null });
    } catch (error: any) {
      await alert(error?.message || 'Failed to update item', { severity: 'error' });
    }
  };

  const { subTotal: recalculatedSubTotal, totalDiscount: recalculatedDiscount, totalTax: recalculatedTaxAmount, roundoff, grandTotal } =
    useMemo(() => calculateTotals(items), [items]);

  if (isLoading) return <Loading message="Loading invoice..." />;
  if (!invoice) return <Typography>Invoice not found</Typography>;

  // Calculate subtotal: sum of all "Total" column values (Price * Quantity)
  // Price is calculated from MRP using item standardDiscount (fallback 20%)
  // Use recalculated values or fall back to stored values
  const displaySubTotal = recalculatedSubTotal > 0 ? recalculatedSubTotal : invoice.subTotal;
  const displayDiscount = recalculatedDiscount > 0 ? recalculatedDiscount : (invoice.discount || 0);
  const displayTaxAmount = recalculatedTaxAmount > 0 ? recalculatedTaxAmount : invoice.taxAmount;
  const calculatedTotal = displaySubTotal - displayDiscount + displayTaxAmount;
  const invoiceTotal = invoice.totalAmount ?? grandTotal;
  const paidAmount = invoice.paidAmount ?? 0;
  const dueAmount = Math.max(0, invoiceTotal - paidAmount);

  return (
    <Box>
      <Breadcrumbs items={[
        { label: 'Purchase Invoices', path: '/purchases' },
        { label: `Invoice #${invoice.invoiceNumber}` }
      ]} />
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/purchases')} sx={{ mr: 2 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">Purchase Invoice #{invoice.invoiceNumber}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button 
          variant="outlined" 
          startIcon={<Print />} 
          onClick={() => {
            if (invoice) {
              generatePurchaseInvoice(invoice).catch(async (err) => {
                console.error('Error generating invoice:', err);
                await alert('Failed to generate invoice. Please try again.', { severity: 'error' });
              });
            }
          }}
        >
          Print Invoice
        </Button>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Items</Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Free Qty</TableCell>
                    <TableCell align="center">Scheme</TableCell>
                    <TableCell align="center">NR</TableCell>
                    <TableCell align="right">Total Qty</TableCell>
                    <TableCell align="right">MRP</TableCell>
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">GST %</TableCell>
                    <TableCell align="right">Disc %</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item, index) => {
                    const mrp = item.mrp || 0;
                    const purchasePrice = getPurchasePriceFromItem(item);
                    
                    // Total = Price * Quantity (simple calculation for display)
                    const total = purchasePrice * (item.quantity || 0);
                    
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">{item.medicineName}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            {item.mfgDate && (
                              <>MFG: {format(item.mfgDate instanceof Date ? item.mfgDate : item.mfgDate.toDate(), 'MM/yyyy')} | </>
                            )}
                            Exp: {item.expiryDate ? format(item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate(), 'MM/yyyy') : 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell>{item.batchNumber}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">
                          {item.freeQuantity !== undefined && item.freeQuantity !== null && item.freeQuantity > 0 ? item.freeQuantity : '-'}
                        </TableCell>
                        <TableCell align="center">
                          {formatPurchaseSchemeLabel(item.schemePaidQty, item.schemeFreeQty)}
                        </TableCell>
                        <TableCell align="center">
                          {item.nonReturnable === true ? (
                            <Chip size="small" label="NR" color="warning" variant="outlined" title="Non-returnable" />
                          ) : (
                            <Typography variant="caption" color="textSecondary">—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="medium">
                            {item.quantity + (item.freeQuantity || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {mrp > 0 ? `₹${mrp.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell align="right">₹{purchasePrice.toFixed(2)}</TableCell>
                        <TableCell align="right">
                          {item.gstRate !== undefined ? `${item.gstRate}%` : '5%'}
                        </TableCell>
                        <TableCell align="right">
                          {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '0%'}
                        </TableCell>
                        <TableCell align="right">₹{total.toFixed(2)}</TableCell>
                        <TableCell align="center">
                          {item.qrCode && item.qrCode.trim() !== '' ? (
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                // Open QR code in popup
                                const newWindow = window.open();
                                if (newWindow) {
                                  newWindow.document.write(`
                                    <html>
                                      <head><title>QR Code - ${item.medicineName}</title></head>
                                      <body style="text-align: center; padding: 20px;">
                                        <h2>${item.medicineName}</h2>
                                        <img src="${item.qrCode}" alt="QR Code" style="max-width: 400px; margin: 20px 0;" />
                                        <br/>
                                        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px;">Print / Download</button>
                                      </body>
                                    </html>
                                  `);
                                }
                              }}
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
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteItem(index)}
                            disabled={updateInvoiceMutation.isPending}
                          >
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Invoice Details</Typography>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Invoice Number:</Typography>
              <Typography fontWeight="medium">{invoice.invoiceNumber}</Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Date:</Typography>
              <Typography>
                {format(invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate), 'MMM dd, yyyy')}
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography color="textSecondary">Vendor:</Typography>
              <Typography fontWeight="medium">{invoice.vendorName}</Typography>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Subtotal:</Typography>
              <Typography>₹{displaySubTotal.toFixed(2)}</Typography>
            </Box>
            {displayDiscount > 0 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Discount:</Typography>
                <Typography color="error">-₹{displayDiscount.toFixed(2)}</Typography>
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax:</Typography>
              <Typography>₹{displayTaxAmount.toFixed(2)}</Typography>
            </Box>
            {Math.abs(roundoff) > 0.01 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Round Off:</Typography>
                <Typography>{roundoff > 0 ? '+' : ''}₹{roundoff.toFixed(2)}</Typography>
              </Box>
            )}
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{grandTotal.toFixed(2)}</Typography>
            </Box>

            <Card sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderLeft: 4, borderLeftColor: (invoice.paymentStatus === 'Paid' ? 'success.main' : invoice.paymentStatus === 'Partial' ? 'warning.main' : 'error.main') }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Typography variant="subtitle1" fontWeight="600">Payment</Typography>
                  <Chip
                    size="small"
                    label={invoice.paymentStatus || 'Unpaid'}
                    color={
                      invoice.paymentStatus === 'Paid' ? 'success' :
                      invoice.paymentStatus === 'Partial' ? 'warning' : 'error'
                    }
                  />
                </Box>

                <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, mb: 2 }}>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2" color="textSecondary">Invoice Total</Typography>
                    <Typography variant="body2" fontWeight="bold">₹{invoiceTotal.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Typography variant="body2" color="textSecondary">Paid</Typography>
                    <Typography variant="body2" color="success.main">₹{paidAmount.toFixed(2)}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="textSecondary">Due</Typography>
                    <Typography variant="body2" fontWeight="bold" color={dueAmount > 0 ? 'error.main' : 'success.main'}>
                      ₹{dueAmount.toFixed(2)}
                    </Typography>
                  </Box>
                  {invoice.paymentMethod && (
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                      Method: {invoice.paymentMethod}
                    </Typography>
                  )}
                  {invoice.transactionId && (
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                      Txn ID: {invoice.transactionId}
                    </Typography>
                  )}
                </Box>

                {(invoice.paymentStatus === 'Unpaid' || !invoice.paymentStatus || invoice.paymentStatus === 'Partial') ? (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    startIcon={<Payment />}
                    onClick={() => {
                      setPaymentDialog({
                        open: true,
                        amount: String(dueAmount > 0 ? dueAmount : invoiceTotal),
                        method: (invoice.paymentMethod === 'Cash' || invoice.paymentMethod === 'Online'
                          ? invoice.paymentMethod
                          : 'Cash') as 'Cash' | 'Online',
                        transactionId: invoice.transactionId || '',
                      });
                    }}
                    disabled={updatePaymentMutation.isPending}
                    sx={{ mb: 1 }}
                  >
                    Record Payment
                  </Button>
                ) : (
                  <Button
                    fullWidth
                    variant="outlined"
                    size="small"
                    color="inherit"
                    onClick={() => updatePaymentMutation.mutate({
                      invoiceId: invoice.id,
                      vendorId: invoice.vendorId,
                      paymentStatus: 'Unpaid',
                    })}
                    disabled={updatePaymentMutation.isPending}
                  >
                    Mark Unpaid
                  </Button>
                )}
              </CardContent>
            </Card>

            {invoice.notes && (
              <Card variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" gutterBottom>Notes</Typography>
                  <Typography variant="body2">{invoice.notes}</Typography>
                </CardContent>
              </Card>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Dialog
        open={itemDialog.open}
        onClose={() => setItemDialog({ open: false, itemIndex: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Edit Item - {currentItem.medicineName || (itemDialog.itemIndex !== null ? items[itemDialog.itemIndex]?.medicineName : '')}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Batch Number"
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
                onChange={(e) => setCurrentItem({ ...currentItem, quantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Free quantity (this bill)"
                type="number"
                helperText="Extra strips/units free on this invoice (stock)"
                value={currentItem.freeQuantity}
                onChange={(e) => setCurrentItem({ ...currentItem, freeQuantity: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expiry Date"
                required
                placeholder="MM/YYYY"
                value={currentItem.expiryDate}
                onChange={(e) => setCurrentItem({ ...currentItem, expiryDate: e.target.value })}
                helperText="Format: MM/YYYY (e.g., 12/2025)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="MRP"
                type="number"
                value={currentItem.mrp}
                onChange={(e) => setCurrentItem({ ...currentItem, mrp: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Standard Discount (%)"
                type="number"
                value={currentItem.standardDiscount}
                onChange={(e) => setCurrentItem({ ...currentItem, standardDiscount: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Purchase Price"
                type="number"
                value={currentItem.purchasePrice}
                onChange={(e) => setCurrentItem({ ...currentItem, purchasePrice: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="GST Rate (%)"
                type="number"
                value={currentItem.gstRate}
                onChange={(e) => setCurrentItem({ ...currentItem, gstRate: e.target.value })}
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Scheme - pay for (qty)"
                type="number"
                value={currentItem.schemePaidQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemePaidQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Scheme - get free (qty)"
                type="number"
                value={currentItem.schemeFreeQty}
                onChange={(e) => setCurrentItem({ ...currentItem, schemeFreeQty: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={currentItem.nonReturnable === true}
                    onChange={(e) =>
                      setCurrentItem({ ...currentItem, nonReturnable: e.target.checked })
                    }
                  />
                }
                label="Non-returnable (retailer cannot return this batch)"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialog({ open: false, itemIndex: null })}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveItem}
            disabled={updateInvoiceMutation.isPending}
          >
            {updateInvoiceMutation.isPending ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={paymentDialog.open}
        onClose={() => setPaymentDialog({ ...paymentDialog, open: false, transactionId: '' })}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle sx={{ pb: 0 }}>Record Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Amount"
              type="number"
              value={paymentDialog.amount}
              onChange={(e) => setPaymentDialog({ ...paymentDialog, amount: e.target.value })}
              InputProps={{
                startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                inputProps: { min: 0, max: dueAmount, step: 0.01 },
              }}
              helperText={`Due: ₹${dueAmount.toFixed(2)} · Invoice total: ₹${invoiceTotal.toFixed(2)}`}
              sx={{ mb: 2 }}
            />
            <Typography variant="subtitle2" color="textSecondary" gutterBottom sx={{ mb: 1 }}>
              Payment method
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={paymentDialog.method}
              onChange={(_, value) => {
                if (value) setPaymentDialog({ ...paymentDialog, method: value });
              }}
              sx={{ mb: 1 }}
            >
              <ToggleButton value="Cash" sx={{ py: 1.25 }}>
                <AttachMoney sx={{ mr: 0.5, fontSize: 18 }} /> Cash
              </ToggleButton>
              <ToggleButton value="Online" sx={{ py: 1.25 }}>
                <Payment sx={{ mr: 0.5, fontSize: 18 }} /> Online
              </ToggleButton>
            </ToggleButtonGroup>
            {paymentDialog.method === 'Online' && (
              <TextField
                fullWidth
                label="Transaction ID"
                placeholder="e.g. UPI ref, bank transfer ref"
                value={paymentDialog.transactionId}
                onChange={(e) => setPaymentDialog({ ...paymentDialog, transactionId: e.target.value })}
                helperText="Optional - for UPI, bank transfer, or card payment reference"
                sx={{ mb: 2 }}
              />
            )}
            <Box display="flex" gap={1} mt={2}>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() => setPaymentDialog({ ...paymentDialog, amount: String(dueAmount) })}
              >
                Pay full due
              </Button>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={() =>
                  setPaymentDialog({
                    ...paymentDialog,
                    amount: String(Math.min(dueAmount, invoiceTotal * 0.5)),
                  })
                }
              >
                50%
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() =>
              setPaymentDialog({ open: false, amount: '', method: 'Cash', transactionId: '' })
            }
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !paymentDialog.amount ||
              parseFloat(paymentDialog.amount) <= 0 ||
              parseFloat(paymentDialog.amount) > dueAmount + 0.01 ||
              updatePaymentMutation.isPending
            }
            onClick={async () => {
              if (!invoice) return;
              const paymentNow = parseFloat(paymentDialog.amount) || 0;
              const nextPaid = Math.min(invoiceTotal, paidAmount + paymentNow);
              const isPaid = nextPaid >= invoiceTotal - 0.01;
              try {
                await updatePaymentMutation.mutateAsync({
                  invoiceId: invoice.id,
                  vendorId: invoice.vendorId,
                  paymentStatus: isPaid ? 'Paid' : 'Partial',
                  paymentMethod: paymentDialog.method,
                  paidAmount: nextPaid,
                  transactionId:
                    paymentDialog.method === 'Online' ? paymentDialog.transactionId : undefined,
                });
                setPaymentDialog({ open: false, amount: '', method: 'Cash', transactionId: '' });
                await alert('Payment recorded.', { severity: 'success' });
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                await alert(`Failed to record payment: ${message}`, { severity: 'error' });
              }
            }}
          >
            {updatePaymentMutation.isPending ? <CircularProgress size={24} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};


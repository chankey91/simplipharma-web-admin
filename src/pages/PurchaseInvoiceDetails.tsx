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
} from '@mui/material';
import {
  ArrowBack,
  Print,
  Search,
  Delete,
  QrCode,
} from '@mui/icons-material';
import { usePurchaseInvoice, useUpdatePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { format } from 'date-fns';
import { formatPurchaseSchemeLabel } from '../utils/purchaseSchemeLabel';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generatePurchaseInvoice } from '../utils/invoice';
import { PurchaseInvoiceItem } from '../types';

export const PurchaseInvoiceDetailsPage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = usePurchaseInvoice(invoiceId || '');
  const updateInvoiceMutation = useUpdatePurchaseInvoice();
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
      alert('Invoice must have at least one item.');
      return;
    }
    try {
      await persistItems(updatedItems);
    } catch (error: any) {
      alert(error?.message || 'Failed to delete item');
    }
  };

  const handleSaveItem = async () => {
    if (itemDialog.itemIndex === null) return;
    if (!currentItem.batchNumber || !currentItem.quantity || !currentItem.purchasePrice || !currentItem.expiryDate) {
      alert('Please fill batch, quantity, expiry and purchase price.');
      return;
    }

    const oldItem = items[itemDialog.itemIndex];
    const quantity = parseNumber(currentItem.quantity);
    const freeQuantity = currentItem.freeQuantity ? parseNumber(currentItem.freeQuantity) : undefined;
    const mrp = currentItem.mrp ? parseNumber(currentItem.mrp) : undefined;
    const standardDiscount = currentItem.standardDiscount ? parseNumber(currentItem.standardDiscount) : undefined;
    const purchasePrice = parseNumber(currentItem.purchasePrice);
    const gstRate = currentItem.gstRate ? parseNumber(currentItem.gstRate) : undefined;
    const discountPercentage = currentItem.discountPercentage ? parseNumber(currentItem.discountPercentage) : undefined;
    const schemePaidQty = currentItem.schemePaidQty ? Math.floor(parseNumber(currentItem.schemePaidQty)) : undefined;
    const schemeFreeQty = currentItem.schemeFreeQty ? Math.floor(parseNumber(currentItem.schemeFreeQty)) : undefined;
    const expiryDate = parseDateFromMonthYearInput(currentItem.expiryDate);

    const totalAmount = purchasePrice * quantity;
    const updatedItem: PurchaseInvoiceItem = {
      ...oldItem,
      medicineName: currentItem.medicineName || oldItem.medicineName,
      batchNumber: currentItem.batchNumber,
      quantity,
      freeQuantity,
      schemePaidQty,
      schemeFreeQty,
      expiryDate: expiryDate || oldItem.expiryDate,
      mrp,
      standardDiscount,
      purchasePrice,
      unitPrice: purchasePrice,
      gstRate,
      discountPercentage,
      totalAmount,
    };

    const updatedItems = [...items];
    updatedItems[itemDialog.itemIndex] = updatedItem;

    try {
      await persistItems(updatedItems);
      setItemDialog({ open: false, itemIndex: null });
    } catch (error: any) {
      alert(error?.message || 'Failed to update item');
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
              generatePurchaseInvoice(invoice).catch(err => {
                console.error('Error generating invoice:', err);
                alert('Failed to generate invoice. Please try again.');
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
            <Chip
              label={invoice.paymentStatus}
              color={
                invoice.paymentStatus === 'Paid' ? 'success' :
                invoice.paymentStatus === 'Partial' ? 'warning' : 'error'
              }
              sx={{ width: '100%', mb: 2 }}
            />
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
    </Box>
  );
};


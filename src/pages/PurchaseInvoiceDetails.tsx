import React from 'react';
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
} from '@mui/material';
import {
  ArrowBack,
  Print,
  Receipt,
  QrCode,
} from '@mui/icons-material';
import { usePurchaseInvoice } from '../hooks/usePurchaseInvoices';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generatePurchaseInvoice } from '../utils/invoice';

export const PurchaseInvoiceDetailsPage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = usePurchaseInvoice(invoiceId || '');

  if (isLoading) return <Loading message="Loading invoice..." />;
  if (!invoice) return <Typography>Invoice not found</Typography>;

  // Calculate subtotal: sum of (price * quantity) for all items
  const recalculatedSubTotal = invoice.items.reduce((sum, item) => {
    const quantity = item.quantity || 0;
    const purchasePrice = item.purchasePrice || 0;
    return sum + (purchasePrice * quantity);
  }, 0);

  // Calculate total discount amount: sum of discount amounts from discount percentage
  const recalculatedDiscount = invoice.items.reduce((sum, item) => {
    const quantity = item.quantity || 0;
    const purchasePrice = item.purchasePrice || 0;
    const discountPercentage = item.discountPercentage || 0;
    
    const baseAmount = purchasePrice * quantity;
    const discountAmount = (baseAmount * discountPercentage) / 100;
    
    return sum + discountAmount;
  }, 0);

  // Calculate total tax amount: sum of GST amounts from GST rate
  const recalculatedTaxAmount = invoice.items.reduce((sum, item) => {
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

  // Use recalculated values or fall back to stored values
  const displaySubTotal = recalculatedSubTotal > 0 ? recalculatedSubTotal : invoice.subTotal;
  const displayDiscount = recalculatedDiscount > 0 ? recalculatedDiscount : (invoice.discount || 0);
  const displayTaxAmount = recalculatedTaxAmount > 0 ? recalculatedTaxAmount : invoice.taxAmount;
  const displayTotal = displaySubTotal - displayDiscount + displayTaxAmount;

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
              generatePurchaseInvoice(invoice);
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
                    <TableCell align="right">Total Qty</TableCell>
                    <TableCell align="right">Price</TableCell>
                    {invoice.items.some(item => item.gstRate !== undefined) && (
                      <TableCell align="right">GST %</TableCell>
                    )}
                    {invoice.items.some(item => item.discountPercentage !== undefined) && (
                      <TableCell align="right">Disc %</TableCell>
                    )}
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">QR Code</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoice.items.map((item, index) => (
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
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight="medium">
                          {item.quantity + (item.freeQuantity || 0)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">₹{item.purchasePrice.toFixed(2)}</TableCell>
                      {invoice.items.some(i => i.gstRate !== undefined) && (
                        <TableCell align="right">
                          {item.gstRate !== undefined ? `${item.gstRate}%` : '-'}
                        </TableCell>
                      )}
                      {invoice.items.some(i => i.discountPercentage !== undefined) && (
                        <TableCell align="right">
                          {item.discountPercentage !== undefined ? `${item.discountPercentage}%` : '-'}
                        </TableCell>
                      )}
                      <TableCell align="right">₹{item.totalAmount.toFixed(2)}</TableCell>
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
                    </TableRow>
                  ))}
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
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{displayTotal.toFixed(2)}</Typography>
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
    </Box>
  );
};


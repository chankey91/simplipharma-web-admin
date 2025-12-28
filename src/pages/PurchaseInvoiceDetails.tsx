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
                    <TableCell align="right">Price</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoice.items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">{item.medicineName}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          MFG: {item.mfgDate ? format(item.mfgDate instanceof Date ? item.mfgDate : item.mfgDate.toDate(), 'MM/yy') : 'N/A'} | 
                          Exp: {item.expiryDate ? format(item.expiryDate instanceof Date ? item.expiryDate : item.expiryDate.toDate(), 'MM/yy') : 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell>{item.batchNumber}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">₹{item.purchasePrice.toFixed(2)}</TableCell>
                      <TableCell align="right">₹{item.totalAmount.toFixed(2)}</TableCell>
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
              <Typography>₹{invoice.subTotal.toFixed(2)}</Typography>
            </Box>
            {invoice.discount && invoice.discount > 0 && (
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="textSecondary">Discount:</Typography>
                <Typography color="error">-₹{invoice.discount.toFixed(2)}</Typography>
              </Box>
            )}
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography color="textSecondary">Tax ({invoice.taxPercentage || 18}%):</Typography>
              <Typography>₹{invoice.taxAmount.toFixed(2)}</Typography>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" mb={2}>
              <Typography variant="h6">Total:</Typography>
              <Typography variant="h6">₹{invoice.totalAmount.toFixed(2)}</Typography>
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


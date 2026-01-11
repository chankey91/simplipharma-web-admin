import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
  Pagination,
  Button,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Search,
  Download,
  Receipt,
  ShoppingCart,
} from '@mui/icons-material';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useOrders } from '../hooks/useOrders';
import { PurchaseInvoice, Order } from '../types';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { generatePurchaseInvoice, generateOrderInvoice } from '../utils/invoice';

interface InvoiceItem {
  id: string;
  type: 'purchase' | 'order';
  invoiceNumber: string;
  date: Date;
  vendorOrStore: string;
  amount: number;
  status: string;
  purchaseInvoice?: PurchaseInvoice;
  order?: Order;
}

export const InvoicesPage: React.FC = () => {
  const { data: purchaseInvoices, isLoading: purchaseLoading } = usePurchaseInvoices();
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'order'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [tabValue, setTabValue] = useState(0);

  // Combine purchase invoices and orders into a single list
  const allInvoices: InvoiceItem[] = useMemo(() => {
    const items: InvoiceItem[] = [];

    // Add purchase invoices
    if (purchaseInvoices) {
      purchaseInvoices.forEach((inv) => {
        items.push({
          id: inv.id,
          type: 'purchase',
          invoiceNumber: inv.invoiceNumber,
          date: inv.invoiceDate,
          vendorOrStore: inv.vendorName || 'N/A',
          amount: inv.totalAmount || 0,
          status: inv.paymentStatus || 'Unpaid',
          purchaseInvoice: inv,
        });
      });
    }

    // Add orders (only fulfilled orders have invoices)
    if (orders) {
      orders
        .filter((order) => order.status !== 'Pending' && order.status !== 'Cancelled')
        .forEach((order) => {
          items.push({
            id: order.id,
            type: 'order',
            invoiceNumber: `ORD-${order.id.slice(0, 8)}`,
            date: order.orderDate,
            vendorOrStore: order.retailerEmail || 'N/A',
            amount: order.totalAmount || 0,
            status: order.paymentStatus || 'Unpaid',
            order: order,
          });
        });
    }

    // Sort by date (newest first)
    return items.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [purchaseInvoices, orders]);

  const filteredInvoices = allInvoices.filter((invoice) => {
    const matchesSearch =
      invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.vendorOrStore.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'all' || invoice.type === typeFilter;

    const matchesStatus = statusFilter === 'All' || invoice.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  // Pagination
  const totalPages = Math.ceil(filteredInvoices.length / rowsPerPage);
  const paginatedInvoices = filteredInvoices.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleDownload = async (invoice: InvoiceItem) => {
    try {
      if (invoice.type === 'purchase' && invoice.purchaseInvoice) {
        await generatePurchaseInvoice(invoice.purchaseInvoice);
      } else if (invoice.type === 'order' && invoice.order) {
        await generateOrderInvoice(invoice.order);
      }
    } catch (error: any) {
      alert(`Failed to download invoice: ${error.message || 'Unknown error'}`);
    }
  };

  const totalAmount = allInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const purchaseCount = allInvoices.filter((inv) => inv.type === 'purchase').length;
  const orderCount = allInvoices.filter((inv) => inv.type === 'order').length;
  const paidCount = allInvoices.filter((inv) => inv.status === 'Paid').length;
  const unpaidCount = allInvoices.filter((inv) => inv.status === 'Unpaid').length;

  if (purchaseLoading || ordersLoading) return <Loading message="Loading invoices..." />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Invoices</Typography>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total Invoices
              </Typography>
              <Typography variant="h4">{allInvoices.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Purchase Invoices
              </Typography>
              <Typography variant="h4">{purchaseCount}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Order Invoices
              </Typography>
              <Typography variant="h4">{orderCount}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total Amount
              </Typography>
              <Typography variant="h4">₹{totalAmount.toLocaleString()}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              placeholder="Search by invoice number or vendor/store..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={typeFilter}
                label="Type"
                onChange={(e) => {
                  setTypeFilter(e.target.value as 'all' | 'purchase' | 'order');
                  setPage(1);
                }}
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="purchase">Purchase Invoices</MenuItem>
                <MenuItem value="order">Order Invoices</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Payment Status</InputLabel>
              <Select
                value={statusFilter}
                label="Payment Status"
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Status</MenuItem>
                <MenuItem value="Paid">Paid</MenuItem>
                <MenuItem value="Unpaid">Unpaid</MenuItem>
                <MenuItem value="Partial">Partial</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Invoice Number</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Vendor/Store</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>
                    No invoices found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedInvoices.map((invoice) => (
                <TableRow key={`${invoice.type}-${invoice.id}`} hover>
                  <TableCell>
                    <Chip
                      icon={invoice.type === 'purchase' ? <Receipt /> : <ShoppingCart />}
                      label={invoice.type === 'purchase' ? 'Purchase' : 'Order'}
                      size="small"
                      color={invoice.type === 'purchase' ? 'primary' : 'secondary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {invoice.invoiceNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{format(invoice.date, 'MMM dd, yyyy')}</TableCell>
                  <TableCell>{invoice.vendorOrStore}</TableCell>
                  <TableCell align="right">₹{invoice.amount.toFixed(2)}</TableCell>
                  <TableCell>
                    <Chip
                      label={invoice.status}
                      size="small"
                      color={
                        invoice.status === 'Paid'
                          ? 'success'
                          : invoice.status === 'Partial'
                          ? 'warning'
                          : 'error'
                      }
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => handleDownload(invoice)}
                      title="Download Invoice"
                    >
                      <Download />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {filteredInvoices.length > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * rowsPerPage + 1} to{' '}
            {Math.min(page * rowsPerPage, filteredInvoices.length)} of{' '}
            {filteredInvoices.length} invoices
          </Typography>
        </Box>
      )}
    </Box>
  );
};


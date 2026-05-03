import React, { useMemo, useState } from 'react';
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
  Button,
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
} from '@mui/material';
import {
  Search,
  Add,
  Visibility,
  Receipt,
} from '@mui/icons-material';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';

export const PurchaseInvoicesPage: React.FC = () => {
  const { data: invoices, isLoading } = usePurchaseInvoices();
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);

  const { sortKey, sortDirection, requestSort } = useTableSort('invoiceDate', 'desc');

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((invoice) => {
      const matchesSearch =
        invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.items.some((item) => item.medicineName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === 'All' || invoice.paymentStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchTerm, statusFilter]);

  const sortedInvoices = useMemo(() => {
    const list = [...filteredInvoices];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'invoiceNumber':
          cmp = compareAsc(a.invoiceNumber, b.invoiceNumber);
          break;
        case 'invoiceDate':
          cmp = compareAsc(toTimeMs(a.invoiceDate), toTimeMs(b.invoiceDate));
          break;
        case 'vendorName':
          cmp = compareAsc(a.vendorName, b.vendorName);
          break;
        case 'items':
          cmp = compareAsc(a.items.length, b.items.length);
          break;
        case 'totalAmount':
          cmp = compareAsc(a.totalAmount, b.totalAmount);
          break;
        case 'paymentStatus':
          cmp = compareAsc(a.paymentStatus, b.paymentStatus);
          break;
        default:
          cmp = compareAsc(toTimeMs(a.invoiceDate), toTimeMs(b.invoiceDate));
      }
      if (cmp !== 0) return applyDirection(cmp, sortDirection);
      return applyDirection(
        compareAsc(a.invoiceNumber, b.invoiceNumber),
        sortDirection
      );
    });
    return list;
  }, [filteredInvoices, sortKey, sortDirection]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  // Pagination
  const totalPages = Math.ceil(sortedInvoices.length / rowsPerPage);
  const paginatedInvoices = sortedInvoices.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const totalPurchases = invoices?.reduce((sum, inv) => sum + inv.totalAmount, 0) || 0;
  const paidInvoices = invoices?.filter(inv => inv.paymentStatus === 'Paid').length || 0;
  const unpaidInvoices = invoices?.filter(inv => inv.paymentStatus === 'Unpaid').length || 0;

  if (isLoading) return <Loading message="Loading purchase invoices..." />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Purchase Invoice Management</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => navigate('/purchases/new')}>
          Add Invoice
        </Button>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Total Invoices</Typography>
              <Typography variant="h4">{invoices?.length || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Total Purchases</Typography>
              <Typography variant="h4">₹{totalPurchases.toLocaleString()}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Paid</Typography>
              <Typography variant="h4" color="success.main">{paidInvoices}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Unpaid</Typography>
              <Typography variant="h4" color="warning.main">{unpaidInvoices}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          placeholder="Search invoices..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          sx={{ flexGrow: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Payment Status</InputLabel>
          <Select
            value={statusFilter}
            label="Payment Status"
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <MenuItem value="All">All Statuses</MenuItem>
            <MenuItem value="Paid">Paid</MenuItem>
            <MenuItem value="Unpaid">Unpaid</MenuItem>
            <MenuItem value="Partial">Partial</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Invoices Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="invoiceNumber" label="Invoice Number" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="invoiceDate" label="Date" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="vendorName" label="Vendor" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="totalAmount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="paymentStatus" label="Payment Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No invoices found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedInvoices.map((invoice) => (
                <TableRow key={invoice.id} hover onClick={() => navigate(`/purchases/${invoice.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">{invoice.invoiceNumber}</Typography>
                  </TableCell>
                  <TableCell>
                    {format(invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate), 'MMM dd, yyyy')}
                  </TableCell>
                  <TableCell>{invoice.vendorName}</TableCell>
                  <TableCell>{invoice.items.length} items</TableCell>
                  <TableCell align="right">₹{invoice.totalAmount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      label={invoice.paymentStatus}
                      size="small"
                      color={
                        invoice.paymentStatus === 'Paid' ? 'success' :
                        invoice.paymentStatus === 'Partial' ? 'warning' : 'error'
                      }
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" color="primary" onClick={() => navigate(`/purchases/${invoice.id}`)}>
                      <Visibility />
                    </IconButton>
                    <IconButton size="small" onClick={() => {/* Print invoice */}}>
                      <Receipt />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {sortedInvoices.length > 0 && (
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
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, sortedInvoices.length)} of {sortedInvoices.length} invoices
          </Typography>
        </Box>
      )}
    </Box>
  );
};


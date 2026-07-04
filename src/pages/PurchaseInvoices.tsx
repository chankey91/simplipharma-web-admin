import React, { useEffect, useMemo, useState } from 'react';
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
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  Search,
  Add,
  Visibility,
  Receipt,
  PictureAsPdf,
  CloudSync,
} from '@mui/icons-material';
import {
  usePurchaseInvoices,
  usePurchaseInvoicesSearch,
  usePurchaseInvoiceAmountTotal,
} from '../hooks/usePurchaseInvoices';
import { reindexPurchaseInvoicesTypesense } from '../services/purchaseInvoiceSearch';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import type { PaymentStatus } from '../types';

const ROWS_PER_PAGE = 10;

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  vendorName: string;
  itemCount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus | '';
}

const sortKeyToField = (key: string): string => {
  switch (key) {
    case 'invoiceNumber':
      return 'invoiceNumber';
    case 'vendorName':
      return 'vendorName';
    case 'items':
      return 'itemCount';
    case 'totalAmount':
      return 'totalAmount';
    case 'paymentStatus':
      return 'paymentStatus';
    case 'invoiceDate':
    default:
      return 'invoiceDate';
  }
};

export const PurchaseInvoicesPage: React.FC = () => {
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('invoiceDate', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const {
    data: searchData,
    isError: searchErrored,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = usePurchaseInvoicesSearch(
    {
      query: debouncedTerm,
      filter: statusFilter,
      sortField: sortKeyToField(sortKey),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );

  useEffect(() => {
    if (searchErrored) setTypesenseDisabled(true);
  }, [searchErrored]);

  // Total Purchases sum via Firestore aggregation (independent of Typesense).
  const { data: amountTotal } = usePurchaseInvoiceAmountTotal();

  // Fallback: full-load client-side (only when Typesense unavailable).
  const { data: invoices, isLoading: allLoading } = usePurchaseInvoices({ enabled: typesenseDisabled });

  const fallbackSorted = useMemo(() => {
    if (!typesenseDisabled) return [];
    const term = debouncedTerm.toLowerCase();
    const filtered = (invoices ?? []).filter((invoice) => {
      const matchesSearch =
        !term ||
        invoice.invoiceNumber.toLowerCase().includes(term) ||
        invoice.vendorName.toLowerCase().includes(term) ||
        invoice.items.some((item) => item.medicineName.toLowerCase().includes(term));
      const matchesStatus = statusFilter === 'All' || invoice.paymentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'invoiceNumber':
          cmp = compareAsc(a.invoiceNumber, b.invoiceNumber);
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
        case 'invoiceDate':
        default:
          cmp = compareAsc(toTimeMs(a.invoiceDate), toTimeMs(b.invoiceDate));
      }
      if (cmp !== 0) return applyDirection(cmp, sortDirection);
      return applyDirection(compareAsc(a.invoiceNumber, b.invoiceNumber), sortDirection);
    });
    return sorted;
  }, [typesenseDisabled, invoices, debouncedTerm, statusFilter, sortKey, sortDirection]);

  const rows: InvoiceRow[] = useMemo(() => {
    if (typesenseDisabled) {
      return fallbackSorted
        .slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
        .map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate instanceof Date ? inv.invoiceDate : new Date(inv.invoiceDate),
          vendorName: inv.vendorName,
          itemCount: inv.items.length,
          totalAmount: inv.totalAmount,
          paymentStatus: inv.paymentStatus,
        }));
    }
    return (searchData?.rows ?? []).map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: new Date(r.invoiceDate),
      vendorName: r.vendorName,
      itemCount: r.itemCount,
      totalAmount: r.totalAmount,
      paymentStatus: r.paymentStatus,
    }));
  }, [typesenseDisabled, fallbackSorted, page, searchData]);

  const totalCount = typesenseDisabled ? fallbackSorted.length : searchData?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));

  const totalInvoices = typesenseDisabled ? (invoices?.length ?? 0) : searchData?.totalAll ?? 0;
  const paidInvoices = typesenseDisabled
    ? (invoices ?? []).filter((i) => i.paymentStatus === 'Paid').length
    : searchData?.facetCounts?.['Paid'] ?? 0;
  const unpaidInvoices = typesenseDisabled
    ? (invoices ?? []).filter((i) => i.paymentStatus === 'Unpaid').length
    : searchData?.facetCounts?.['Unpaid'] ?? 0;
  const totalPurchases = typesenseDisabled
    ? (invoices ?? []).reduce((sum, inv) => sum + inv.totalAmount, 0)
    : amountTotal ?? 0;

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const d = await reindexPurchaseInvoicesTypesense();
      setReindexMessage(
        `Search index updated: ${d.indexed ?? 0} documents indexed (${d.totalDocs ?? 0} Firestore docs scanned).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setReindexMessage(`Search index rebuild failed: ${msg}.`);
    } finally {
      setReindexing(false);
    }
  };

  const initialLoading = typesenseDisabled ? allLoading : searchLoading || searchErrored;
  if (initialLoading) return <Loading message="Loading purchase invoices..." />;

  const isBusy = !typesenseDisabled && searchFetching;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Purchase Invoice Management</Typography>
        <Box display="flex" gap={1}>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<CloudSync />}
            onClick={() => void handleReindex()}
            disabled={reindexing}
          >
            {reindexing ? 'Indexing…' : 'Rebuild search index'}
          </Button>
          <Button variant="outlined" startIcon={<PictureAsPdf />} onClick={() => navigate('/purchases/import-pdf')}>
            Import PDF
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => navigate('/purchases/new')}>
            Add Invoice
          </Button>
        </Box>
      </Box>

      {reindexMessage && (
        <Alert
          severity={reindexMessage.startsWith('Search index updated') ? 'success' : 'error'}
          onClose={() => setReindexMessage(null)}
          sx={{ mb: 2 }}
        >
          {reindexMessage}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Total Invoices</Typography>
              <Typography variant="h4">{totalInvoices}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>Total Purchases</Typography>
              <Typography variant="h4">₹{Math.round(totalPurchases).toLocaleString()}</Typography>
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
        {isBusy && <LinearProgress />}
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
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No invoices found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((invoice) => (
                <TableRow key={invoice.id} hover onClick={() => navigate(`/purchases/${invoice.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">{invoice.invoiceNumber}</Typography>
                  </TableCell>
                  <TableCell>{format(invoice.invoiceDate, 'MMM dd, yyyy')}</TableCell>
                  <TableCell>{invoice.vendorName}</TableCell>
                  <TableCell>{invoice.itemCount} items</TableCell>
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
      {totalCount > 0 && (
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
            Showing {(page - 1) * ROWS_PER_PAGE + 1} to {Math.min(page * ROWS_PER_PAGE, totalCount)} of {totalCount} invoices
          </Typography>
        </Box>
      )}
    </Box>
  );
};

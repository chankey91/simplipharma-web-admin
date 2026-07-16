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
  Tabs,
  Tab,
  LinearProgress,
} from '@mui/material';
import { Search, Download, Receipt, ShoppingCart } from '@mui/icons-material';
import {
  usePurchaseInvoices,
  usePurchaseInvoicesSearch,
  usePurchaseInvoiceAmountTotal,
} from '../hooks/usePurchaseInvoices';
import { useOrders, useOrdersSearch, useOrderInvoicedAmountTotal } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { OrderSearchParams } from '../services/orderSearch';
import { getOrderById } from '../services/orders';
import { getPurchaseInvoiceById } from '../services/purchaseInvoices';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { generatePurchaseInvoice, generateOrderInvoice } from '../utils/invoice';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { orderReferenceWithoutInvoice } from '../utils/orderDisplay';
import { resolveOrderListTotalAmount } from '../utils/orderTotalOverrides';
import { useAppDialog } from '../context/AppDialogProvider';

type InvoiceTab = 'order' | 'purchase';

const ROWS_PER_PAGE = 10;

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  date: Date;
  storeName: string;
  vendorOrStore: string;
  amount: number;
  status: string;
}

const orderSortField = (key: string): NonNullable<OrderSearchParams['sortField']> => {
  switch (key) {
    case 'invoiceNumber':
      return 'invoiceNumber';
    case 'storeName':
      return 'retailerName';
    case 'vendorOrStore':
      return 'retailerEmail';
    case 'amount':
      return 'amountSortable';
    case 'status':
      return 'paymentStatus';
    case 'date':
    default:
      return 'orderDate';
  }
};

const purchaseSortField = (key: string): string => {
  switch (key) {
    case 'invoiceNumber':
      return 'invoiceNumber';
    case 'vendorOrStore':
      return 'vendorName';
    case 'amount':
      return 'totalAmount';
    case 'status':
      return 'paymentStatus';
    case 'date':
    default:
      return 'invoiceDate';
  }
};

export const InvoicesPage: React.FC = () => {
  const { alert } = useAppDialog();
  const { data: stores } = useStores();
  const [tab, setTab] = useState<InvoiceTab>('order');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Paid' | 'Unpaid' | 'Partial'>('All');
  const [page, setPage] = useState(1);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);

  const { sortKey, sortDirection, requestSort } = useTableSort('date', 'desc');

  const storeNameByRetailerId = useMemo(() => {
    const map = new Map<string, string>();
    stores?.forEach((store) => {
      const name = store.shopName || store.displayName;
      if (!name) return;
      map.set(store.id, name);
      if (store.uid) map.set(store.uid, name);
    });
    return map;
  }, [stores]);

  const resolveStoreName = (retailerName?: string, retailerId?: string) =>
    retailerName?.trim() ||
    (retailerId ? storeNameByRetailerId.get(retailerId) : undefined) ||
    'N/A';

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const isOrder = tab === 'order';

  const orderSearch = useOrdersSearch(
    {
      query: debouncedTerm,
      invoicedOnly: true,
      paymentStatus: statusFilter,
      sortField: orderSortField(sortKey),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );

  const purchaseSearch = usePurchaseInvoicesSearch(
    {
      query: debouncedTerm,
      filter: statusFilter,
      sortField: purchaseSortField(sortKey),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );

  useEffect(() => {
    if (orderSearch.isError || purchaseSearch.isError) setTypesenseDisabled(true);
  }, [orderSearch.isError, purchaseSearch.isError]);

  // KPI amount cards via Firestore aggregation (independent of Typesense).
  const { data: orderAmount } = useOrderInvoicedAmountTotal();
  const { data: purchaseAmount } = usePurchaseInvoiceAmountTotal();

  // Fallback: full-load client-side (only when Typesense unavailable).
  const { data: allOrders, isLoading: ordersLoading } = useOrders({ enabled: typesenseDisabled });
  const { data: allPurchases, isLoading: purchaseLoading } = usePurchaseInvoices({
    enabled: typesenseDisabled,
  });

  const fallbackRows = useMemo(() => {
    if (!typesenseDisabled) return [] as InvoiceRow[];
    const term = debouncedTerm.toLowerCase();
    let list: InvoiceRow[] = [];
    if (isOrder) {
      list = (allOrders ?? [])
        .filter((o) => o.status !== 'Pending' && o.status !== 'Cancelled')
        .map((o) => ({
          id: o.id,
          invoiceNumber: o.invoiceNumber || orderReferenceWithoutInvoice(o.id),
          date: o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate),
          storeName: resolveStoreName(o.retailerName, o.retailerId),
          vendorOrStore: o.retailerEmail || 'N/A',
          amount: resolveOrderListTotalAmount(o.id, o.totalAmount || 0),
          status: o.paymentStatus || 'Unpaid',
        }));
    } else {
      list = (allPurchases ?? []).map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.invoiceDate instanceof Date ? inv.invoiceDate : new Date(inv.invoiceDate),
        storeName: '—',
        vendorOrStore: inv.vendorName || 'N/A',
        amount: inv.totalAmount || 0,
        status: inv.paymentStatus || 'Unpaid',
      }));
    }
    const filtered = list.filter((r) => {
      const matchesSearch =
        !term ||
        r.invoiceNumber.toLowerCase().includes(term) ||
        r.storeName.toLowerCase().includes(term) ||
        r.vendorOrStore.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'invoiceNumber':
          cmp = compareAsc(a.invoiceNumber, b.invoiceNumber);
          break;
        case 'storeName':
          cmp = compareAsc(a.storeName, b.storeName);
          break;
        case 'vendorOrStore':
          cmp = compareAsc(a.vendorOrStore, b.vendorOrStore);
          break;
        case 'amount':
          cmp = compareAsc(a.amount, b.amount);
          break;
        case 'status':
          cmp = compareAsc(a.status, b.status);
          break;
        case 'date':
        default:
          cmp = compareAsc(toTimeMs(a.date), toTimeMs(b.date));
      }
      if (cmp !== 0) return applyDirection(cmp, sortDirection);
      return applyDirection(compareAsc(a.invoiceNumber, b.invoiceNumber), sortDirection);
    });
    return filtered;
  }, [typesenseDisabled, isOrder, allOrders, allPurchases, debouncedTerm, statusFilter, sortKey, sortDirection, storeNameByRetailerId]);

  const rows: InvoiceRow[] = useMemo(() => {
    if (typesenseDisabled) {
      return fallbackRows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
    }
    if (isOrder) {
      return (orderSearch.data?.orders ?? []).map((o) => ({
        id: o.id,
        invoiceNumber: o.invoiceNumber || orderReferenceWithoutInvoice(o.id),
        date: new Date(o.orderDate),
        storeName: o.retailerName?.trim() || 'N/A',
        vendorOrStore: o.retailerEmail || 'N/A',
        amount: resolveOrderListTotalAmount(o.id, o.totalAmount || 0),
        status: o.paymentStatus || 'Unpaid',
      }));
    }
    return (purchaseSearch.data?.rows ?? []).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: new Date(inv.invoiceDate),
      storeName: '—',
      vendorOrStore: inv.vendorName || 'N/A',
      amount: inv.totalAmount || 0,
      status: inv.paymentStatus || 'Unpaid',
    }));
  }, [typesenseDisabled, isOrder, fallbackRows, page, orderSearch.data, purchaseSearch.data]);

  // Global counts (independent of search/filter) for the KPI cards.
  const orderStatusCounts = orderSearch.data?.statusCounts;
  const orderInvoicedCount = typesenseDisabled
    ? (allOrders ?? []).filter((o) => o.status !== 'Pending' && o.status !== 'Cancelled').length
    : (orderStatusCounts?.['Order Fulfillment'] ?? 0) +
      (orderStatusCounts?.['In Transit'] ?? 0) +
      (orderStatusCounts?.['Delivered'] ?? 0);
  const purchaseCount = typesenseDisabled
    ? (allPurchases?.length ?? 0)
    : purchaseSearch.data?.totalAll ?? 0;
  const totalInvoices = orderInvoicedCount + purchaseCount;
  const totalAmount = typesenseDisabled
    ? (allOrders ?? [])
        .filter((o) => o.status !== 'Pending' && o.status !== 'Cancelled')
        .reduce((s, o) => s + (o.totalAmount || 0), 0) +
      (allPurchases ?? []).reduce((s, inv) => s + (inv.totalAmount || 0), 0)
    : (orderAmount ?? 0) + (purchaseAmount ?? 0);

  const activeTotal = typesenseDisabled
    ? fallbackRows.length
    : isOrder
    ? orderSearch.data?.found ?? 0
    : purchaseSearch.data?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(activeTotal / ROWS_PER_PAGE));

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handleTabChange = (_: React.SyntheticEvent, value: InvoiceTab) => {
    setTab(value);
    setPage(1);
  };

  const handleDownload = async (row: InvoiceRow) => {
    try {
      if (isOrder) {
        const order = await getOrderById(row.id);
        if (order) await generateOrderInvoice(order, { emailPdfToRetailer: true });
      } else {
        const inv = await getPurchaseInvoiceById(row.id);
        if (inv) await generatePurchaseInvoice(inv);
      }
    } catch (error: any) {
      await alert(`Failed to download invoice: ${error?.message || 'Unknown error'}`, {
        severity: 'error',
      });
    }
  };

  const initialLoading = typesenseDisabled
    ? isOrder
      ? ordersLoading
      : purchaseLoading
    : isOrder
    ? orderSearch.isLoading || orderSearch.isError
    : purchaseSearch.isLoading || purchaseSearch.isError;
  if (initialLoading) return <Loading message="Loading invoices..." />;

  const isBusy = !typesenseDisabled && (isOrder ? orderSearch.isFetching : purchaseSearch.isFetching);

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
              <Typography variant="h4">{totalInvoices}</Typography>
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
              <Typography variant="h4">{orderInvoicedCount}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total Amount
              </Typography>
              <Typography variant="h4">₹{Math.round(totalAmount).toLocaleString()}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab
          value="order"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ShoppingCart fontSize="small" /> Order invoices
              <Chip label={orderInvoicedCount} size="small" />
            </Box>
          }
        />
        <Tab
          value="purchase"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Receipt fontSize="small" /> Purchase invoices
              <Chip label={purchaseCount} size="small" />
            </Box>
          }
        />
      </Tabs>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <TextField
              fullWidth
              placeholder="Search by invoice number, store name, or vendor/email..."
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
              <InputLabel>Payment Status</InputLabel>
              <Select
                value={statusFilter}
                label="Payment Status"
                onChange={(e) => {
                  setStatusFilter(e.target.value as 'All' | 'Paid' | 'Unpaid' | 'Partial');
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
        {isBusy && <LinearProgress />}
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="invoiceNumber" label="Invoice Number" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="date" label="Date" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              {isOrder ? (
                <SortableTableHeadCell columnId="storeName" label="Store Name" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              ) : null}
              <SortableTableHeadCell columnId="vendorOrStore" label={isOrder ? 'Email' : 'Vendor'} sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOrder ? 7 : 6} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>
                    No invoices found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((invoice) => (
                <TableRow key={`${tab}-${invoice.id}`} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {invoice.invoiceNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>{format(invoice.date, 'MMM dd, yyyy')}</TableCell>
                  {isOrder ? <TableCell>{invoice.storeName}</TableCell> : null}
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
                      title={
                        isOrder
                          ? 'Download PDF; email to retailer (PDF + CSV) sends in the background.'
                          : 'Download invoice'
                      }
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
      {activeTotal > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * ROWS_PER_PAGE + 1} to{' '}
            {Math.min(page * ROWS_PER_PAGE, activeTotal)} of {activeTotal} invoices
          </Typography>
        </Box>
      )}
    </Box>
  );
};

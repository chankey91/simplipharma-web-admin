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
  Pagination,
  LinearProgress,
  Link,
  Tooltip,
  Collapse,
  CircularProgress,
} from '@mui/material';
import { Search, Download, Email, Visibility, VisibilityOff } from '@mui/icons-material';
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
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Order, PurchaseInvoice } from '../types';

type InvoiceTab = 'order' | 'purchase';
type PaymentFilter = 'All' | 'Paid' | 'Unpaid' | 'Partial';

function tabFromSearch(raw: string | null): InvoiceTab {
  return raw === 'purchase' ? 'purchase' : 'order';
}

function paymentFromSearch(raw: string | null): PaymentFilter {
  if (raw === 'Paid' || raw === 'Unpaid' || raw === 'Partial' || raw === 'All') return raw;
  return 'All';
}

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

function money(n: number | undefined): string {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

const InvoiceAccordionPanel: React.FC<{
  isOrder: boolean;
  fullPath: string;
  loading: boolean;
  error?: string;
  data?: Order | PurchaseInvoice;
}> = ({ isOrder, fullPath, loading, error, data }) => {
  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={1} py={2}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Loading invoice…
        </Typography>
      </Box>
    );
  }
  if (error) {
    return (
      <Typography variant="body2" color="error" sx={{ py: 2 }}>
        {error}
      </Typography>
    );
  }
  if (!data) return null;

  const order = isOrder ? (data as Order) : null;
  const purchase = !isOrder ? (data as PurchaseInvoice) : null;
  const lines = order
    ? (order.medicines || []).filter((m) => (m as { lineType?: string }).lineType !== 'product_demand')
    : purchase?.items || [];
  return (
    <Box sx={{ py: 1.5 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Typography variant="subtitle2">
          {isOrder
            ? `${order?.retailerName || order?.retailerEmail || 'Store'} · ${order?.status || ''}`
            : `${purchase?.vendorName || 'Vendor'}${purchase?.vendorInvoiceNumber ? ` · Bill ${purchase.vendorInvoiceNumber}` : ''}`}
        </Typography>
        <Link component={RouterLink} to={fullPath} underline="hover" variant="body2">
          Open full page
        </Link>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell>Batch</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Free</TableCell>
            <TableCell align="right">Rate</TableCell>
            <TableCell align="right">GST</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7}>
                <Typography variant="body2" color="text.secondary">
                  No line items
                </Typography>
              </TableCell>
            </TableRow>
          ) : order ? (
            order.medicines
              .filter((m) => (m as { lineType?: string }).lineType !== 'product_demand')
              .map((m, i) => {
                const qty = Number(m.quantity) || 0;
                const free = Number(m.freeQuantity) || 0;
                const rate = Number(m.price) || 0;
                const disc = Number(m.discountPercentage) || 0;
                const amount = qty * rate * (1 - disc / 100);
                const batch =
                  m.batchNumber ||
                  (m.batchAllocations || []).map((a) => a.batchNumber).filter(Boolean).join(', ') ||
                  '—';
                return (
                  <TableRow key={`${m.medicineId}-${i}`}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>{batch}</TableCell>
                    <TableCell align="right">{qty}</TableCell>
                    <TableCell align="right">{free || '—'}</TableCell>
                    <TableCell align="right">{money(rate)}</TableCell>
                    <TableCell align="right">{m.gstRate != null ? `${m.gstRate}%` : '—'}</TableCell>
                    <TableCell align="right">{money(amount)}</TableCell>
                  </TableRow>
                );
              })
          ) : (
            (purchase?.items || []).map((m, i) => (
              <TableRow key={`${m.medicineId}-${i}`}>
                <TableCell>{m.medicineName}</TableCell>
                <TableCell>{m.receivedBatchNumber || m.batchNumber || '—'}</TableCell>
                <TableCell align="right">{m.quantity}</TableCell>
                <TableCell align="right">{m.freeQuantity || '—'}</TableCell>
                <TableCell align="right">{money(m.purchasePrice || m.unitPrice)}</TableCell>
                <TableCell align="right">{m.gstRate != null ? `${m.gstRate}%` : '—'}</TableCell>
                <TableCell align="right">{money(m.totalAmount)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Box display="flex" justifyContent="flex-end" gap={2} mt={1} flexWrap="wrap">
        <Typography variant="caption" color="text.secondary">
          Subtotal {money(order?.subTotal ?? purchase?.subTotal)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Discount {money(order?.totalDiscount ?? purchase?.discount)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          GST {money(order?.taxAmount ?? purchase?.taxAmount)}
        </Typography>
        <Typography variant="body2" fontWeight={600}>
          Total {money(order?.totalAmount ?? purchase?.totalAmount)}
        </Typography>
      </Box>
    </Box>
  );
};

export const InvoicesPage: React.FC = () => {
  const { alert } = useAppDialog();
  const { data: stores } = useStores();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromSearch(searchParams.get('tab'));
  const statusFilter = paymentFromSearch(searchParams.get('payment'));
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [page, setPage] = useState(1);

  const patchInvoiceSearch = (patch: { tab?: InvoiceTab; payment?: PaymentFilter }) => {
    const next = new URLSearchParams(searchParams);
    const nextTab = patch.tab ?? tab;
    const nextPayment = patch.payment ?? statusFilter;
    if (nextTab === 'order') next.delete('tab');
    else next.set('tab', nextTab);
    if (nextPayment === 'All') next.delete('payment');
    else next.set('payment', nextPayment);
    setSearchParams(next, { replace: true });
    setPage(1);
  };
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, Order | PurchaseInvoice>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsErrorById, setDetailsErrorById] = useState<Record<string, string>>({});

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

  const handleTabChange = (value: InvoiceTab) => {
    if (value === tab) return;
    setExpandedId(null);
    patchInvoiceSearch({ tab: value });
  };

  useEffect(() => {
    setExpandedId(null);
  }, [page, debouncedTerm, statusFilter, tab]);

  const invoicePath = (row: InvoiceRow) =>
    isOrder ? `/orders/${row.id}` : `/purchases/${row.id}`;

  const toggleInvoiceDetails = async (row: InvoiceRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    const cacheKey = `${tab}:${row.id}`;
    if (detailsById[cacheKey] || detailsLoadingId === cacheKey) return;
    setDetailsLoadingId(cacheKey);
    try {
      const data = isOrder ? await getOrderById(row.id) : await getPurchaseInvoiceById(row.id);
      if (!data) throw new Error('Invoice not found');
      setDetailsById((prev) => ({ ...prev, [cacheKey]: data }));
      setDetailsErrorById((prev) => {
        const next = { ...prev };
        delete next[cacheKey];
        return next;
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load invoice';
      setDetailsErrorById((prev) => ({ ...prev, [cacheKey]: message }));
    } finally {
      setDetailsLoadingId((current) => (current === cacheKey ? null : current));
    }
  };

  const handleDownload = async (row: InvoiceRow) => {
    try {
      if (isOrder) {
        const order = await getOrderById(row.id);
        if (order) await generateOrderInvoice(order);
      } else {
        const inv = await getPurchaseInvoiceById(row.id);
        if (inv) await generatePurchaseInvoice(inv);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to download invoice: ${message}`, { severity: 'error' });
    }
  };

  const handleEmailRetailer = async (row: InvoiceRow) => {
    try {
      const order = await getOrderById(row.id);
      if (!order) throw new Error('Order not found');
      await generateOrderInvoice(order, {
        emailPdfToRetailer: true,
        downloadPdf: false,
        awaitEmail: true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to email invoice: ${message}`, { severity: 'error' });
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
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 0.5 }}>
          Invoices
        </Typography>
        <Chip
          size="small"
          label={`Order ${orderInvoicedCount}`}
          color="primary"
          variant={isOrder ? 'filled' : 'outlined'}
          onClick={() => handleTabChange('order')}
          sx={{ fontWeight: isOrder ? 600 : 400 }}
        />
        <Chip
          size="small"
          label={`Purchase ${purchaseCount}`}
          color="primary"
          variant={!isOrder ? 'filled' : 'outlined'}
          onClick={() => handleTabChange('purchase')}
          sx={{ fontWeight: !isOrder ? 600 : 400 }}
        />
        <Typography variant="caption" color="text.secondary">
          {totalInvoices} total
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          ₹{Math.round(totalAmount).toLocaleString('en-IN')}
        </Typography>
      </Box>

      <Paper sx={{ px: 1.5, py: 1, mb: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search invoice, store, vendor, or email…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 220, flex: '1 1 220px' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Payment</InputLabel>
            <Select
              value={statusFilter}
              label="Payment"
              onChange={(e) => {
                patchInvoiceSearch({ payment: e.target.value as PaymentFilter });
              }}
            >
              <MenuItem value="All">All status</MenuItem>
              <MenuItem value="Paid">Paid</MenuItem>
              <MenuItem value="Unpaid">Unpaid</MenuItem>
              <MenuItem value="Partial">Partial</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        {isBusy && <LinearProgress />}
        <Table size="small">
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
              rows.map((invoice) => {
                const open = expandedId === invoice.id;
                return (
                <React.Fragment key={`${tab}-${invoice.id}`}>
                <TableRow hover selected={open}>
                  <TableCell>
                    <Link
                      component="button"
                      underline="hover"
                      variant="body2"
                      fontWeight="medium"
                      onClick={() => void toggleInvoiceDetails(invoice)}
                    >
                      {invoice.invoiceNumber}
                    </Link>
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
                    <Tooltip title={open ? 'Hide invoice data' : 'View invoice data'}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => void toggleInvoiceDetails(invoice)}
                        aria-label={open ? 'Hide invoice data' : 'View invoice data'}
                      >
                        {open ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Download invoice PDF">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => void handleDownload(invoice)}
                        aria-label="Download invoice PDF"
                      >
                        <Download />
                      </IconButton>
                    </Tooltip>
                    {isOrder && (
                      <Tooltip title="Email invoice to retailer (PDF + CSV)">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => void handleEmailRetailer(invoice)}
                          aria-label="Email invoice to retailer"
                        >
                          <Email />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={isOrder ? 7 : 6} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                      <InvoiceAccordionPanel
                        isOrder={isOrder}
                        fullPath={invoicePath(invoice)}
                        loading={detailsLoadingId === `${tab}:${invoice.id}`}
                        error={detailsErrorById[`${tab}:${invoice.id}`]}
                        data={detailsById[`${tab}:${invoice.id}`]}
                      />
                    </Collapse>
                  </TableCell>
                </TableRow>
                </React.Fragment>
                );
              })
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

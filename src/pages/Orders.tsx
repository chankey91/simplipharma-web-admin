import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Pagination,
  LinearProgress,
  Alert,
  Divider,
} from '@mui/material';
import {
  Search,
  Visibility,
  Cancel,
  Download,
  CloudSync,
  Publish,
} from '@mui/icons-material';
import { useOrders, useOrdersSearch, useCancelOrder } from '../hooks/useOrders';
import { useQuery } from '@tanstack/react-query';
import { useStores } from '../hooks/useStores';
import { getOrdersInRange } from '../services/orders';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import { exportPendingOrdersByStore, exportPendingOrdersProductSummary } from '../utils/export';
import { publishPurchaseList } from '../services/purchaseLists';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { formatOrderNumberForDisplay } from '../utils/orderDisplay';
import { resolveOrderListTotalAmount } from '../utils/orderTotalOverrides';
import { useAppDialog } from '../context/AppDialogProvider';
import { useAuth } from '../context/AuthContext';
import type { OrderSearchParams } from '../services/orderSearch';
import { reindexOrdersTypesense } from '../services/orderSearch';
import {
  getDefaultNoonToNoonRangeIST,
  getDefaultOrdersFilterRangeIST,
  isDateInIstDateTimeRange,
  parseIstDateTimeLocal,
} from '../utils/dateTime';

const ROWS_PER_PAGE = 10;

/** Normalized row shape rendered by the table, sourced from either Typesense or the fallback full list. */
interface OrderRow {
  id: string;
  orderDate: Date;
  storeName: string;
  retailerEmail: string;
  itemCount: number;
  totalAmount: number;
  status: OrderStatus;
}

/** Map the table's sort column id to the Typesense-indexed field name. */
const sortKeyToField = (key: string): OrderSearchParams['sortField'] => {
  switch (key) {
    case 'id':
      return 'docId';
    case 'retailer':
      return 'retailerEmail';
    case 'storeName':
      return 'retailerName';
    case 'items':
      return 'itemCount';
    case 'amount':
      return 'amountSortable';
    case 'status':
      return 'status';
    case 'orderDate':
    default:
      return 'orderDate';
  }
};

export const OrdersPage: React.FC = () => {
  const cancelOrderMutation = useCancelOrder();
  const navigate = useNavigate();
  const { alert } = useAppDialog();
  const { canWrite, panelRole } = useAuth();
  const canEditOrders = canWrite('orders');
  const canReindexOrders = panelRole === 'admin' || panelRole === 'operations';
  const { data: stores } = useStores();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [fromDateFilter, setFromDateFilter] = useState(
    () => getDefaultOrdersFilterRangeIST().fromDateTime
  );
  const [toDateFilter, setToDateFilter] = useState(
    () => getDefaultOrdersFilterRangeIST().toDateTime
  );
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingProductSummary, setIsExportingProductSummary] = useState(false);
  const [isPublishingPurchaseList, setIsPublishingPurchaseList] = useState(false);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; orderId: string; reason: string }>({
    open: false,
    orderId: '',
    reason: '',
  });
  const [pendingExportDialog, setPendingExportDialog] = useState({
    open: false,
    fromDateTime: '',
    toDateTime: '',
  });
  const [productSummaryDialog, setProductSummaryDialog] = useState({
    open: false,
    fromDateTime: '',
    toDateTime: '',
  });

  const { sortKey, sortDirection, requestSort } = useTableSort('orderDate', 'desc');

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

  // Debounce the search term so we don't fire a Typesense query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fromFilterMs = fromDateFilter ? parseIstDateTimeLocal(fromDateFilter) : null;
  const toFilterMs = toDateFilter ? parseIstDateTimeLocal(toDateFilter) : null;
  const dateRangeInvalid = Boolean(
    fromDateFilter &&
      toDateFilter &&
      (fromFilterMs == null || toFilterMs == null || fromFilterMs >= toFilterMs)
  );
  const hasDateFilter = Boolean((fromDateFilter || toDateFilter) && !dateRangeInvalid);
  /** Prefer Firestore for any date filter — Typesense can lag behind new orders. */
  const useLocalList = typesenseDisabled || hasDateFilter;

  // Primary path: server-side search/filter/sort/pagination via Typesense.
  const searchParams: OrderSearchParams = {
    query: debouncedTerm,
    status: statusFilter,
    sortField: sortKeyToField(sortKey),
    sortOrder: sortDirection,
    page,
    perPage: ROWS_PER_PAGE,
    ...(fromDateFilter && !dateRangeInvalid ? { fromDate: fromDateFilter.slice(0, 10) } : {}),
    ...(toDateFilter && !dateRangeInvalid ? { toDate: toDateFilter.slice(0, 10) } : {}),
  };
  const {
    data: searchData,
    isError: searchErrored,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useOrdersSearch(searchParams, { enabled: !useLocalList && !dateRangeInvalid });

  // If Typesense is unreachable/misconfigured, permanently fall back for this session.
  useEffect(() => {
    if (searchErrored) setTypesenseDisabled(true);
  }, [searchErrored]);

  const dateRangeBounds = useMemo(() => {
    if (!hasDateFilter) return null;
    return {
      startMs: fromFilterMs ?? 0,
      endMsExclusive: toFilterMs ?? undefined,
    };
  }, [hasDateFilter, fromFilterMs, toFilterMs]);

  const { data: rangedOrders, isLoading: rangeLoading } = useQuery({
    queryKey: ['ordersInRange', dateRangeBounds?.startMs, dateRangeBounds?.endMsExclusive],
    queryFn: () =>
      getOrdersInRange(dateRangeBounds!.startMs, dateRangeBounds!.endMsExclusive),
    enabled: hasDateFilter && dateRangeBounds != null,
    // Always reload when navigating back to Orders Management.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fallback path: full collection when Typesense unavailable and no date filter.
  const { data: allOrders, isLoading: allLoading } = useOrders({
    enabled: typesenseDisabled && !hasDateFilter,
  });

  const localOrdersSource = hasDateFilter ? rangedOrders ?? [] : allOrders ?? [];

  const filterLocalOrders = useCallback(
    (orders: Order[], applyStatusFilter: boolean) => {
      const term = debouncedTerm.toLowerCase();
      return orders.filter((order) => {
        const matchesSearch =
          !term ||
          order.id.toLowerCase().includes(term) ||
          resolveStoreName(order.retailerName, order.retailerId).toLowerCase().includes(term) ||
          order.retailerEmail?.toLowerCase().includes(term) ||
          order.medicines.some((m) => m.name.toLowerCase().includes(term));
        const matchesStatus =
          !applyStatusFilter || statusFilter === 'All' || order.status === statusFilter;
        const matchesDate = isDateInIstDateTimeRange(
          order.orderDate,
          fromDateFilter || undefined,
          toDateFilter || undefined
        );
        return matchesSearch && matchesStatus && matchesDate;
      });
    },
    [debouncedTerm, statusFilter, fromDateFilter, toDateFilter, hasDateFilter, storeNameByRetailerId]
  );

  const localFilteredSorted = useMemo(() => {
    if (!useLocalList) return [];
    if (dateRangeInvalid) return [];
    const filtered = filterLocalOrders(localOrdersSource, true);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return applyDirection(compareAsc(a.id, b.id), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc((a.retailerEmail || '').toLowerCase(), (b.retailerEmail || '').toLowerCase()),
            sortDirection
          );
        case 'storeName':
          return applyDirection(
            compareAsc(
              resolveStoreName(a.retailerName, a.retailerId).toLowerCase(),
              resolveStoreName(b.retailerName, b.retailerId).toLowerCase()
            ),
            sortDirection
          );
        case 'items':
          return applyDirection(compareAsc(a.medicines.length, b.medicines.length), sortDirection);
        case 'amount': {
          const va = a.status === 'Pending' ? 0 : a.totalAmount;
          const vb = b.status === 'Pending' ? 0 : b.totalAmount;
          return applyDirection(compareAsc(va, vb), sortDirection);
        }
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'orderDate':
        default:
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), sortDirection);
      }
    });
    return sorted;
  }, [
    useLocalList,
    dateRangeInvalid,
    localOrdersSource,
    filterLocalOrders,
    sortKey,
    sortDirection,
  ]);

  const localStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of filterLocalOrders(localOrdersSource, false)) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
    }
    return counts;
  }, [localOrdersSource, filterLocalOrders]);

  // Normalized view model shared by both paths.
  const rows: OrderRow[] = useMemo(() => {
    if (useLocalList) {
      return localFilteredSorted
        .slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
        .map((o) => ({
          id: o.id,
          orderDate: o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate),
          storeName: resolveStoreName(o.retailerName, o.retailerId),
          retailerEmail: o.retailerEmail || '',
          itemCount: o.medicines.length,
          totalAmount: resolveOrderListTotalAmount(o.id, o.totalAmount),
          status: o.status,
        }));
    }
    return (searchData?.orders ?? []).map((o) => ({
      id: o.id,
      orderDate: new Date(o.orderDate),
      storeName: o.retailerName?.trim() || 'N/A',
      retailerEmail: o.retailerEmail || '',
      itemCount: o.itemCount,
      totalAmount: resolveOrderListTotalAmount(o.id, o.totalAmount),
      status: o.status,
    }));
  }, [useLocalList, localFilteredSorted, page, searchData, storeNameByRetailerId]);

  const statusCounts = useLocalList ? localStatusCounts : searchData?.statusCounts ?? {};
  const totalCount = useLocalList ? localFilteredSorted.length : searchData?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));

  const ordersByStatus = {
    Pending: statusCounts['Pending'] ?? 0,
    Fulfillment: statusCounts['Order Fulfillment'] ?? 0,
    Transit: statusCounts['In Transit'] ?? 0,
    Delivered: statusCounts['Delivered'] ?? 0,
    Cancelled: statusCounts['Cancelled'] ?? 0,
  };
  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleCancelOrder = async () => {
    const user = auth.currentUser;
    if (!user || !cancelDialog.orderId) return;

    try {
      const res = await cancelOrderMutation.mutateAsync({
        orderId: cancelDialog.orderId,
        cancelledBy: user.uid,
        reason: cancelDialog.reason,
      });
      setCancelDialog({ open: false, orderId: '', reason: '' });
      if (res.stockRestoreErrors.length > 0) {
        console.warn('Stock restore errors on cancel:', res.stockRestoreErrors);
        window.alert(
          `Order cancelled, but some stock could not be restored:\n${res.stockRestoreErrors.slice(0, 3).join('\n')}`
        );
      }
    } catch (error) {
      console.error('Error cancelling order:', error);
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'warning';
      case 'Order Fulfillment': return 'primary';
      case 'In Transit': return 'info';
      case 'Delivered': return 'success';
      case 'Cancelled': return 'error';
      default: return 'default';
    }
  };

  const parseExportDateTimeRange = async (
    fromDateTime: string,
    toDateTime: string
  ): Promise<{ startMs: number; endMs: number } | null> => {
    if (!fromDateTime || !toDateTime) {
      await alert('Please select both From and To date & time', { severity: 'warning' });
      return null;
    }
    const startMs = parseIstDateTimeLocal(fromDateTime);
    const endMs = parseIstDateTimeLocal(toDateTime);
    if (startMs == null || endMs == null) {
      await alert('Please enter valid From and To date & time', { severity: 'warning' });
      return null;
    }
    if (startMs >= endMs) {
      await alert('From must be before To', { severity: 'warning' });
      return null;
    }
    return { startMs, endMs };
  };

  const handleExportPendingOrders = async () => {
    const range = await parseExportDateTimeRange(
      pendingExportDialog.fromDateTime,
      pendingExportDialog.toDateTime
    );
    if (!range) return;

    setIsExporting(true);
    try {
      const ordersInRange = await getOrdersInRange(range.startMs, range.endMs);
      const pendingOrders = ordersInRange.filter((o) => o.status === 'Pending');
      if (pendingOrders.length === 0) {
        await alert('No pending orders found in the selected date & time range', {
          severity: 'warning',
        });
        return;
      }
      const fromStamp = pendingExportDialog.fromDateTime.replace(/[-:T]/g, '');
      const toStamp = pendingExportDialog.toDateTime.replace(/[-:T]/g, '');
      await exportPendingOrdersByStore(
        pendingOrders,
        stores || [],
        `pending-orders-by-store-${fromStamp}-${toStamp}`
      );
      setPendingExportDialog((prev) => ({ ...prev, open: false }));
      await alert('Excel file generated successfully!', { severity: 'success' });
    } catch (error: any) {
      console.error('Error exporting orders:', error);
      await alert(`Failed to export: ${error.message || 'Unknown error'}`, { severity: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPendingProductSummary = async () => {
    const { fromDateTime, toDateTime } = productSummaryDialog;
    const range = await parseExportDateTimeRange(fromDateTime, toDateTime);
    if (!range) return;

    setIsExportingProductSummary(true);
    try {
      const ordersInRange = await getOrdersInRange(range.startMs, range.endMs);
      const pendingInRange = ordersInRange.filter((o) => o.status === 'Pending');

      if (pendingInRange.length === 0) {
        await alert('No pending orders found in the selected date & time range', {
          severity: 'warning',
        });
        return;
      }

      const fromStamp = fromDateTime.replace(/[-:T]/g, '');
      const toStamp = toDateTime.replace(/[-:T]/g, '');
      const filename = `pending-orders-product-summary-${fromStamp}-${toStamp}`;
      await exportPendingOrdersProductSummary(pendingInRange, filename);
      setProductSummaryDialog((prev) => ({ ...prev, open: false }));
      await alert('Product summary Excel file generated successfully!', {
        severity: 'success',
      });
    } catch (error: unknown) {
      console.error('Error exporting product summary:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to export: ${message}`, { severity: 'error' });
    } finally {
      setIsExportingProductSummary(false);
    }
  };

  const handlePublishPurchaseList = async () => {
    const fromDate = productSummaryDialog.fromDateTime.slice(0, 10);
    const toDate = productSummaryDialog.toDateTime.slice(0, 10);
    if (!fromDate || !toDate) {
      await alert('Please select both From and To dates', { severity: 'warning' });
      return;
    }
    if (fromDate > toDate) {
      await alert('From date must be on or before To date', { severity: 'warning' });
      return;
    }

    setIsPublishingPurchaseList(true);
    try {
      const result = await publishPurchaseList({
        orders: [],
        fromDate,
        toDate,
      });
      setProductSummaryDialog((prev) => ({ ...prev, open: false }));
      const eliminated = result.eliminatedCount ?? 0;
      const reduced = result.reducedCount ?? 0;
      await alert(
        `Published purchase list with ${result.itemCount} medicines (net remaining).` +
          (eliminated || reduced
            ? ` Eliminated ${eliminated} fully covered; reduced ${reduced} partially covered.`
            : '') +
          ' Prior open lists were superseded. Auto jobs also run daily at 12:00 & 15:00 IST.',
        { severity: 'success' }
      );
    } catch (error: unknown) {
      console.error('Error publishing purchase list:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to publish: ${message}`, { severity: 'error' });
    } finally {
      setIsPublishingPurchaseList(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const d = await reindexOrdersTypesense();
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

  // While Typesense is erroring but before the fallback has engaged, keep showing
  // the loader instead of a flash of "No orders found".
  const initialLoading = useLocalList
    ? hasDateFilter
      ? rangeLoading
      : allLoading
    : searchLoading || searchErrored;
  if (initialLoading) {
    return <Loading message="Loading orders..." />;
  }

  const isBusy = !useLocalList && searchFetching;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Orders Management</Typography>
        {canReindexOrders && (
        <Button
          variant="outlined"
          color="secondary"
          startIcon={<CloudSync />}
          onClick={() => void handleReindex()}
          disabled={reindexing}
        >
          {reindexing ? 'Indexing…' : 'Rebuild search index'}
        </Button>
        )}
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
        {[
          { label: 'Pending', count: ordersByStatus.Pending, color: 'warning.main' },
          { label: 'Fulfillment', count: ordersByStatus.Fulfillment, color: 'primary.main' },
          { label: 'In Transit', count: ordersByStatus.Transit, color: 'info.main' },
          { label: 'Delivered', count: ordersByStatus.Delivered, color: 'success.main' },
          { label: 'Cancelled', count: ordersByStatus.Cancelled, color: 'error.main' },
        ].map((stat) => (
          <Grid item xs={12} sm={6} md={2.4} key={stat.label}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography color="textSecondary" variant="subtitle2" gutterBottom>{stat.label}</Typography>
                <Typography variant="h4" sx={{ color: stat.color }}>{stat.count}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters & exports */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} lg={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search orders..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <TextField
              fullWidth
              size="small"
              label="From"
              type="datetime-local"
              value={fromDateFilter}
              onChange={(e) => {
                setFromDateFilter(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <TextField
              fullWidth
              size="small"
              label="To"
              type="datetime-local"
              value={toDateFilter}
              onChange={(e) => {
                setToDateFilter(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrderStatus | 'All');
                  setPage(1);
                }}
              >
                <MenuItem value="All">All Statuses</MenuItem>
                <MenuItem value="Pending">Pending</MenuItem>
                <MenuItem value="Order Fulfillment">Order Fulfillment</MenuItem>
                <MenuItem value="In Transit">In Transit</MenuItem>
                <MenuItem value="Delivered">Delivered</MenuItem>
                <MenuItem value="Cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm="auto">
            <Box display="flex" gap={0.5} alignItems="center" height="100%">
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  const range = getDefaultOrdersFilterRangeIST();
                  setFromDateFilter(range.fromDateTime);
                  setToDateFilter(range.toDateTime);
                  setPage(1);
                }}
              >
                Last 7 days
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  const range = getDefaultNoonToNoonRangeIST();
                  setFromDateFilter(range.fromDateTime);
                  setToDateFilter(range.toDateTime);
                  setPage(1);
                }}
              >
                Today
              </Button>
              {(fromDateFilter || toDateFilter) && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    setFromDateFilter('');
                    setToDateFilter('');
                    setPage(1);
                  }}
                >
                  All dates
                </Button>
              )}
            </Box>
          </Grid>
        </Grid>

        {dateRangeInvalid && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            From must be before To.
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        <Box display="flex" justifyContent="flex-end" flexWrap="wrap" gap={1}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Download />}
            onClick={() =>
              setPendingExportDialog({
                open: true,
                ...getDefaultNoonToNoonRangeIST(),
              })
            }
            disabled={isExporting || isExportingProductSummary}
          >
            {isExporting ? 'Exporting…' : 'Export Pending Orders'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Download />}
            onClick={() =>
              setProductSummaryDialog({
                open: true,
                ...getDefaultNoonToNoonRangeIST(),
              })
            }
            disabled={isExporting || isExportingProductSummary}
          >
            {isExportingProductSummary ? 'Exporting…' : 'Export Product Summary'}
          </Button>
        </Box>
      </Paper>

      {/* Orders Table */}
      <TableContainer component={Paper}>
        {isBusy && <LinearProgress />}
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="id" label="Order ID" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="orderDate" label="Date & Time" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="storeName" label="Store Name" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="retailer" label="Email" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No orders found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((order) => (
                <TableRow key={order.id} hover onClick={() => navigate(`/orders/${order.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>#{formatOrderNumberForDisplay(order.id)}</TableCell>
                  <TableCell>{format(order.orderDate, 'MMM dd, yyyy hh:mm a')}</TableCell>
                  <TableCell>{order.storeName}</TableCell>
                  <TableCell>{order.retailerEmail || 'N/A'}</TableCell>
                  <TableCell>{order.itemCount} items</TableCell>
                  <TableCell>
                    {order.status === 'Pending' ? (
                      <Typography variant="caption" color="textSecondary">-</Typography>
                    ) : (
                      <>₹{order.totalAmount.toFixed(2)}</>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={order.status}
                      color={getStatusColor(order.status) as any}
                      size="small"
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/orders/${order.id}`);
                      }}
                    >
                      <Visibility />
                    </IconButton>
                    {canEditOrders && order.status !== 'Cancelled' && order.status !== 'Delivered' && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelDialog({ open: true, orderId: order.id, reason: '' });
                        }}
                      >
                        <Cancel />
                      </IconButton>
                    )}
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
            Showing {(page - 1) * ROWS_PER_PAGE + 1} to {Math.min(page * ROWS_PER_PAGE, totalCount)} of {totalCount} orders
          </Typography>
        </Box>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ ...cancelDialog, open: false })}>
        <DialogTitle>Cancel Order</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>Are you sure you want to cancel order #{formatOrderNumberForDisplay(cancelDialog.orderId)}?</Typography>
          <TextField
            fullWidth
            label="Reason for cancellation"
            multiline
            rows={3}
            value={cancelDialog.reason}
            onChange={(e) => setCancelDialog({ ...cancelDialog, reason: e.target.value })}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialog({ ...cancelDialog, open: false })}>Keep Order</Button>
          <Button 
            variant="contained" 
            color="error" 
            onClick={handleCancelOrder}
            disabled={!cancelDialog.reason || cancelOrderMutation.isPending}
          >
            Cancel Order
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={pendingExportDialog.open}
        onClose={() =>
          !isExporting && setPendingExportDialog((prev) => ({ ...prev, open: false }))
        }
      >
        <DialogTitle>Export Pending Orders</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the order date &amp; time range (IST). Defaults to one day from 12:00 to 12:00.
          </Typography>
          <Box display="flex" gap={2} flexWrap="wrap" sx={{ pt: 1 }}>
            <TextField
              label="From"
              type="datetime-local"
              value={pendingExportDialog.fromDateTime}
              onChange={(e) =>
                setPendingExportDialog((prev) => ({ ...prev, fromDateTime: e.target.value }))
              }
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
              disabled={isExporting}
              sx={{ minWidth: 240 }}
            />
            <TextField
              label="To"
              type="datetime-local"
              value={pendingExportDialog.toDateTime}
              onChange={(e) =>
                setPendingExportDialog((prev) => ({ ...prev, toDateTime: e.target.value }))
              }
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
              disabled={isExporting}
              sx={{ minWidth: 240 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPendingExportDialog((prev) => ({ ...prev, open: false }))}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<Download />}
            onClick={() => void handleExportPendingOrders()}
            disabled={
              isExporting ||
              !pendingExportDialog.fromDateTime ||
              !pendingExportDialog.toDateTime
            }
          >
            {isExporting ? 'Exporting…' : 'Download Excel'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={productSummaryDialog.open}
        onClose={() =>
          !isExportingProductSummary &&
          !isPublishingPurchaseList &&
          setProductSummaryDialog((prev) => ({ ...prev, open: false }))
        }
      >
        <DialogTitle>Product Summary</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the order date &amp; time range for Excel download (IST; defaults to one day from
            12:00 to 12:00). Publish uses net remaining need for the selected To calendar date
            (subtracts quantities already found by the Purchase Officer). Open lists are superseded.
            Scheduled auto-publish runs daily at 12:00 and 15:00 IST.
          </Typography>
          <Box display="flex" gap={2} flexWrap="wrap" sx={{ pt: 1 }}>
            <TextField
              label="From"
              type="datetime-local"
              value={productSummaryDialog.fromDateTime}
              onChange={(e) =>
                setProductSummaryDialog((prev) => ({ ...prev, fromDateTime: e.target.value }))
              }
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
              disabled={isExportingProductSummary || isPublishingPurchaseList}
              sx={{ minWidth: 240 }}
            />
            <TextField
              label="To"
              type="datetime-local"
              value={productSummaryDialog.toDateTime}
              onChange={(e) =>
                setProductSummaryDialog((prev) => ({ ...prev, toDateTime: e.target.value }))
              }
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 60 }}
              disabled={isExportingProductSummary || isPublishingPurchaseList}
              sx={{ minWidth: 240 }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            onClick={() => setProductSummaryDialog((prev) => ({ ...prev, open: false }))}
            disabled={isExportingProductSummary || isPublishingPurchaseList}
          >
            Cancel
          </Button>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={() => void handleExportPendingProductSummary()}
            disabled={
              isExportingProductSummary ||
              isPublishingPurchaseList ||
              !productSummaryDialog.fromDateTime ||
              !productSummaryDialog.toDateTime
            }
          >
            {isExportingProductSummary ? 'Exporting...' : 'Download Excel'}
          </Button>
          <Button
            variant="contained"
            startIcon={<Publish />}
            onClick={() => void handlePublishPurchaseList()}
            disabled={
              isExportingProductSummary ||
              isPublishingPurchaseList ||
              !productSummaryDialog.fromDateTime ||
              !productSummaryDialog.toDateTime
            }
          >
            {isPublishingPurchaseList ? 'Publishing...' : 'Publish to Purchase App'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

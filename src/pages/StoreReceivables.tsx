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
  Chip,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardContent,
  Pagination,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  FormControlLabel,
  Switch,
} from '@mui/material';
import { Search, Visibility, Receipt } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useReceivableOrders } from '../hooks/useOrders';
import { useStores, useGrantOrderBlockOverride } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { OrderPlacementStatusChip } from '../components/OrderPlacementStatusChip';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  buildStoreReceivableSummaries,
  formatOrderInvoiceLabel,
  type StoreReceivableSummary,
} from '../utils/storeReceivables';
import {
  buildOrderPlacementBlockedRetailerIds,
  buildPaymentOverdueRetailerIds,
  isOrderPlacementBlockingOrder,
} from '../utils/retailerPaymentBlock';
import { Order } from '../types';
import { useAppDialog } from '../context/AppDialogProvider';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const paymentChipColor = (status?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'Paid') return 'success';
  if (status === 'Partial') return 'warning';
  if (status === 'Unpaid' || !status) return 'error';
  return 'default';
};

export const StoreReceivablesPage: React.FC = () => {
  const { data: orders, isLoading: ordersLoading } = useReceivableOrders();
  const { data: stores, isLoading: storesLoading } = useStores();
  const grantOverrideMutation = useGrantOrderBlockOverride();
  const { alert, confirm } = useAppDialog();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [orderBlockedOnly, setOrderBlockedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [drillDown, setDrillDown] = useState<StoreReceivableSummary | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('outstanding', 'desc');

  const summaries = useMemo(
    () => buildStoreReceivableSummaries(orders ?? [], stores ?? []),
    [orders, stores]
  );

  const overrideUntilByRetailerId = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const s of stores ?? []) {
      map.set(s.id, s.orderBlockOverrideUntil);
    }
    return map;
  }, [stores]);

  const overdueRetailerIds = useMemo(
    () => buildPaymentOverdueRetailerIds(orders ?? []),
    [orders]
  );

  const blockedRetailerIds = useMemo(
    () =>
      buildOrderPlacementBlockedRetailerIds(orders ?? [], {
        overrideUntilByRetailerId,
      }),
    [orders, overrideUntilByRetailerId]
  );

  const handleGrantOrderOverride = async (retailerId: string) => {
    const row = summaries.find((s) => s.retailerId === retailerId);
    const name = row?.displayName || 'this store';
    const ok = await confirm(
      `Enable ordering for ${name} for the next 6 hours? The retailer will be able to place orders even if payment is overdue.`,
      { title: 'Unlock ordering (6 hours)', confirmLabel: 'Enable 6 hours' }
    );
    if (!ok) return;
    try {
      const until = await grantOverrideMutation.mutateAsync(retailerId);
      await alert(
        `Ordering unlocked until ${format(until, 'MMM dd, h:mm a')}.`,
        { severity: 'success' }
      );
    } catch (e: any) {
      await alert(e?.message || 'Failed to unlock ordering', { severity: 'error' });
    }
  };

  const totals = useMemo(() => {
    const totalOutstanding = summaries.reduce((s, r) => s + r.totalOutstanding, 0);
    const openBills = summaries.reduce((s, r) => s + r.orderCount, 0);
    return {
      totalOutstanding,
      storesWithDues: summaries.length,
      openBills,
      orderBlockedStores: summaries.filter((s) => blockedRetailerIds.has(s.retailerId)).length,
    };
  }, [summaries, blockedRetailerIds]);

  const filteredSummaries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return summaries.filter((s) => {
      if (orderBlockedOnly && !blockedRetailerIds.has(s.retailerId)) return false;
      if (!q) return true;
      return (
        s.displayName.toLowerCase().includes(q) ||
        s.storeCode.toLowerCase().includes(q) ||
        s.retailerEmail.toLowerCase().includes(q)
      );
    });
  }, [summaries, searchTerm, orderBlockedOnly, blockedRetailerIds]);

  const sortedSummaries = useMemo(() => {
    const list = [...filteredSummaries];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'storeCode':
          return applyDirection(compareAsc(a.storeCode, b.storeCode), sortDirection);
        case 'displayName':
          return applyDirection(
            compareAsc(a.displayName.toLowerCase(), b.displayName.toLowerCase()),
            sortDirection
          );
        case 'orderCount':
          return applyDirection(compareAsc(a.orderCount, b.orderCount), sortDirection);
        case 'outstanding':
          return applyDirection(compareAsc(a.totalOutstanding, b.totalOutstanding), sortDirection);
        case 'oldest':
          return applyDirection(
            compareAsc(
              a.oldestOrderDate ? toTimeMs(a.oldestOrderDate) : 0,
              b.oldestOrderDate ? toTimeMs(b.oldestOrderDate) : 0
            ),
            sortDirection
          );
        case 'orderBlocked':
          return applyDirection(
            compareAsc(
              blockedRetailerIds.has(a.retailerId) ? 1 : 0,
              blockedRetailerIds.has(b.retailerId) ? 1 : 0
            ),
            sortDirection
          );
        default:
          return applyDirection(compareAsc(a.totalOutstanding, b.totalOutstanding), sortDirection);
      }
    });
    return list;
  }, [filteredSummaries, sortKey, sortDirection, blockedRetailerIds]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const totalPages = Math.ceil(sortedSummaries.length / rowsPerPage);
  const paginatedSummaries = sortedSummaries.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  if (ordersLoading || storesLoading) {
    return <Loading message="Loading store receivables..." />;
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Store receivables
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Outstanding bills from medical stores. Open a store to see unpaid orders, then collect
          payment on the order details page. Click Order blocked to unlock ordering for 6 hours.
          Stores still overdue after unlock show Unlocked until…
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total outstanding
              </Typography>
              <Typography variant="h5" color="error.main" fontWeight={600}>
                {formatCurrency(totals.totalOutstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Stores with dues
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.storesWithDues}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Open bills
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.openBills}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Order blocked
              </Typography>
              <Typography variant="h5" color="warning.main" fontWeight={600}>
                {totals.orderBlockedStores}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
          <TextField
            fullWidth
            placeholder="Search by shop name, store code, or email..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ flex: '1 1 280px', minWidth: 0 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={orderBlockedOnly}
                onChange={(e) => {
                  setOrderBlockedOnly(e.target.checked);
                  setPage(1);
                }}
                color="warning"
              />
            }
            label={`Order blocked only${totals.orderBlockedStores ? ` (${totals.orderBlockedStores})` : ''}`}
          />
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="storeCode"
                label="Store code"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="displayName"
                label="Medical store"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="orderBlocked"
                label="Ordering"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="orderCount"
                label="Open bills"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="outstanding"
                label="Outstanding"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="oldest"
                label="Oldest bill"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedSummaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {summaries.length === 0
                      ? 'No outstanding receivables — all store bills are paid.'
                      : 'No stores match your search.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedSummaries.map((row) => (
                <TableRow key={row.retailerId} hover>
                  <TableCell>{row.storeCode}</TableCell>
                  <TableCell>
                    <Typography fontWeight={500}>{row.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.retailerEmail}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <OrderPlacementStatusChip
                      retailerId={row.retailerId}
                      overdue={overdueRetailerIds.has(row.retailerId)}
                      overrideUntil={overrideUntilByRetailerId.get(row.retailerId)}
                      onGrantOverride={handleGrantOrderOverride}
                      disabled={grantOverrideMutation.isPending}
                    />
                  </TableCell>
                  <TableCell align="right">{row.orderCount}</TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={600} color="error.main">
                      {formatCurrency(row.totalOutstanding)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.oldestOrderDate
                      ? format(row.oldestOrderDate, 'MMM dd, yyyy')
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Receipt />}
                      onClick={() => setDrillDown(row)}
                    >
                      View bills
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {sortedSummaries.length > 0 && (
        <Box display="flex" justifyContent="center" mt={3}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
          />
        </Box>
      )}

      <Dialog
        open={!!drillDown}
        onClose={() => setDrillDown(null)}
        maxWidth="md"
        fullWidth
      >
        {drillDown && (
          <>
            <DialogTitle>
              Outstanding bills — {drillDown.displayName}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {drillDown.storeCode} · {formatCurrency(drillDown.totalOutstanding)} due across{' '}
                {drillDown.orderCount} bill{drillDown.orderCount === 1 ? '' : 's'}
                {overdueRetailerIds.has(drillDown.retailerId) &&
                !blockedRetailerIds.has(drillDown.retailerId)
                  ? ' · Ordering temporarily unlocked (6h override)'
                  : blockedRetailerIds.has(drillDown.retailerId)
                    ? ' · Order placement blocked in retailer app'
                    : ''}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">Paid</TableCell>
                      <TableCell align="right">Due</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drillDown.orders.map((order) => (
                      <ReceivableOrderRow
                        key={order.id}
                        order={order}
                        onOpen={() => {
                          setDrillDown(null);
                          navigate(`/orders/${order.id}`);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDrillDown(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

const ReceivableOrderRow: React.FC<{
  order: Order & { outstanding: number };
  onOpen: () => void;
}> = ({ order, onOpen }) => {
  const paid = order.paidAmount ?? 0;
  const total = order.totalAmount ?? 0;
  const blocksOrdering = isOrderPlacementBlockingOrder(order);

  return (
    <TableRow hover>
      <TableCell>{formatOrderInvoiceLabel(order)}</TableCell>
      <TableCell>
        {format(
          order.orderDate instanceof Date ? order.orderDate : new Date(order.orderDate),
          'MMM dd, yyyy'
        )}
      </TableCell>
      <TableCell>
        <Box display="flex" flexWrap="wrap" gap={0.5} alignItems="center">
          <Chip
            size="small"
            label={order.paymentStatus || 'Unpaid'}
            color={paymentChipColor(order.paymentStatus)}
          />
          {blocksOrdering ? (
            <Chip
              size="small"
              color="warning"
              label="Blocks orders"
              title="Delivered more than 2 days ago with unpaid balance"
            />
          ) : null}
        </Box>
      </TableCell>
      <TableCell align="right">{formatCurrency(total)}</TableCell>
      <TableCell align="right">{formatCurrency(paid)}</TableCell>
      <TableCell align="right">
        <Typography fontWeight={600} color="error.main">
          {formatCurrency(order.outstanding)}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <IconButton size="small" onClick={onOpen} title="Open order & collect payment">
          <Visibility />
        </IconButton>
      </TableCell>
    </TableRow>
  );
};

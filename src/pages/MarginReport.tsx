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
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
  Pagination,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
} from '@mui/material';
import { Search, Visibility, TrendingUp, InfoOutlined } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useOrders } from '../hooks/useOrders';
import { useMedicines } from '../hooks/useInventory';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useCreditNotes } from '../hooks/useCreditNotes';
import { useExpiryReturns } from '../hooks/useExpiryReturns';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import { computeOrderMarginSummary } from '../utils/orderLineMargin';
import { computeReturnMarginSummary } from '../utils/returnMargin';
import { coerceToDate, dateInMarginPeriod, type MarginPeriodFilter } from '../utils/marginPeriod';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { formatOrderNumberForDisplay } from '../utils/orderDisplay';

type PeriodFilter = MarginPeriodFilter;

type MarginOrderRow = {
  order: Order;
  netSalesExGst: number;
  cogsExGst: number;
  grossProfitExGst: number;
  marginPct: number | null;
  lineCount: number;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Pending':
      return 'warning';
    case 'Order Fulfillment':
      return 'primary';
    case 'In Transit':
      return 'info';
    case 'Delivered':
      return 'success';
    case 'Cancelled':
      return 'error';
    default:
      return 'default';
  }
};

const orderDate = (o: Order): Date => coerceToDate(o.orderDate);

const inPeriod = (date: Date, period: PeriodFilter): boolean =>
  dateInMarginPeriod(date, period);

export const MarginReportPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const { data: purchaseInvoices } = usePurchaseInvoices();
  const { data: creditNotes } = useCreditNotes();
  const { data: expiryReturns } = useExpiryReturns();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('Delivered');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('this_month');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(15);
  const [detailOrder, setDetailOrder] = useState<MarginOrderRow | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('orderDate', 'desc');

  const marginRows = useMemo((): MarginOrderRow[] => {
    const medList = medicines ?? [];
    const list = orders ?? [];
    const rows: MarginOrderRow[] = [];

    for (const order of list) {
      if (order.status === 'Cancelled') continue;
      if (statusFilter !== 'All' && order.status !== statusFilter) continue;
      const d = orderDate(order);
      if (!inPeriod(d, periodFilter)) continue;

      const summary = computeOrderMarginSummary(
        medList,
        order.medicines ?? [],
        order.taxPercentage,
        purchaseInvoices
      );
      if (summary.lines.length === 0) continue;

      rows.push({
        order,
        netSalesExGst: summary.netSalesExGst,
        cogsExGst: summary.cogsExGst,
        grossProfitExGst: summary.grossProfitExGst,
        marginPct: summary.marginPct,
        lineCount: summary.lines.length,
      });
    }
    return rows;
  }, [orders, medicines, purchaseInvoices, statusFilter, periodFilter]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return marginRows;
    return marginRows.filter((row) => {
      const o = row.order;
      return (
        o.id.toLowerCase().includes(q) ||
        (o.retailerEmail?.toLowerCase().includes(q) ?? false) ||
        (o.retailerName?.toLowerCase().includes(q) ?? false) ||
        (o.invoiceNumber?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [marginRows, searchTerm]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'orderDate':
          return applyDirection(
            compareAsc(toTimeMs(a.order.orderDate), toTimeMs(b.order.orderDate)),
            sortDirection
          );
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.order.retailerEmail || a.order.retailerName || ''}`.toLowerCase(),
              `${b.order.retailerEmail || b.order.retailerName || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'netSales':
          return applyDirection(compareAsc(a.netSalesExGst, b.netSalesExGst), sortDirection);
        case 'cogs':
          return applyDirection(compareAsc(a.cogsExGst, b.cogsExGst), sortDirection);
        case 'profit':
          return applyDirection(compareAsc(a.grossProfitExGst, b.grossProfitExGst), sortDirection);
        case 'margin':
          return applyDirection(
            compareAsc(a.marginPct ?? -1, b.marginPct ?? -1),
            sortDirection
          );
        case 'status':
          return applyDirection(compareAsc(a.order.status, b.order.status), sortDirection);
        default:
          return applyDirection(
            compareAsc(toTimeMs(a.order.orderDate), toTimeMs(b.order.orderDate)),
            'desc'
          );
      }
    });
    return list;
  }, [filteredRows, sortKey, sortDirection]);

  const returnSummary = useMemo(
    () =>
      computeReturnMarginSummary(
        creditNotes,
        expiryReturns,
        medicines ?? [],
        periodFilter,
        purchaseInvoices
      ),
    [creditNotes, expiryReturns, medicines, periodFilter, purchaseInvoices]
  );

  const summary = useMemo(() => {
    const netSales = filteredRows.reduce((s, r) => s + r.netSalesExGst, 0);
    const cogs = filteredRows.reduce((s, r) => s + r.cogsExGst, 0);
    const grossProfit = netSales - cogs;
    const netSalesAfterReturns = netSales - returnSummary.salesReversalExGst;
    const cogsAfterReturns = cogs - returnSummary.cogsReversalExGst;
    const netGrossProfit = grossProfit - returnSummary.grossProfitReversalExGst;
    return {
      orderCount: filteredRows.length,
      netSales,
      cogs,
      grossProfit,
      marginPct: netSales > 0 ? (grossProfit / netSales) * 100 : null,
      returnSalesReversal: returnSummary.salesReversalExGst,
      returnCogsReversal: returnSummary.cogsReversalExGst,
      returnProfitReversal: returnSummary.grossProfitReversalExGst,
      netSalesAfterReturns,
      cogsAfterReturns,
      netGrossProfit,
      netMarginPct:
        netSalesAfterReturns > 0 ? (netGrossProfit / netSalesAfterReturns) * 100 : null,
      orderReturnCount: returnSummary.orderReturnDocCount,
      expiryReturnCount: returnSummary.expiryReturnDocCount,
    };
  }, [filteredRows, returnSummary]);

  const paginatedRows = sortedRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));

  if (ordersLoading || medicinesLoading) {
    return <Loading message="Loading margin report..." />;
  }

  const returnLines = returnSummary.lines;

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
          Margin report
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Profit per order from batch purchase cost vs invoice selling price (ex-GST, after line
          discount). Returns (order credit notes and approved expiry returns) reduce net margin below.
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderLeft: 4,
              borderLeftColor: theme.palette.warning.main,
              bgcolor: alpha(theme.palette.warning.main, 0.04),
            }}
          >
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Net gross profit
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                ₹{Math.round(summary.netGrossProfit).toLocaleString('en-IN')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                After {summary.orderReturnCount + summary.expiryReturnCount} return(s)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Returns (ex-GST)
              </Typography>
              <Typography variant="h5" fontWeight={700} color="warning.main">
                −₹{Math.round(summary.returnSalesReversal).toLocaleString('en-IN')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                COGS back: ₹{Math.round(summary.returnCogsReversal).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Net margin
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {summary.netMarginPct !== null ? `${summary.netMarginPct.toFixed(1)}%` : '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Before returns: {summary.marginPct !== null ? `${summary.marginPct.toFixed(1)}%` : '—'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Orders in report
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {summary.orderCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', opacity: 0.92 }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Gross profit (orders only)
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                ₹{Math.round(summary.grossProfit).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', opacity: 0.92 }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Net sales (orders only)
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                ₹{Math.round(summary.netSales).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', opacity: 0.92 }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Net sales after returns
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                ₹{Math.round(summary.netSalesAfterReturns).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', opacity: 0.92 }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Order returns
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                {summary.orderReturnCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={0} sx={{ border: 1, borderColor: 'divider', opacity: 0.92 }}>
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Expiry returns
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                {summary.expiryReturnCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search order, retailer, invoice…"
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
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrderStatus | 'All');
                  setPage(1);
                }}
              >
                <MenuItem value="All">All (non-cancelled)</MenuItem>
                <MenuItem value="Delivered">Delivered</MenuItem>
                <MenuItem value="In Transit">In Transit</MenuItem>
                <MenuItem value="Order Fulfillment">Order Fulfillment</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Period</InputLabel>
              <Select
                label="Period"
                value={periodFilter}
                onChange={(e) => {
                  setPeriodFilter(e.target.value as PeriodFilter);
                  setPage(1);
                }}
              >
                <MenuItem value="this_month">This month</MenuItem>
                <MenuItem value="last_month">Last month</MenuItem>
                <MenuItem value="all">All time</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <InfoOutlined fontSize="small" color="action" />
          <Typography variant="caption" color="text.secondary">
            COGS uses purchase invoice batch price (blended when vendor scheme applies). Revenue
            matches order tax invoice economics.
          </Typography>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell
                columnId="orderDate"
                label="Date"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell>Order</TableCell>
              <SortableTableHeadCell
                columnId="retailer"
                label="Retailer"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="status"
                label="Status"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="netSales"
                label="Net sales"
                align="right"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="cogs"
                label="COGS"
                align="right"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="profit"
                label="Gross profit"
                align="right"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="margin"
                label="Margin"
                align="right"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <TableCell align="center">Lines</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No orders with margin data for the selected filters. Orders need batch
                    assignments and batch purchase price from purchase invoices.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((row) => (
                <TableRow key={row.order.id} hover>
                  <TableCell>
                    {format(orderDate(row.order), 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      #{formatOrderNumberForDisplay(row.order.id)}
                    </Typography>
                    {row.order.invoiceNumber && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.order.invoiceNumber}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.order.retailerEmail || row.order.retailerName || '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.order.status}
                      size="small"
                      color={getStatusColor(row.order.status) as any}
                    />
                  </TableCell>
                  <TableCell align="right">₹{row.netSalesExGst.toFixed(2)}</TableCell>
                  <TableCell align="right">₹{row.cogsExGst.toFixed(2)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color:
                        row.grossProfitExGst >= 0 ? 'success.main' : 'error.main',
                      fontWeight: 600,
                    }}
                  >
                    ₹{row.grossProfitExGst.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">
                    {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell align="center">{row.lineCount}</TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      title="Line breakdown"
                      onClick={() => setDetailOrder(row)}
                    >
                      <TrendingUp fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title="Open order"
                      onClick={() => navigate(`/orders/${row.order.id}`)}
                    >
                      <Visibility fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {sortedRows.length > rowsPerPage && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}

      {returnLines.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Returns & adjustments
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Order returns (credit notes) and approved/paid expiry returns in the selected period.
            Profit impact = refund ex-GST minus landed cost of stock restored.
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Retailer</TableCell>
                  <TableCell>Medicine</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Sales reversal</TableCell>
                  <TableCell align="right">COGS reversal</TableCell>
                  <TableCell align="right">Profit impact</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {returnLines.map((line, idx) => (
                  <TableRow key={`${line.source}-${line.referenceId}-${idx}`}>
                    <TableCell>{format(line.date, 'dd MMM yyyy')}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={line.source === 'order_return' ? 'Order return' : 'Expiry return'}
                        color={line.source === 'order_return' ? 'primary' : 'warning'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{line.referenceLabel}</TableCell>
                    <TableCell>{line.retailerLabel || '—'}</TableCell>
                    <TableCell>{line.medicineName || '—'}</TableCell>
                    <TableCell>{line.batchNumber || '—'}</TableCell>
                    <TableCell align="right">{line.quantity}</TableCell>
                    <TableCell align="right" sx={{ color: 'warning.main' }}>
                      −₹{line.salesReversalExGst.toFixed(2)}
                    </TableCell>
                    <TableCell align="right">₹{line.cogsReversalExGst.toFixed(2)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: 600,
                        color: line.grossProfitReversalExGst >= 0 ? 'warning.main' : 'success.main',
                      }}
                    >
                      −₹{line.grossProfitReversalExGst.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Dialog
        open={detailOrder !== null}
        onClose={() => setDetailOrder(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Margin breakdown — Order #{detailOrder?.order?.id ? formatOrderNumberForDisplay(detailOrder.order.id) : '—'}
        </DialogTitle>
        <DialogContent dividers>
          {detailOrder && (
            <>
              <Box display="flex" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
                <Typography variant="body2" color="text.secondary">
                  {detailOrder.order.retailerEmail || detailOrder.order.retailerName}
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  Gross profit: ₹{detailOrder.grossProfitExGst.toFixed(2)}
                  {detailOrder.marginPct !== null &&
                    ` (${detailOrder.marginPct.toFixed(1)}%)`}
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Medicine</TableCell>
                    <TableCell align="right">Net sales</TableCell>
                    <TableCell align="right">COGS</TableCell>
                    <TableCell align="right">Profit</TableCell>
                    <TableCell align="right">Margin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {computeOrderMarginSummary(
                    medicines ?? [],
                    detailOrder.order.medicines ?? [],
                    detailOrder.order.taxPercentage,
                    purchaseInvoices
                  ).lines.map((line, idx) => (
                    <TableRow key={`${line.medicineId}-${idx}`}>
                      <TableCell>{line.name || '—'}</TableCell>
                      <TableCell align="right">₹{line.netSalesExGst.toFixed(2)}</TableCell>
                      <TableCell align="right">₹{line.cogsExGst.toFixed(2)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          color: line.grossProfitExGst >= 0 ? 'success.main' : 'error.main',
                        }}
                      >
                        ₹{line.grossProfitExGst.toFixed(2)}
                      </TableCell>
                      <TableCell align="right">
                        {line.marginPct !== null ? `${line.marginPct.toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOrder(null)}>Close</Button>
          {detailOrder && (
            <Button
              variant="contained"
              onClick={() => {
                navigate(`/orders/${detailOrder.order.id}`);
                setDetailOrder(null);
              }}
            >
              Open order
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

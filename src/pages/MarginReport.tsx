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
import { Order, OrderStatus } from '../types';
import { format, startOfMonth, isBefore, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { Loading } from '../components/Loading';
import { useNavigate } from 'react-router-dom';
import { computeOrderMarginSummary } from '../utils/orderLineMargin';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';

type PeriodFilter = 'this_month' | 'last_month' | 'all';

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

const orderDate = (o: Order): Date => {
  const d = o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

const inPeriod = (date: Date, period: PeriodFilter): boolean => {
  const now = new Date();
  if (period === 'all') return true;
  if (period === 'this_month') {
    const start = startOfMonth(now);
    return !isBefore(date, start);
  }
  const lastStart = startOfMonth(subMonths(now, 1));
  const lastEnd = endOfMonth(subMonths(now, 1));
  return isWithinInterval(date, { start: lastStart, end: lastEnd });
};

export const MarginReportPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: medicines, isLoading: medicinesLoading } = useMedicines();
  const { data: purchaseInvoices } = usePurchaseInvoices();

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

  const summary = useMemo(() => {
    const netSales = filteredRows.reduce((s, r) => s + r.netSalesExGst, 0);
    const cogs = filteredRows.reduce((s, r) => s + r.cogsExGst, 0);
    const grossProfit = netSales - cogs;
    return {
      orderCount: filteredRows.length,
      netSales,
      cogs,
      grossProfit,
      marginPct: netSales > 0 ? (grossProfit / netSales) * 100 : null,
    };
  }, [filteredRows]);

  const paginatedRows = sortedRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));

  if (ordersLoading || medicinesLoading) {
    return <Loading message="Loading margin report..." />;
  }

  const accent = {
    success: theme.palette.success.main,
    primary: theme.palette.primary.main,
    info: theme.palette.info.main,
  };

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
          Margin report
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Profit per order from batch purchase cost vs invoice selling price (ex-GST, after line
          discount). Only orders with batch allocations and batch cost in inventory are included.
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
              borderLeftColor: accent.success,
              bgcolor: alpha(accent.success, 0.04),
            }}
          >
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Gross profit
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                ₹{Math.round(summary.grossProfit).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderLeft: 4,
              borderLeftColor: accent.primary,
              bgcolor: alpha(accent.primary, 0.04),
            }}
          >
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Net sales (ex-GST)
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                ₹{Math.round(summary.netSales).toLocaleString('en-IN')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderLeft: 4,
              borderLeftColor: accent.info,
              bgcolor: alpha(accent.info, 0.04),
            }}
          >
            <CardContent>
              <Typography color="text.secondary" variant="body2" gutterBottom>
                Avg margin
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {summary.marginPct !== null ? `${summary.marginPct.toFixed(1)}%` : '—'}
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
                      #{row.order.id.substring(0, 8)}
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

      <Dialog
        open={detailOrder !== null}
        onClose={() => setDetailOrder(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Margin breakdown — Order #{detailOrder?.order.id.substring(0, 8)}
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

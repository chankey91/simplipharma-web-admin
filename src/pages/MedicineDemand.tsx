import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Chip,
  Pagination,
  Button,
  Alert,
} from '@mui/material';
import { Search, Inventory2 } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useOrdersInDateRange } from '../hooks/useOrders';
import { useMedicinesByIds } from '../hooks/useInventory';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import {
  aggregateMedicineDemand,
  attachStockToDemandRows,
  demandPeriodRange,
  type DemandPeriodPreset,
  type MedicineDemandRow,
} from '../utils/medicineDemand';

const ROWS_PER_PAGE = 25;

const PERIOD_OPTIONS: { value: DemandPeriodPreset; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
];

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

export const MedicineDemandPage: React.FC = () => {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<DemandPeriodPreset>('last_30_days');
  const [customFrom, setCustomFrom] = useState(toInputDate(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(toInputDate(new Date()));
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const { sortKey, sortDirection, requestSort } = useTableSort('qtySold', 'desc');

  const range = useMemo(() => {
    const from = period === 'custom' && customFrom ? new Date(customFrom) : null;
    const to = period === 'custom' && customTo ? new Date(customTo) : null;
    return demandPeriodRange(period, from, to);
  }, [period, customFrom, customTo]);

  // endMs exclusive for Firestore `<` bound
  const { data: orders, isLoading: ordersLoading, isFetching } = useOrdersInDateRange(
    range.startMs,
    range.endMs + 1
  );

  const baseRows = useMemo(() => {
    if (!orders) return [];
    return aggregateMedicineDemand(orders, range.startMs, range.endMs, range.daySpan);
  }, [orders, range.startMs, range.endMs, range.daySpan]);

  const medicineIds = useMemo(() => baseRows.map((r) => r.medicineId), [baseRows]);
  const { data: medicines, isLoading: medsLoading } = useMedicinesByIds(medicineIds);

  const rows: MedicineDemandRow[] = useMemo(() => {
    const stockMap = new Map<string, number>();
    for (const m of medicines ?? []) {
      const stock =
        typeof m.currentStock === 'number'
          ? m.currentStock
          : typeof m.stock === 'number'
            ? m.stock
            : (m.stockBatches || []).reduce((s, b) => s + (Number(b.quantity) || 0), 0);
      stockMap.set(m.id, stock);
    }
    return attachStockToDemandRows(baseRows, stockMap, range.daySpan);
  }, [baseRows, medicines, range.daySpan]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = rows;
    if (term) {
      list = list.filter(
        (r) =>
          r.medicineName.toLowerCase().includes(term) ||
          r.medicineId.toLowerCase().includes(term)
      );
    }
    if (lowStockOnly) {
      list = list.filter((r) => r.stockGapVsWeekly < 0);
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'medicineName':
          cmp = compareAsc(a.medicineName, b.medicineName);
          break;
        case 'orderCount':
          cmp = compareAsc(a.orderCount, b.orderCount);
          break;
        case 'amount':
          cmp = compareAsc(a.amount, b.amount);
          break;
        case 'avgPerDay':
          cmp = compareAsc(a.avgPerDay, b.avgPerDay);
          break;
        case 'projectedWeekly':
          cmp = compareAsc(a.projectedWeekly, b.projectedWeekly);
          break;
        case 'currentStock':
          cmp = compareAsc(a.currentStock, b.currentStock);
          break;
        case 'stockGapVsWeekly':
          cmp = compareAsc(a.stockGapVsWeekly, b.stockGapVsWeekly);
          break;
        case 'qtySold':
        default:
          cmp = compareAsc(a.qtySold, b.qtySold);
          break;
      }
      return applyDirection(cmp, sortDirection);
    });
    return sorted;
  }, [rows, searchTerm, lowStockOnly, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const summary = useMemo(() => {
    const totalQty = filtered.reduce((s, r) => s + r.qtySold, 0);
    const skus = filtered.length;
    const needRestock = filtered.filter((r) => r.stockGapVsWeekly < 0).length;
    return { totalQty, skus, needRestock };
  }, [filtered]);

  const loading = ordersLoading || (medicineIds.length > 0 && medsLoading);

  if (loading && !orders) {
    return <Loading message="Loading top sellers..." />;
  }

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Top sellers' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5">Top sellers</Typography>
          <Typography variant="body2" color="textSecondary">
            Medicines ranked by units sold — use this to plan stock ahead of purchase
          </Typography>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Counts fulfilled / in-transit / delivered order lines (not pending or cancelled). Current stock
        is compared to projected weekly need from this period&apos;s average daily sales.
      </Alert>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Period</InputLabel>
              <Select
                label="Period"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as DemandPeriodPreset);
                  setPage(1);
                }}
              >
                {PERIOD_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {period === 'custom' && (
            <>
              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="From"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value);
                    setPage(1);
                  }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="To"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value);
                    setPage(1);
                  }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </>
          )}
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search medicine…"
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
          <Grid item xs={12} sm={4} md={2}>
            <Button
              fullWidth
              variant={lowStockOnly ? 'contained' : 'outlined'}
              color={lowStockOnly ? 'warning' : 'primary'}
              onClick={() => {
                setLowStockOnly((v) => !v);
                setPage(1);
              }}
            >
              {lowStockOnly ? 'Showing low stock' : 'Low stock vs weekly'}
            </Button>
          </Grid>
        </Grid>
        <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1 }}>
          {range.label}: {format(new Date(range.startMs), 'dd MMM yyyy')} –{' '}
          {format(new Date(range.endMs), 'dd MMM yyyy')} ({range.daySpan} days)
          {isFetching ? ' · Refreshing…' : ''}
        </Typography>
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="textSecondary">
                SKUs sold
              </Typography>
              <Typography variant="h5">{summary.skus}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="textSecondary">
                Total units sold
              </Typography>
              <Typography variant="h5">{summary.totalQty.toLocaleString('en-IN')}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="textSecondary">
                Below weekly projection
              </Typography>
              <Typography variant="h5" color={summary.needRestock > 0 ? 'warning.main' : 'inherit'}>
                {summary.needRestock}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={48}>#</TableCell>
              <SortableTableHeadCell
                columnId="medicineName"
                label="Medicine"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
              />
              <SortableTableHeadCell
                columnId="qtySold"
                label="Qty sold"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="orderCount"
                label="Orders"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="avgPerDay"
                label="Avg / day"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="projectedWeekly"
                label="Weekly need"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="currentStock"
                label="Stock"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <SortableTableHeadCell
                columnId="stockGapVsWeekly"
                label="Gap vs weekly"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSort}
                align="right"
              />
              <TableCell align="center">Inventory</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="textSecondary" sx={{ py: 4 }}>
                    No sales in this period
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row, i) => {
                const rank = (page - 1) * ROWS_PER_PAGE + i + 1;
                const short = row.stockGapVsWeekly < 0;
                return (
                  <TableRow key={row.medicineId} hover>
                    <TableCell>{rank}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {row.medicineName}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{row.qtySold.toLocaleString('en-IN')}</TableCell>
                    <TableCell align="right">{row.orderCount}</TableCell>
                    <TableCell align="right">{row.avgPerDay}</TableCell>
                    <TableCell align="right">{row.projectedWeekly}</TableCell>
                    <TableCell align="right">{row.currentStock.toLocaleString('en-IN')}</TableCell>
                    <TableCell align="right">
                      {short ? (
                        <Chip
                          size="small"
                          color="warning"
                          label={`${row.stockGapVsWeekly}`}
                          title="Stock below projected weekly need"
                        />
                      ) : (
                        <Typography variant="body2" color="textSecondary">
                          {row.stockGapVsWeekly > 0 ? `+${row.stockGapVsWeekly}` : '0'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Button
                        size="small"
                        startIcon={<Inventory2 fontSize="small" />}
                        onClick={() => navigate(`/inventory/${row.medicineId}`)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pageCount > 1 && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Pagination
            count={pageCount}
            page={Math.min(page, pageCount)}
            onChange={(_, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}
    </Box>
  );
};

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
  FormControlLabel,
  Switch,
} from '@mui/material';
import { Search, CardGiftcard } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useOrdersInDateRange } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc } from '../utils/tableSort';
import {
  buildRetailerIncentiveSummaries,
  currentIstYearMonth,
  istYearMonthBounds,
  RETAILER_INCENTIVE_MONTH_THRESHOLD,
  RETAILER_INCENTIVE_PURCHASE_DISC_MIN,
  RETAILER_INCENTIVE_RATE,
  type RetailerIncentiveSummary,
} from '../utils/retailerIncentives';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RetailerIncentivesPage: React.FC = () => {
  const navigate = useNavigate();
  const [yearMonth, setYearMonth] = useState(currentIstYearMonth());
  const [searchTerm, setSearchTerm] = useState('');
  const [qualifiedOnly, setQualifiedOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(15);
  const [drillDown, setDrillDown] = useState<RetailerIncentiveSummary | null>(null);

  const { startMs, endMsExclusive } = useMemo(() => istYearMonthBounds(yearMonth), [yearMonth]);
  const { data: orders, isLoading: ordersLoading } = useOrdersInDateRange(
    startMs,
    endMsExclusive
  );
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: purchaseInvoices, isLoading: piLoading } = usePurchaseInvoices();

  const { sortKey, sortDirection, requestSort } = useTableSort('incentive', 'desc');

  const summaries = useMemo(
    () =>
      buildRetailerIncentiveSummaries(orders ?? [], stores ?? [], purchaseInvoices ?? [], {
        yearMonth,
      }),
    [orders, stores, purchaseInvoices, yearMonth]
  );

  const totals = useMemo(() => {
    const qualified = summaries.filter((s) => s.qualified);
    return {
      qualifiedCount: qualified.length,
      monthPurchaseQualified: qualified.reduce((s, r) => s + r.monthPurchaseTotal, 0),
      eligibleAmount: qualified.reduce((s, r) => s + r.eligibleAmount, 0),
      incentiveTotal: qualified.reduce((s, r) => s + r.incentiveAmount, 0),
      retailersWithSales: summaries.length,
    };
  }, [summaries]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return summaries.filter((s) => {
      if (qualifiedOnly && !s.qualified) return false;
      if (!q) return true;
      return (
        s.displayName.toLowerCase().includes(q) ||
        s.storeCode.toLowerCase().includes(q) ||
        s.retailerId.toLowerCase().includes(q)
      );
    });
  }, [summaries, searchTerm, qualifiedOnly]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'storeCode':
          return applyDirection(compareAsc(a.storeCode, b.storeCode), sortDirection);
        case 'displayName':
          return applyDirection(compareAsc(a.displayName, b.displayName), sortDirection);
        case 'monthPurchase':
          return applyDirection(
            compareAsc(a.monthPurchaseTotal, b.monthPurchaseTotal),
            sortDirection
          );
        case 'eligible':
          return applyDirection(compareAsc(a.eligibleAmount, b.eligibleAmount), sortDirection);
        case 'incentive':
        default:
          return applyDirection(compareAsc(a.incentiveAmount, b.incentiveAmount), sortDirection);
      }
    });
    return list;
  }, [filtered, sortKey, sortDirection]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const totalPages = Math.ceil(sorted.length / rowsPerPage) || 1;
  const paginated = sorted.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  if (ordersLoading || storesLoading || piLoading) {
    return <Loading message="Loading retailer incentives..." />;
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Retailer incentives
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Monthly incentive for stores whose Delivered purchases exceed{' '}
          {formatCurrency(RETAILER_INCENTIVE_MONTH_THRESHOLD)}. Eligible products are those where
          our vendor purchase discount was ≥ {RETAILER_INCENTIVE_PURCHASE_DISC_MIN}%. Payout ={' '}
          {RETAILER_INCENTIVE_RATE}% of those line amounts (ex-GST after retailer invoice discount).
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Qualified stores
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.qualifiedCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Qualified month purchase
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {formatCurrency(totals.monthPurchaseQualified)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Eligible product amount
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {formatCurrency(totals.eligibleAmount)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total incentive
              </Typography>
              <Typography variant="h5" fontWeight={600} color="success.main">
                {formatCurrency(totals.incentiveTotal)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
          <TextField
            label="Month"
            type="month"
            size="small"
            value={yearMonth}
            onChange={(e) => {
              setYearMonth(e.target.value);
              setPage(1);
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 180 }}
          />
          <TextField
            size="small"
            placeholder="Search store code or name..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ flex: '1 1 260px', minWidth: 200 }}
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
                checked={qualifiedOnly}
                onChange={(e) => {
                  setQualifiedOnly(e.target.checked);
                  setPage(1);
                }}
              />
            }
            label={`Qualified only (${totals.qualifiedCount})`}
          />
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
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
                columnId="monthPurchase"
                label="Month purchase"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="eligible"
                label="Eligible (≥5% PI disc)"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="incentive"
                label={`Incentive ${RETAILER_INCENTIVE_RATE}%`}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {summaries.length === 0
                      ? 'No Delivered orders in this month.'
                      : 'No stores match your filters.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((row) => (
                <TableRow key={row.retailerId} hover>
                  <TableCell>{row.storeCode}</TableCell>
                  <TableCell>
                    <Typography fontWeight={500}>{row.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.orderCount} order{row.orderCount === 1 ? '' : 's'}
                      {row.eligibleLineCount
                        ? ` · ${row.eligibleLineCount} eligible line${row.eligibleLineCount === 1 ? '' : 's'}`
                        : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{formatCurrency(row.monthPurchaseTotal)}</TableCell>
                  <TableCell align="right">
                    {row.qualified ? formatCurrency(row.eligibleAmount) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      fontWeight={600}
                      color={row.incentiveAmount > 0 ? 'success.main' : 'text.secondary'}
                    >
                      {formatCurrency(row.incentiveAmount)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.qualified ? 'Qualified' : 'Below ₹70k'}
                      color={row.qualified ? 'success' : 'default'}
                      variant={row.qualified ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<CardGiftcard />}
                      disabled={!row.qualified || row.lines.length === 0}
                      onClick={() => setDrillDown(row)}
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {sorted.length > rowsPerPage && (
        <Box display="flex" justifyContent="center" mt={3}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, v) => setPage(v)}
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
              Incentive detail — {drillDown.displayName}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {drillDown.storeCode} · Month purchase {formatCurrency(drillDown.monthPurchaseTotal)}{' '}
                · Eligible {formatCurrency(drillDown.eligibleAmount)} · Incentive{' '}
                {formatCurrency(drillDown.incentiveAmount)}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Medicine</TableCell>
                      <TableCell>Batch</TableCell>
                      <TableCell align="right">PI disc %</TableCell>
                      <TableCell align="right">Line amount</TableCell>
                      <TableCell align="right">Incentive</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drillDown.lines.map((line, idx) => (
                      <TableRow key={`${line.orderId}-${line.medicineId}-${idx}`} hover>
                        <TableCell>
                          <Button
                            size="small"
                            sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                            onClick={() => {
                              setDrillDown(null);
                              navigate(`/orders/${line.orderId}`);
                            }}
                          >
                            {line.invoiceLabel}
                          </Button>
                        </TableCell>
                        <TableCell>{format(line.orderDate, 'dd MMM yyyy')}</TableCell>
                        <TableCell>{line.medicineName}</TableCell>
                        <TableCell>{line.batchNumber || '—'}</TableCell>
                        <TableCell align="right">{line.purchaseDiscountPct}%</TableCell>
                        <TableCell align="right">{formatCurrency(line.lineAmount)}</TableCell>
                        <TableCell align="right">{formatCurrency(line.incentiveAmount)}</TableCell>
                      </TableRow>
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

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Chip,
  Button,
  Pagination,
  FormControlLabel,
  Switch,
  Grid,
} from '@mui/material';
import { Search, Download, ReportProblem } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { getOrdersInRange } from '../services/orders';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { useTableSort } from '../hooks/useTableSort';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  extractOrderShortfallsFromOrders,
  SHORTFALL_REASON_LABELS,
  type OrderShortfallReason,
  type OrderShortfallRow,
} from '../utils/orderShortfalls';
import {
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  istDateStampCompact,
} from '../utils/dateTime';
import { useAppDialog } from '../context/AppDialogProvider';

const ROWS_PER_PAGE = 25;

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return getTodayDateStringIST(d);
}

function reasonColor(
  reason: OrderShortfallReason
): 'warning' | 'info' | 'error' | 'default' {
  switch (reason) {
    case 'partial':
      return 'warning';
    case 'product_demand':
      return 'info';
    case 'no_batch':
      return 'error';
    default:
      return 'default';
  }
}

export const OrderShortfallsPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert } = useAppDialog();
  const { data: stores = [] } = useStores();

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());
  const [searchTerm, setSearchTerm] = useState('');
  const [reasonFilter, setReasonFilter] = useState<OrderShortfallReason | 'All'>('All');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { sortKey, sortDirection, requestSort } = useTableSort('retailerName', 'asc');

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const rangeBounds = useMemo(() => {
    if (dateRangeInvalid || !fromDate) return null;
    return {
      startMs: istDayStartMs(fromDate),
      endMsExclusive: toDate ? istDayEndExclusiveMs(toDate) : undefined,
    };
  }, [fromDate, toDate, dateRangeInvalid]);

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['orderShortfalls', rangeBounds?.startMs, rangeBounds?.endMsExclusive],
    queryFn: () => getOrdersInRange(rangeBounds!.startMs, rangeBounds!.endMsExclusive),
    enabled: rangeBounds != null,
  });

  const storeNameById = useMemo(() => {
    const map = new Map<string, string>();
    stores.forEach((s) => {
      const name = s.shopName || s.displayName;
      if (!name) return;
      map.set(s.id, name);
      if (s.uid) map.set(s.uid, name);
    });
    return map;
  }, [stores]);

  const allRows = useMemo(() => {
    const extracted = extractOrderShortfallsFromOrders(orders);
    return extracted.map((row) => ({
      ...row,
      retailerName:
        storeNameById.get(row.retailerId) || row.retailerName || row.retailerEmail || row.retailerId,
    }));
  }, [orders, storeNameById]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allRows.filter((row) => {
      if (openOnly && !row.isOpen) return false;
      if (reasonFilter !== 'All' && row.reason !== reasonFilter) return false;
      if (!q) return true;
      return (
        row.retailerName.toLowerCase().includes(q) ||
        row.retailerEmail.toLowerCase().includes(q) ||
        row.orderId.toLowerCase().includes(q) ||
        row.medicineName.toLowerCase().includes(q) ||
        (row.manufacturerName || '').toLowerCase().includes(q)
      );
    });
  }, [allRows, searchTerm, reasonFilter, openOnly]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'orderDate':
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), sortDirection);
        case 'orderId':
          return applyDirection(compareAsc(a.orderId, b.orderId), sortDirection);
        case 'medicineName':
          return applyDirection(
            compareAsc(a.medicineName.toLowerCase(), b.medicineName.toLowerCase()),
            sortDirection
          );
        case 'orderedQty':
          return applyDirection(compareAsc(a.orderedQty, b.orderedQty), sortDirection);
        case 'fulfilledQty':
          return applyDirection(compareAsc(a.fulfilledQty, b.fulfilledQty), sortDirection);
        case 'shortfallQty':
          return applyDirection(compareAsc(a.shortfallQty, b.shortfallQty), sortDirection);
        case 'reason':
          return applyDirection(compareAsc(a.reason, b.reason), sortDirection);
        case 'orderStatus':
          return applyDirection(compareAsc(a.orderStatus, b.orderStatus), sortDirection);
        case 'retailerName':
        default: {
          const byRetailer = compareAsc(
            a.retailerName.toLowerCase(),
            b.retailerName.toLowerCase()
          );
          if (byRetailer !== 0) return applyDirection(byRetailer, sortDirection);
          return applyDirection(compareAsc(toTimeMs(b.orderDate), toTimeMs(a.orderDate)), 'asc');
        }
      }
    });
    return list;
  }, [filteredRows, sortKey, sortDirection]);

  const summary = useMemo(() => {
    const byReason: Record<OrderShortfallReason, number> = {
      partial: 0,
      product_demand: 0,
      no_batch: 0,
    };
    const retailers = new Set<string>();
    let shortfallUnits = 0;
    for (const row of filteredRows) {
      byReason[row.reason] += 1;
      retailers.add(row.retailerId || row.retailerName);
      shortfallUnits += row.shortfallQty;
    }
    return {
      lines: filteredRows.length,
      retailers: retailers.size,
      shortfallUnits,
      byReason,
    };
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ROWS_PER_PAGE));
  const pageRows = sortedRows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handleExport = async () => {
    if (sortedRows.length === 0) {
      await alert('No shortfalls to export', { severity: 'warning' });
      return;
    }
    const excelData: (string | number)[][] = [
      [
        'SR',
        'Retailer',
        'Email',
        'Order ID',
        'Order Date',
        'Status',
        'Medicine',
        'Manufacturer',
        'Ordered Qty',
        'Fulfilled Qty',
        'Shortfall Qty',
        'Reason',
        'Open?',
      ],
    ];
    sortedRows.forEach((row, i) => {
      excelData.push([
        i + 1,
        row.retailerName,
        row.retailerEmail,
        row.orderId,
        format(row.orderDate, 'yyyy-MM-dd'),
        row.orderStatus,
        row.medicineName,
        row.manufacturerName || '',
        row.orderedQty,
        row.fulfilledQty,
        row.shortfallQty,
        SHORTFALL_REASON_LABELS[row.reason],
        row.isOpen ? 'Yes' : 'No',
      ]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    ws['!cols'] = [
      { wch: 5 },
      { wch: 28 },
      { wch: 28 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 32 },
      { wch: 20 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 8 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Shortfalls');
    XLSX.writeFile(wb, `order-shortfalls-${istDateStampCompact()}.xlsx`);
  };

  const renderRetailerGroupsHint = (rows: OrderShortfallRow[]) => {
    // Visual grouping: show a subtle divider when retailer changes
    return rows.map((row, idx) => {
      const prev = idx > 0 ? rows[idx - 1] : null;
      const showGroup =
        !prev ||
        prev.retailerId !== row.retailerId ||
        prev.retailerName !== row.retailerName;
      return (
        <React.Fragment key={row.id}>
          {showGroup ? (
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell colSpan={9}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {row.retailerName}
                  {row.retailerEmail ? (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {row.retailerEmail}
                    </Typography>
                  ) : null}
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow hover>
            <TableCell>
              <Button
                size="small"
                onClick={() => navigate(`/orders/${row.orderId}`)}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {row.orderId}
              </Button>
              <Typography variant="caption" display="block" color="text.secondary">
                {format(row.orderDate, 'dd MMM yyyy')}
              </Typography>
            </TableCell>
            <TableCell>
              <Chip size="small" label={row.orderStatus} variant="outlined" />
            </TableCell>
            <TableCell>
              <Typography variant="body2" fontWeight={500}>
                {row.medicineName}
              </Typography>
              {row.manufacturerName ? (
                <Typography variant="caption" color="text.secondary">
                  {row.manufacturerName}
                </Typography>
              ) : null}
            </TableCell>
            <TableCell align="right">{row.orderedQty}</TableCell>
            <TableCell align="right">{row.fulfilledQty}</TableCell>
            <TableCell align="right">
              <Typography fontWeight={700} color="error.main">
                {row.shortfallQty}
              </Typography>
            </TableCell>
            <TableCell>
              <Chip
                size="small"
                color={reasonColor(row.reason)}
                label={SHORTFALL_REASON_LABELS[row.reason]}
              />
            </TableCell>
            <TableCell>
              {row.isOpen ? (
                <Chip size="small" color="warning" label="Open" />
              ) : (
                <Chip size="small" label="Closed" variant="outlined" />
              )}
            </TableCell>
            <TableCell align="right">
              <Button size="small" onClick={() => navigate(`/orders/${row.orderId}`)}>
                Open
              </Button>
            </TableCell>
          </TableRow>
        </React.Fragment>
      );
    });
  };

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Order shortfalls' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <ReportProblem color="warning" />
          <Typography variant="h4">Order shortfalls</Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Download />}
          onClick={() => void handleExport()}
          disabled={sortedRows.length === 0}
        >
          Export
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Retailer-wise medicines that could not be fully fulfilled: partial ship, product demands, and
        lines skipped without a batch. Includes open and historical orders in the selected date range.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search retailer, medicine, order…"
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
          <Grid item xs={6} md={2}>
            <TextField
              fullWidth
              size="small"
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              fullWidth
              size="small"
              label="To"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Reason</InputLabel>
              <Select
                label="Reason"
                value={reasonFilter}
                onChange={(e) => {
                  setReasonFilter(e.target.value as OrderShortfallReason | 'All');
                  setPage(1);
                }}
              >
                <MenuItem value="All">All reasons</MenuItem>
                <MenuItem value="partial">Partial fulfill</MenuItem>
                <MenuItem value="product_demand">Product demand</MenuItem>
                <MenuItem value="no_batch">No batch / skipped</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControlLabel
              control={
                <Switch
                  checked={openOnly}
                  onChange={(e) => {
                    setOpenOnly(e.target.checked);
                    setPage(1);
                  }}
                  color="warning"
                />
              }
              label="Open orders only"
            />
          </Grid>
        </Grid>
        {dateRangeInvalid ? (
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            From date must be on or before To date.
          </Typography>
        ) : null}
      </Paper>

      <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
        <Chip label={`${summary.lines} lines`} />
        <Chip label={`${summary.retailers} retailers`} color="primary" variant="outlined" />
        <Chip label={`${summary.shortfallUnits} shortfall units`} color="error" variant="outlined" />
        <Chip
          label={`Partial: ${summary.byReason.partial}`}
          color="warning"
          variant="outlined"
          size="small"
        />
        <Chip
          label={`Demand: ${summary.byReason.product_demand}`}
          color="info"
          variant="outlined"
          size="small"
        />
        <Chip
          label={`No batch: ${summary.byReason.no_batch}`}
          color="error"
          variant="outlined"
          size="small"
        />
      </Box>

      {isLoading ? (
        <Loading message="Loading shortfalls…" />
      ) : error ? (
        <Typography color="error">Failed to load orders for shortfalls.</Typography>
      ) : (
        <>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <SortableTableHeadCell
                    columnId="orderId"
                    label="Order"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                  />
                  <SortableTableHeadCell
                    columnId="orderStatus"
                    label="Status"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                  />
                  <SortableTableHeadCell
                    columnId="medicineName"
                    label="Medicine"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                  />
                  <SortableTableHeadCell
                    columnId="orderedQty"
                    label="Ordered"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                    align="right"
                  />
                  <SortableTableHeadCell
                    columnId="fulfilledQty"
                    label="Fulfilled"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                    align="right"
                  />
                  <SortableTableHeadCell
                    columnId="shortfallQty"
                    label="Shortfall"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                    align="right"
                  />
                  <SortableTableHeadCell
                    columnId="reason"
                    label="Reason"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onRequestSort={requestSortResetPage}
                  />
                  <TableCell>State</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography color="text.secondary" sx={{ py: 3 }}>
                        No shortfalls in this range.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  renderRetailerGroupsHint(pageRows)
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {sortedRows.length > ROWS_PER_PAGE ? (
            <Box display="flex" justifyContent="center" mt={2}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, v) => setPage(v)}
                color="primary"
              />
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );
};

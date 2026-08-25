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
  Button,
  Grid,
  Card,
  CardContent,
} from '@mui/material';
import { Download } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { getOrdersInRange } from '../services/orders';
import { getPurchaseInvoicesInRange } from '../services/purchaseInvoices';
import { getCreditNotesInRange } from '../services/creditNotes';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  istDateStampCompact,
  dateFromISTDateString,
} from '../utils/dateTime';
import { buildDailyBusiness } from '../utils/dailyBusiness';

function getDefaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 13);
  return getTodayDateStringIST(d);
}

const formatInr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const DailyPerformancePage: React.FC = () => {
  const [fromDate, setFromDate] = useState(() => getDefaultFromDate());
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const rangeBounds = useMemo(() => {
    if (dateRangeInvalid || !fromDate || !toDate) return null;
    return {
      startMs: istDayStartMs(fromDate),
      endMsExclusive: istDayEndExclusiveMs(toDate),
    };
  }, [fromDate, toDate, dateRangeInvalid]);

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['dailyPerfOrders', rangeBounds?.startMs, rangeBounds?.endMsExclusive],
    queryFn: () => getOrdersInRange(rangeBounds!.startMs, rangeBounds!.endMsExclusive),
    enabled: rangeBounds != null,
  });

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ['dailyPerfPurchases', rangeBounds?.startMs, rangeBounds?.endMsExclusive],
    queryFn: () => getPurchaseInvoicesInRange(rangeBounds!.startMs, rangeBounds!.endMsExclusive),
    enabled: rangeBounds != null,
  });

  const { data: creditNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['dailyPerfCreditNotes', rangeBounds?.startMs, rangeBounds?.endMsExclusive],
    queryFn: () => getCreditNotesInRange(rangeBounds!.startMs, rangeBounds!.endMsExclusive),
    enabled: rangeBounds != null,
  });

  const rows = useMemo(
    () =>
      rangeBounds
        ? buildDailyBusiness({
            orders,
            purchases,
            creditNotes,
            fromDate,
            toDate,
          })
        : [],
    [orders, purchases, creditNotes, fromDate, toDate, rangeBounds]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          salesCount: acc.salesCount + row.salesCount,
          salesAmount: acc.salesAmount + row.salesAmount,
          purchaseCount: acc.purchaseCount + row.purchaseCount,
          purchaseAmount: acc.purchaseAmount + row.purchaseAmount,
          creditNoteAmount: acc.creditNoteAmount + row.creditNoteAmount,
          cancelledCount: acc.cancelledCount + row.cancelledCount,
        }),
        {
          salesCount: 0,
          salesAmount: 0,
          purchaseCount: 0,
          purchaseAmount: 0,
          creditNoteAmount: 0,
          cancelledCount: 0,
        }
      ),
    [rows]
  );

  const handleExport = () => {
    const header = [
      [
        'Date',
        'Sales bills',
        'Sales amount',
        'Cancelled orders',
        'Purchase bills',
        'Purchase amount',
        'Credit notes',
        'Credit note amount',
      ],
    ];
    const data = rows.map((r) => [
      r.date,
      r.salesCount,
      r.salesAmount,
      r.cancelledCount,
      r.purchaseCount,
      r.purchaseAmount,
      r.creditNoteCount,
      r.creditNoteAmount,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily performance');
    XLSX.writeFile(wb, `daily-performance-${istDateStampCompact()}.xlsx`);
  };

  const isLoading = ordersLoading || purchasesLoading || notesLoading;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Daily performance' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} mb={2}>
        <Box>
          <Typography variant="h4">Daily performance</Typography>
          <Typography variant="body2" color="text.secondary">
            Day-wise sales, purchases, and credit notes (IST). Sales exclude cancelled orders.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Download />} onClick={handleExport} disabled={!rows.length}>
          Export Excel
        </Button>
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth
              size="small"
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth
              size="small"
              label="To"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
        {dateRangeInvalid && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            From date must be on or before To date.
          </Typography>
        )}
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'Sales', value: formatInr(totals.salesAmount), sub: `${totals.salesCount} bills` },
          { label: 'Purchases', value: formatInr(totals.purchaseAmount), sub: `${totals.purchaseCount} bills` },
          { label: 'Credit notes', value: formatInr(totals.creditNoteAmount) },
          { label: 'Cancelled orders', value: String(totals.cancelledCount) },
        ].map((card) => (
          <Grid item xs={6} md={3} key={card.label}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="subtitle2">
                  {card.label}
                </Typography>
                <Typography variant="h6">{card.value}</Typography>
                {card.sub && (
                  <Typography variant="caption" color="text.secondary">
                    {card.sub}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {isLoading ? (
        <Loading message="Loading daily performance..." />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell align="right">Sales bills</TableCell>
                <TableCell align="right">Sales amount</TableCell>
                <TableCell align="right">Cancelled</TableCell>
                <TableCell align="right">Purchase bills</TableCell>
                <TableCell align="right">Purchase amount</TableCell>
                <TableCell align="right">Credit notes</TableCell>
                <TableCell align="right">Credit note amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No data for this range</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.date} hover>
                    <TableCell>{format(dateFromISTDateString(row.date), 'dd MMM yyyy')}</TableCell>
                    <TableCell align="right">{row.salesCount}</TableCell>
                    <TableCell align="right">{formatInr(row.salesAmount)}</TableCell>
                    <TableCell align="right">{row.cancelledCount}</TableCell>
                    <TableCell align="right">{row.purchaseCount}</TableCell>
                    <TableCell align="right">{formatInr(row.purchaseAmount)}</TableCell>
                    <TableCell align="right">{row.creditNoteCount}</TableCell>
                    <TableCell align="right">{formatInr(row.creditNoteAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

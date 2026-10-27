import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getPurchaseInvoicesInRange } from '../services/purchaseInvoices';
import { IstDateField } from './IstDateField';
import { Loading } from './Loading';
import {
  coerceToDate,
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  shiftIstDateString,
} from '../utils/dateTime';
import { fillIstDateRange } from '../utils/dailyBusiness';

function defaultFromDate(): string {
  return shiftIstDateString(getTodayDateStringIST(), -13);
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function changeText(change: number, previous: number): string {
  if (Math.round(change) === 0) return 'Same';
  const pct = previous > 0 ? ` (${Math.round((change / previous) * 100)}%)` : '';
  return change > 0 ? `Up ${inr(change)}${pct}` : `Down ${inr(Math.abs(change))}${pct}`;
}

export const DailyPurchaseDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());
  const invalid = Boolean(fromDate && toDate && fromDate > toDate);

  const range = useMemo(() => {
    if (!open || invalid || !fromDate || !toDate) return null;
    return { startMs: istDayStartMs(fromDate), endMs: istDayEndExclusiveMs(toDate) };
  }, [open, invalid, fromDate, toDate]);

  const { data: invoices = [], isLoading, isError } = useQuery({
    queryKey: ['dailyPurchase', range?.startMs, range?.endMs],
    queryFn: () => getPurchaseInvoicesInRange(range!.startMs, range!.endMs),
    enabled: range != null,
  });

  const rows = useMemo(() => {
    const dates = fillIstDateRange(fromDate, toDate);
    const byDate = new Map<string, { count: number; amount: number }>();
    for (const date of dates) byDate.set(date, { count: 0, amount: 0 });
    for (const invoice of invoices) {
      const d = coerceToDate(invoice.invoiceDate);
      if (!d) continue;
      const key = getTodayDateStringIST(d);
      const bucket = byDate.get(key);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.amount += Number(invoice.totalAmount) || 0;
    }
    return dates
      .slice()
      .reverse()
      .map((date) => {
        const current = byDate.get(date) || { count: 0, amount: 0 };
        const previous = byDate.get(shiftIstDateString(date, -1)) || { count: 0, amount: 0 };
        return {
          date,
          count: current.count,
          amount: current.amount,
          change: current.amount - previous.amount,
          previousAmount: previous.amount,
        };
      });
  }, [invoices, fromDate, toDate]);

  const latest = rows[0];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Daily purchase</DialogTitle>
      <DialogContent>
        <Box display="flex" gap={2} flexWrap="wrap" sx={{ mt: 1, mb: 2 }}>
          <IstDateField label="From" value={fromDate} onChange={setFromDate} />
          <IstDateField label="To" value={toDate} onChange={setToDate} />
        </Box>
        {invalid && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            From date must be on or before the to date.
          </Typography>
        )}
        {latest && !invalid && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {latest.date}: {inr(latest.amount)} across {latest.count} bill
            {latest.count === 1 ? '' : 's'}. {changeText(latest.change, latest.previousAmount)} from the
            previous day.
          </Typography>
        )}
        {isLoading ? (
          <Loading message="Loading purchases..." />
        ) : isError ? (
          <Typography color="error">Could not load purchases for this range.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell align="right">Bills</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Vs previous day</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.date}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell align="right">{row.count}</TableCell>
                  <TableCell align="right">{inr(row.amount)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: row.change > 0 ? 'success.main' : row.change < 0 ? 'error.main' : 'text.secondary' }}
                  >
                    {changeText(row.change, row.previousAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

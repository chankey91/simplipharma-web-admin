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
import { getRetailerOrdersInRange } from '../services/orders';
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

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function changeText(change: number, previous: number): string {
  if (Math.round(change) === 0) return 'Same';
  const pct = previous > 0 ? ` (${Math.round((change / previous) * 100)}%)` : '';
  return change > 0 ? `Up ${inr(change)}${pct}` : `Down ${inr(Math.abs(change))}${pct}`;
}

export type RetailerSalesTarget = {
  id: string;
  name: string;
  code?: string;
};

export const RetailerDailySalesDialog: React.FC<{
  retailer: RetailerSalesTarget | null;
  onClose: () => void;
}> = ({ retailer, onClose }) => {
  const [fromDate, setFromDate] = useState(() => shiftIstDateString(getTodayDateStringIST(), -13));
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());
  const invalid = Boolean(fromDate && toDate && fromDate > toDate);

  const range = useMemo(() => {
    if (!retailer || invalid || !fromDate || !toDate) return null;
    return {
      startMs: istDayStartMs(shiftIstDateString(fromDate, -1)),
      endMs: istDayEndExclusiveMs(toDate),
    };
  }, [retailer, invalid, fromDate, toDate]);

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['retailerDailySales', retailer?.id, range?.startMs, range?.endMs],
    queryFn: () => getRetailerOrdersInRange(retailer!.id, range!.startMs, range!.endMs),
    enabled: range != null,
  });

  const rows = useMemo(() => {
    const dates = fillIstDateRange(fromDate, toDate);
    const byDate = new Map<string, { count: number; amount: number }>();
    if (fromDate) byDate.set(shiftIstDateString(fromDate, -1), { count: 0, amount: 0 });
    for (const date of dates) byDate.set(date, { count: 0, amount: 0 });
    for (const order of orders) {
      if (order.status === 'Cancelled') continue;
      const d = coerceToDate(order.orderDate);
      if (!d) continue;
      const bucket = byDate.get(getTodayDateStringIST(d));
      if (!bucket) continue;
      bucket.count += 1;
      bucket.amount += Number(order.totalAmount) || 0;
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
  }, [orders, fromDate, toDate]);

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const orderCount = rows.reduce((sum, row) => sum + row.count, 0);
  const latest = rows[0];

  return (
    <Dialog open={Boolean(retailer)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Daily sales
        {retailer ? ` — ${retailer.name}` : ''}
        {retailer?.code ? ` (${retailer.code})` : ''}
      </DialogTitle>
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
        {retailer && !invalid && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {inr(total)} from {orderCount} order{orderCount === 1 ? '' : 's'} in this range.
            {latest
              ? ` ${latest.date}: ${inr(latest.amount)}. ${changeText(latest.change, latest.previousAmount)} from the previous day.`
              : ''}
          </Typography>
        )}
        {isLoading ? (
          <Loading message="Loading sales..." />
        ) : isError ? (
          <Typography color="error">Could not load this retailer's sales.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell align="right">Orders</TableCell>
                <TableCell align="right">Sales</TableCell>
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
                    sx={{
                      color: row.change > 0 ? 'success.main' : row.change < 0 ? 'error.main' : 'text.secondary',
                    }}
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

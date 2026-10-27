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
import { getOrdersInRange } from '../services/orders';
import { IstDateField } from './IstDateField';
import { Loading } from './Loading';
import { User } from '../types';
import {
  coerceToDate,
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  shiftIstDateString,
} from '../utils/dateTime';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function changeText(change: number, previous: number): string {
  if (Math.round(change) === 0) return 'Same';
  const pct = previous > 0 ? ` (${Math.round((change / previous) * 100)}%)` : '';
  return change > 0 ? `Up ${inr(change)}${pct}` : `Down ${inr(Math.abs(change))}${pct}`;
}

type Bucket = { amount: number; count: number };

export const DailyRetailerSalesDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  stores: User[];
}> = ({ open, onClose, stores }) => {
  const [date, setDate] = useState(() => getTodayDateStringIST());
  const previousDate = date ? shiftIstDateString(date, -1) : '';

  const range = useMemo(() => {
    if (!open || !previousDate || !date) return null;
    return { startMs: istDayStartMs(previousDate), endMs: istDayEndExclusiveMs(date) };
  }, [open, previousDate, date]);

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['dailyRetailerSales', range?.startMs, range?.endMs],
    queryFn: () => getOrdersInRange(range!.startMs, range!.endMs),
    enabled: range != null,
  });

  const rows = useMemo(() => {
    const storeById = new Map(stores.map((store) => [store.id, store]));
    const selected = new Map<string, Bucket>();
    const previous = new Map<string, Bucket>();
    const names = new Map<string, string>();

    const add = (map: Map<string, Bucket>, retailerId: string, amount: number) => {
      const bucket = map.get(retailerId) || { amount: 0, count: 0 };
      bucket.amount += amount;
      bucket.count += 1;
      map.set(retailerId, bucket);
    };

    for (const order of orders) {
      if (order.status === 'Cancelled' || !order.retailerId) continue;
      const orderDate = coerceToDate(order.orderDate);
      if (!orderDate) continue;
      const key = getTodayDateStringIST(orderDate);
      const amount = Number(order.totalAmount) || 0;
      if (order.retailerName) names.set(order.retailerId, order.retailerName);
      if (key === date) add(selected, order.retailerId, amount);
      else if (key === previousDate) add(previous, order.retailerId, amount);
    }

    const ids = new Set<string>([...selected.keys(), ...previous.keys()]);
    return [...ids]
      .map((id) => {
        const store = storeById.get(id);
        const today = selected.get(id) || { amount: 0, count: 0 };
        const prior = previous.get(id) || { amount: 0, count: 0 };
        return {
          id,
          name: store?.shopName || store?.displayName || names.get(id) || id,
          code: store?.storeCode || '',
          amount: today.amount,
          count: today.count,
          previousAmount: prior.amount,
          change: today.amount - prior.amount,
        };
      })
      .sort((a, b) => b.amount - a.amount || b.change - a.change);
  }, [orders, stores, date, previousDate]);

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const previousTotal = rows.reduce((sum, row) => sum + row.previousAmount, 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Daily sales to retailers</DialogTitle>
      <DialogContent>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" sx={{ mt: 1, mb: 2 }}>
          <IstDateField label="Date" value={date} onChange={setDate} />
          <Typography variant="body2" color="text.secondary">
            Compared with {previousDate || 'the previous day'}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {date}: {inr(total)}. {changeText(total - previousTotal, previousTotal)} from {previousDate}.
        </Typography>
        {isLoading ? (
          <Loading message="Loading sales..." />
        ) : isError ? (
          <Typography color="error">Could not load sales for this day.</Typography>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary">No retailer sales on these two days.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Retailer</TableCell>
                <TableCell>Code</TableCell>
                <TableCell align="right">Orders</TableCell>
                <TableCell align="right">This day</TableCell>
                <TableCell align="right">Previous day</TableCell>
                <TableCell align="right">Change</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.code || '—'}</TableCell>
                  <TableCell align="right">{row.count}</TableCell>
                  <TableCell align="right">{inr(row.amount)}</TableCell>
                  <TableCell align="right">{inr(row.previousAmount)}</TableCell>
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

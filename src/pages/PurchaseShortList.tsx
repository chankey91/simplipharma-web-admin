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
  TextField,
  InputAdornment,
  Button,
  Stack,
} from '@mui/material';
import { FileDownload, Search } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { IstDateTimeField } from '../components/IstDateTimeField';
import { useOrdersInDateRange } from '../hooks/useOrders';
import { useMedicinesByIds } from '../hooks/useInventory';
import { indexMedicinesById } from '../utils/orderLineMargin';
import { buildPurchaseShortList, type PurchaseShortRow } from '../utils/purchaseShortList';
import { getEndOfTodayIstDateTime, getTodayDateStringIST, parseIstDateTimeLocal } from '../utils/dateTime';

function qty(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

function orderLabel(numbers: string[]): string {
  if (numbers.length <= 4) return numbers.join(', ');
  return `${numbers.slice(0, 4).join(', ')} +${numbers.length - 4}`;
}

export const PurchaseShortListPage: React.FC = () => {
  const navigate = useNavigate();
  const today = getTodayDateStringIST();
  const [fromDateTime, setFromDateTime] = useState(`${today}T00:00`);
  const [toDateTime, setToDateTime] = useState(getEndOfTodayIstDateTime());
  const [search, setSearch] = useState('');

  const fromMs = parseIstDateTimeLocal(fromDateTime);
  const toMs = parseIstDateTimeLocal(toDateTime);
  // The picker is to the minute. Include that whole minute.
  const bounds =
    fromMs != null && toMs != null && fromMs < toMs + 60 * 1000
      ? { startMs: fromMs, endMsExclusive: toMs + 60 * 1000 }
      : null;
  const rangeOk = bounds != null;
  const { data: orders, isLoading: ordersLoading, isError } = useOrdersInDateRange(
    bounds?.startMs ?? 0,
    bounds?.endMsExclusive ?? 0,
    { enabled: rangeOk }
  );

  const medicineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const order of orders ?? []) {
      if (order.status !== 'Pending') continue;
      for (const line of order.medicines ?? []) {
        if (line.lineType === 'product_demand') continue;
        if (line.medicineId) ids.add(line.medicineId);
      }
    }
    return [...ids];
  }, [orders]);

  const booksReady = rangeOk && !ordersLoading;
  const { data: medicines, isLoading: medicinesLoading } = useMedicinesByIds(
    booksReady ? medicineIds : undefined
  );

  const list = useMemo(() => {
    if (!booksReady || medicinesLoading) return null;
    return buildPurchaseShortList(orders ?? [], indexMedicinesById(medicines));
  }, [booksReady, medicinesLoading, orders, medicines]);

  const q = search.trim().toLowerCase();
  const shorts = (list?.shorts ?? []).filter((row) => !q || row.name.toLowerCase().includes(q));
  const requests = (list?.requests ?? []).filter((row) => !q || row.name.toLowerCase().includes(q));

  const exportRows = () => {
    const header = ['Kind', 'Product', 'Ordered', 'In stock', 'Short', 'Orders'];
    const body = [
      ...shorts.map((row) => [
        'Short',
        row.name,
        row.orderedQty,
        row.stockQty,
        row.shortQty,
        row.orderNumbers.join(', '),
      ]),
      ...requests.map((row) => [
        'Product request',
        row.name,
        row.orderedQty,
        '',
        row.shortQty,
        row.orderNumbers.join(', '),
      ]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, 'Short list');
    const stamp = (value: string) => value.replace(/[-:T]/g, '');
    XLSX.writeFile(wb, `purchase-short-list-${stamp(fromDateTime)}-to-${stamp(toDateTime)}.xlsx`);
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
            Purchase short list
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Pending orders between the date and time you pick, compared with stock on hand. Save the day’s purchase
            bills first — those bills already increase stock, so they are not added again. A row appears
            only when ordered quantity is still above stock. Product requests are listed separately
            because they are not a stock item.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/purchases')} sx={{ flexShrink: 0 }}>
          Purchase invoices
        </Button>
      </Stack>

      <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center" sx={{ mb: 2 }}>
        <IstDateTimeField
          label="Orders from"
          value={fromDateTime}
          onChange={setFromDateTime}
          sx={{ width: 250 }}
        />
        <IstDateTimeField
          label="Orders to"
          value={toDateTime}
          onChange={setToDateTime}
          sx={{ width: 250 }}
        />
        <TextField
          size="small"
          placeholder="Search product"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Stack>

      {!rangeOk ? (
        <Typography color="error">Choose a from time that is before the to time.</Typography>
      ) : null}
      {isError ? <Typography color="error">Could not load orders.</Typography> : null}
      {rangeOk && (!booksReady || medicinesLoading) ? <Loading message="Comparing orders with stock..." /> : null}

      {list ? (
        <>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {list.orderCount} pending order{list.orderCount === 1 ? '' : 's'} · {shorts.length} short
              {shorts.length === 1 ? '' : 's'}
            </Typography>
            <Button
              startIcon={<FileDownload />}
              onClick={exportRows}
              disabled={shorts.length === 0 && requests.length === 0}
            >
              Export
            </Button>
          </Stack>

          <ShortTable title="Still short after stock" rows={shorts} empty="Nothing is short for these orders." showStock />

          <Box sx={{ mt: 3 }}>
            <ShortTable
              title="Product requests (not in stock)"
              rows={requests}
              empty="No product requests on these orders."
              showStock={false}
            />
          </Box>
        </>
      ) : null}
    </Box>
  );
};

function ShortTable({
  title,
  rows,
  empty,
  showStock,
}: {
  title: string;
  rows: PurchaseShortRow[];
  empty: string;
  showStock: boolean;
}) {
  return (
    <>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell align="right">Ordered</TableCell>
              {showStock ? <TableCell align="right">In stock</TableCell> : null}
              <TableCell align="right">Short</TableCell>
              <TableCell>Orders</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showStock ? 5 : 4}>{empty}</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} hover>
                  <TableCell>{row.name}</TableCell>
                  <TableCell align="right">{qty(row.orderedQty)}</TableCell>
                  {showStock ? <TableCell align="right">{qty(row.stockQty)}</TableCell> : null}
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {qty(row.shortQty)}
                  </TableCell>
                  <TableCell>{orderLabel(row.orderNumbers)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

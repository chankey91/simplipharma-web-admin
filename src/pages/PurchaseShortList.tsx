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
  Pagination,
} from '@mui/material';
import { FileDownload, Search } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { IstDateField } from '../components/IstDateField';
import { useOrdersInDateRange } from '../hooks/useOrders';
import { useMedicinesByIds } from '../hooks/useInventory';
import { indexMedicinesById } from '../utils/orderLineMargin';
import { buildPurchaseShortList, type PurchaseShortRow } from '../utils/purchaseShortList';
import { getTodayDateStringIST, istDateRangeBounds } from '../utils/dateTime';

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
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const rangeOk = Boolean(fromDate && toDate && fromDate <= toDate);
  const bounds = rangeOk ? istDateRangeBounds(fromDate, toDate) : null;
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

  const rowsPerPage = 25;
  const pageCount = Math.max(1, Math.ceil(shorts.length / rowsPerPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = shorts.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

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
    XLSX.writeFile(wb, `purchase-short-list-${fromDate}-to-${toDate}.xlsx`);
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
            Purchase short list
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Pending orders in the dates you pick, compared with stock on hand. Save the day’s purchase
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
        <IstDateField label="Orders from" value={fromDate} onChange={(v) => { setFromDate(v); setPage(1); }} />
        <IstDateField label="Orders to" value={toDate} onChange={(v) => { setToDate(v); setPage(1); }} />
        <TextField
          size="small"
          placeholder="Search product"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
        <Typography color="error">Choose a from date that is on or before the to date.</Typography>
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

          <ShortTable title="Still short after stock" rows={pageRows} empty="Nothing is short for these orders." showStock />
          {pageCount > 1 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
              <Pagination count={pageCount} page={safePage} onChange={(_e, value) => setPage(value)} />
            </Box>
          ) : null}

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

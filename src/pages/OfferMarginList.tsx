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
  Grid,
  Button,
  Stack,
  Pagination,
} from '@mui/material';
import { FileDownload, Search } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { useOrdersInPeriod } from '../hooks/useOrders';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useMedicinesByIds } from '../hooks/useInventory';
import { useTableSort } from '../hooks/useTableSort';
import { indexMedicinesById } from '../utils/orderLineMargin';
import {
  aggregateOfferMargin,
  formatSchemePer10,
  toOfferMarginView,
  type OfferMarginView,
} from '../utils/offerMarginList';
import { applyDirection, compareAsc } from '../utils/tableSort';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function qty(value: number): string {
  if (!value) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export const OfferMarginListPage: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [minSold, setMinSold] = useState('1');
  const [extraDiscount, setExtraDiscount] = useState('0');
  const [page, setPage] = useState(1);
  const { sortKey, sortDirection, requestSort } = useTableSort('margin', 'desc');

  const { data: orders, isLoading: ordersLoading } = useOrdersInPeriod('all');
  const { data: invoices, isLoading: invoicesLoading } = usePurchaseInvoices();
  const booksReady = !ordersLoading && !invoicesLoading;

  const medicineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const order of orders ?? []) {
      for (const line of order.medicines ?? []) {
        if (line.medicineId) ids.add(line.medicineId);
      }
    }
    for (const invoice of invoices ?? []) {
      for (const item of invoice.items ?? []) {
        if (item.medicineId) ids.add(item.medicineId);
      }
    }
    return [...ids];
  }, [orders, invoices]);

  const { data: medicines, isLoading: medicinesLoading } = useMedicinesByIds(
    booksReady ? medicineIds : undefined
  );

  const extraPct = Number(extraDiscount);
  const extra = Number.isFinite(extraPct) ? extraPct : 0;
  const minSoldQty = Math.max(0, Number(minSold) || 0);

  const rows = useMemo(() => {
    if (!booksReady || medicinesLoading) return [];
    const aggregated = aggregateOfferMargin(invoices ?? [], orders ?? [], indexMedicinesById(medicines));
    const q = search.trim().toLowerCase();
    return aggregated
      .map((row) => toOfferMarginView(row, extra))
      .filter((row) => row.marginPct !== null && row.soldQty >= minSoldQty)
      .filter((row) => !q || row.name.toLowerCase().includes(q));
  }, [booksReady, medicinesLoading, invoices, orders, medicines, extra, minSoldQty, search]);

  const sorted = useMemo(() => {
    const value = (row: OfferMarginView): string | number | null => {
      switch (sortKey) {
        case 'name':
          return row.name;
        case 'purchaseDiscount':
          return row.avgPurchaseDiscountPct;
        case 'scheme':
          return row.schemePer10;
        case 'landed':
          return row.avgLandedCost;
        case 'saleDiscount':
          return row.avgSaleDiscountPct;
        case 'margin':
          return row.marginPct;
        case 'marginRs':
          return row.grossProfitExGst;
        case 'room':
          return row.roomPct;
        case 'sold':
          return row.soldQty;
        case 'purchased':
          return row.purchasePaidQty;
        default:
          return row.netSalesExGst;
      }
    };
    return [...rows].sort((a, b) => applyDirection(compareAsc(value(a), value(b)), sortDirection));
  }, [rows, sortKey, sortDirection]);

  const rowsPerPage = 25;
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  const exportRows = () => {
    const header = [
      'Product',
      'Qty purchased (paid)',
      'Qty free',
      'Avg purchase discount %',
      'Scheme per 10 paid',
      'Avg landed cost',
      'Qty sold',
      'Avg discount given %',
      'Net sales ex-GST',
      'Margin ₹',
      'Avg margin %',
      `Room after ${extra}% extra offer`,
    ];
    const body = sorted.map((row) => [
      row.name,
      row.purchasePaidQty,
      row.purchaseFreeQty,
      row.avgPurchaseDiscountPct ?? '',
      row.schemePer10 ?? '',
      row.avgLandedCost ?? '',
      row.soldQty,
      row.avgSaleDiscountPct ?? '',
      row.netSalesExGst,
      row.grossProfitExGst,
      row.marginPct ?? '',
      row.roomPct ?? '',
    ]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, 'Offer margin');
    XLSX.writeFile(wb, 'offer-margin-by-product.xlsx');
  };

  return (
    <Box sx={{ maxWidth: 1500, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }} gap={2}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
            Offer margin
          </Typography>
          <Typography variant="body1" color="text.secondary">
            One row per product, highest average margin first. The average uses every sale of that product,
            not a date range. Next to it is the average purchase discount you got, and the scheme (10+ free).
            Margin is what you kept after the sale, excluding GST. The extra rupee discount on a purchase bill
            is not split onto these rows. Cancelled orders are left out.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/margin')}>
          Margin report
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            label="Min qty sold"
            type="number"
            value={minSold}
            onChange={(e) => { setMinSold(e.target.value); setPage(1); }}
            inputProps={{ min: 0 }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <TextField
            size="small"
            fullWidth
            label="Extra offer %"
            type="number"
            value={extraDiscount}
            onChange={(e) => setExtraDiscount(e.target.value)}
            helperText="Room = margin − this"
            inputProps={{ min: 0, step: 0.5 }}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            size="small"
            fullWidth
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
        </Grid>
      </Grid>

      {!booksReady || medicinesLoading ? <Loading message="Building product averages..." /> : null}

      {booksReady && !medicinesLoading ? (
        <>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {sorted.length} product{sorted.length === 1 ? '' : 's'}
            </Typography>
            <Button startIcon={<FileDownload />} onClick={exportRows} disabled={sorted.length === 0}>
              Export
            </Button>
          </Stack>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <SortableTableHeadCell columnId="name" label="Product" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="margin" label="Avg margin" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="marginRs" label="Margin ₹" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="purchaseDiscount" label="Avg discount got" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="scheme" label="Scheme" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="saleDiscount" label="Avg discount given" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="sold" label="Sold" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="purchased" label="Purchased" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="landed" label="Avg landed" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="netSales" label="Net sales" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                  <SortableTableHeadCell columnId="room" label="Room for offer" align="right" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSort} />
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11}>No products with that sold quantity.</TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((row) => (
                    <TableRow key={row.key} hover>
                      <TableCell>{row.name}</TableCell>
                      <TableCell align="right">{pct(row.marginPct)}</TableCell>
                      <TableCell align="right">{inr.format(row.grossProfitExGst)}</TableCell>
                      <TableCell align="right">{pct(row.avgPurchaseDiscountPct)}</TableCell>
                      <TableCell align="right">{formatSchemePer10(row.schemePer10)}</TableCell>
                      <TableCell align="right">{pct(row.avgSaleDiscountPct)}</TableCell>
                      <TableCell align="right">{qty(row.soldQty)}</TableCell>
                      <TableCell align="right">{qty(row.purchasePaidQty)}</TableCell>
                      <TableCell align="right">
                        {row.avgLandedCost === null ? '—' : inr.format(row.avgLandedCost)}
                      </TableCell>
                      <TableCell align="right">{inr.format(row.netSalesExGst)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: row.roomPct !== null && row.roomPct < 0 ? 'error.main' : undefined, fontWeight: 600 }}
                      >
                        {pct(row.roomPct)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {pageCount > 1 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={pageCount} page={safePage} onChange={(_e, value) => setPage(value)} />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
};

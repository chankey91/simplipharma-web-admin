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
  Button,
  Pagination,
  Grid,
  Tabs,
  Tab,
} from '@mui/material';
import { Search, Download, Medication } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { getOrdersInRange } from '../services/orders';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
import { useStores } from '../hooks/useStores';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  getTodayDateStringIST,
  istDayEndExclusiveMs,
  istDayStartMs,
  istDateStampCompact,
} from '../utils/dateTime';
import { useAppDialog } from '../context/AppDialogProvider';
import {
  buildNrxBatchKeySet,
  extractNrxPurchases,
  extractNrxSales,
  storeDisplayName,
  type NrxPurchaseRow,
  type NrxSaleRow,
} from '../utils/nrxRegister';

function getDefaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return getTodayDateStringIST(d);
}

export const NrxRegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { alert } = useAppDialog();
  const { data: stores = [] } = useStores();

  const [tab, setTab] = useState(0);
  const [fromDate, setFromDate] = useState(() => getDefaultFromDate());
  const [toDate, setToDate] = useState(() => getTodayDateStringIST());
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const rowsPerPage = 25;

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const bounds = useMemo(() => {
    if (dateRangeInvalid || !fromDate || !toDate) return null;
    return {
      fromMs: istDayStartMs(fromDate),
      toMsExclusive: istDayEndExclusiveMs(toDate),
    };
  }, [fromDate, toDate, dateRangeInvalid]);

  const { data: invoices = [], isLoading: piLoading } = useQuery({
    queryKey: ['purchaseInvoices'],
    queryFn: getAllPurchaseInvoices,
    staleTime: 5 * 60 * 1000,
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['ordersInRange', bounds?.fromMs, bounds?.toMsExclusive],
    queryFn: () => getOrdersInRange(bounds!.fromMs, bounds!.toMsExclusive),
    enabled: bounds != null,
  });

  const storeNameById = useMemo(() => {
    const m: Record<string, string> = {};
    stores.forEach((s) => {
      m[s.id] = storeDisplayName(s, s.id);
    });
    return m;
  }, [stores]);

  const nrxKeys = useMemo(() => buildNrxBatchKeySet(invoices), [invoices]);

  const purchaseRows = useMemo(() => {
    if (!bounds) return [] as NrxPurchaseRow[];
    return extractNrxPurchases(invoices, bounds.fromMs, bounds.toMsExclusive);
  }, [invoices, bounds]);

  const saleRows = useMemo(() => {
    if (!bounds) return [] as NrxSaleRow[];
    return extractNrxSales(orders, bounds.fromMs, bounds.toMsExclusive, nrxKeys, storeNameById);
  }, [orders, bounds, nrxKeys, storeNameById]);

  const q = searchTerm.trim().toLowerCase();

  const filteredPurchases = useMemo(() => {
    if (!q) return purchaseRows;
    return purchaseRows.filter(
      (r) =>
        r.vendorName.toLowerCase().includes(q) ||
        r.medicineName.toLowerCase().includes(q) ||
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.batchNumber.toLowerCase().includes(q) ||
        (r.receivedBatchNumber || '').toLowerCase().includes(q)
    );
  }, [purchaseRows, q]);

  const filteredSales = useMemo(() => {
    if (!q) return saleRows;
    return saleRows.filter(
      (r) =>
        r.retailerName.toLowerCase().includes(q) ||
        r.medicineName.toLowerCase().includes(q) ||
        r.orderId.toLowerCase().includes(q) ||
        (r.invoiceNumber || '').toLowerCase().includes(q) ||
        r.batchNumber.toLowerCase().includes(q)
    );
  }, [saleRows, q]);

  const activeRows = tab === 0 ? filteredPurchases : filteredSales;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / rowsPerPage));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = activeRows.slice((pageSafe - 1) * rowsPerPage, pageSafe * rowsPerPage);

  const handleExport = async () => {
    if (filteredPurchases.length === 0 && filteredSales.length === 0) {
      await alert('No NRX rows to export for this period', { severity: 'warning' });
      return;
    }
    const wb = XLSX.utils.book_new();
    const purchaseSheet = [
      [
        'Date',
        'Vendor',
        'Invoice No',
        'Medicine',
        'Invoice Batch',
        'Received Batch',
        'Qty',
        'Free',
      ],
      ...filteredPurchases.map((r) => [
        format(r.date, 'dd MMM yyyy'),
        r.vendorName,
        r.invoiceNumber,
        r.medicineName,
        r.batchNumber,
        r.receivedBatchNumber || '',
        r.quantity,
        r.freeQuantity || '',
      ]),
    ];
    const saleSheet = [
      ['Date', 'Retailer / Store', 'Order ID', 'Invoice No', 'Medicine', 'Batch', 'Qty', 'Free'],
      ...filteredSales.map((r) => [
        format(r.date, 'dd MMM yyyy'),
        r.retailerName,
        r.orderId,
        r.invoiceNumber || '',
        r.medicineName,
        r.batchNumber,
        r.quantity,
        r.freeQuantity || '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(purchaseSheet), 'Purchases');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(saleSheet), 'Sales');
    XLSX.writeFile(wb, `nrx-register-${istDateStampCompact()}.xlsx`);
  };

  if (piLoading || (bounds && ordersLoading)) {
    return <Loading message="Loading NRX register..." />;
  }

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Home', path: '/' }, { label: 'NRX register' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box display="flex" alignItems="center" gap={1}>
          <Medication color="error" />
          <Typography variant="h4">NRX register</Typography>
        </Box>
        <Button variant="outlined" startIcon={<Download />} onClick={handleExport}>
          Export Excel
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Schedule H / NRX stock: purchases (from vendor) and sales (to retailer). Mark lines as NRX
        on purchase invoices; sales pick up the flag at fulfill (or by NRX batch match).
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={3}>
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
          <Grid item xs={12} sm={4} md={3}>
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
          <Grid item xs={12} sm={4} md={6}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search medicine, party, invoice, batch…"
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
        </Grid>
        {dateRangeInvalid && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            From date must be on or before To date.
          </Typography>
        )}
      </Paper>

      <Tabs
        value={tab}
        onChange={(_, v) => {
          setTab(v);
          setPage(1);
        }}
        sx={{ mb: 1 }}
      >
        <Tab label={`Purchases (from vendor) · ${filteredPurchases.length}`} />
        <Tab label={`Sales (to store) · ${filteredSales.length}`} />
      </Tabs>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            {tab === 0 ? (
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Medicine</TableCell>
                <TableCell>Invoice batch</TableCell>
                <TableCell>Received batch</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Free</TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Retailer / Store</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Medicine</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Free</TableCell>
              </TableRow>
            )}
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tab === 0 ? 8 : 7} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No NRX {tab === 0 ? 'purchases' : 'sales'} in this period.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : tab === 0 ? (
              (pageRows as NrxPurchaseRow[]).map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {format(r.date, 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell>{r.vendorName}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                      onClick={() => navigate(`/purchases/${r.invoiceId}`)}
                    >
                      {r.invoiceNumber}
                    </Button>
                  </TableCell>
                  <TableCell>{r.medicineName}</TableCell>
                  <TableCell>{r.batchNumber || '—'}</TableCell>
                  <TableCell>{r.receivedBatchNumber || '—'}</TableCell>
                  <TableCell align="right">{r.quantity}</TableCell>
                  <TableCell align="right">{r.freeQuantity || '—'}</TableCell>
                </TableRow>
              ))
            ) : (
              (pageRows as NrxSaleRow[]).map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {format(r.date, 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell>{r.retailerName}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                      onClick={() => navigate(`/orders/${r.orderId}`)}
                    >
                      {r.invoiceNumber || r.orderId}
                    </Button>
                  </TableCell>
                  <TableCell>{r.medicineName}</TableCell>
                  <TableCell>{r.batchNumber || '—'}</TableCell>
                  <TableCell align="right">{r.quantity}</TableCell>
                  <TableCell align="right">{r.freeQuantity || '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {activeRows.length > 0 && (
        <Box display="flex" justifyContent="center" mt={2}>
          <Pagination
            count={totalPages}
            page={pageSafe}
            onChange={(_, p) => setPage(p)}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Box>
  );
};

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
  Card,
  CardContent,
  Pagination,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  IconButton,
  Chip,
} from '@mui/material';
import {
  Search,
  Download,
  WhatsApp,
  ExpandMore,
  ExpandLess,
  Receipt,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useReceivableOrders } from '../hooks/useOrders';
import { useStores } from '../hooks/useStores';
import { useSalesOfficers } from '../hooks/useSalesOfficers';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  buildSoReceivableSummaries,
  formatSoDuesWhatsAppMessage,
  type SoReceivableSummary,
} from '../utils/soReceivables';
import { formatOrderInvoiceLabel } from '../utils/storeReceivables';
import { exportSoReceivables } from '../utils/export';
import {
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from '../utils/orderWhatsAppItems';
import { resolveOrderInvoiceGrandTotal } from '../utils/orderTotals';
import { useAppDialog } from '../context/AppDialogProvider';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SoReceivablesPage: React.FC = () => {
  const { data: orders, isLoading: ordersLoading } = useReceivableOrders();
  const { data: stores, isLoading: storesLoading } = useStores();
  const { data: salesOfficers = [], isLoading: soLoading } = useSalesOfficers();
  const { alert } = useAppDialog();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(15);
  const [expandedSoId, setExpandedSoId] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<SoReceivableSummary | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('outstanding', 'desc');

  const summaries = useMemo(
    () => buildSoReceivableSummaries(orders ?? [], stores ?? [], salesOfficers),
    [orders, stores, salesOfficers]
  );

  const totals = useMemo(() => {
    const totalOutstanding = summaries.reduce((s, r) => s + r.totalOutstanding, 0);
    const openBills = summaries.reduce((s, r) => s + r.orderCount, 0);
    const storesWithDues = summaries.reduce((s, r) => s + r.retailerCount, 0);
    return {
      totalOutstanding,
      soWithDues: summaries.filter((s) => s.salesOfficerId).length,
      unassigned: summaries.find((s) => !s.salesOfficerId)?.retailerCount ?? 0,
      openBills,
      storesWithDues,
    };
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.phoneNumber.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.retailers.some(
          (r) =>
            r.displayName.toLowerCase().includes(q) ||
            r.storeCode.toLowerCase().includes(q)
        )
    );
  }, [summaries, searchTerm]);

  const sortedSummaries = useMemo(() => {
    const list = [...filteredSummaries];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'soName':
          return applyDirection(
            compareAsc(a.displayName.toLowerCase(), b.displayName.toLowerCase()),
            sortDirection
          );
        case 'retailerCount':
          return applyDirection(compareAsc(a.retailerCount, b.retailerCount), sortDirection);
        case 'orderCount':
          return applyDirection(compareAsc(a.orderCount, b.orderCount), sortDirection);
        case 'outstanding':
          return applyDirection(compareAsc(a.totalOutstanding, b.totalOutstanding), sortDirection);
        case 'oldest':
          return applyDirection(
            compareAsc(
              a.oldestOrderDate ? toTimeMs(a.oldestOrderDate) : 0,
              b.oldestOrderDate ? toTimeMs(b.oldestOrderDate) : 0
            ),
            sortDirection
          );
        default:
          return applyDirection(compareAsc(a.totalOutstanding, b.totalOutstanding), sortDirection);
      }
    });
    return list;
  }, [filteredSummaries, sortKey, sortDirection]);

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const totalPages = Math.ceil(sortedSummaries.length / rowsPerPage) || 1;
  const paginatedSummaries = sortedSummaries.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  const rowKey = (row: SoReceivableSummary) => row.salesOfficerId || '__unassigned__';

  const handleWhatsApp = async (row: SoReceivableSummary) => {
    if (!row.salesOfficerId) {
      await alert('Unassigned stores have no Sales Officer phone to message.', {
        severity: 'warning',
      });
      return;
    }
    const phone = normalizeWhatsAppPhone(row.phoneNumber);
    const text = formatSoDuesWhatsAppMessage(row);
    if (!phone) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* ignore */
      }
      await alert(
        'Message copied. This Sales Officer has no phone number on file — paste into WhatsApp Web manually.',
        { severity: 'warning' }
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer');
  };

  const handleDownloadOne = async (row: SoReceivableSummary) => {
    const slug = row.salesOfficerId
      ? row.displayName.replace(/[^\w\-]+/g, '-').toLowerCase().slice(0, 40) || 'so'
      : 'unassigned';
    await exportSoReceivables([row], `so-dues-${slug}`);
  };

  const handleDownloadAll = async () => {
    await exportSoReceivables(summaries, 'so-dues-all');
  };

  if (ordersLoading || storesLoading || soLoading) {
    return <Loading message="Loading SO receivables..." />;
  }

  return (
    <Box>
      <Box mb={3} display="flex" flexWrap="wrap" gap={2} alignItems="flex-start" justifyContent="space-between">
        <Box>
          <Typography variant="h4" gutterBottom>
            SO receivables
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Outstanding store dues grouped by Sales Officer. Send a WhatsApp update to an SO, or
            download dues for one SO / all SOs.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Download />}
          onClick={() => void handleDownloadAll()}
          disabled={summaries.length === 0}
        >
          Download all SO dues
        </Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total outstanding
              </Typography>
              <Typography variant="h5" color="error.main" fontWeight={600}>
                {formatCurrency(totals.totalOutstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                SOs with dues
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.soWithDues}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Stores with dues
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.storesWithDues}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Unassigned stores
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.unassigned}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          placeholder="Search by SO name, phone, email, or store..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <SortableTableHeadCell
                columnId="soName"
                label="Sales Officer"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="retailerCount"
                label="Stores"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="orderCount"
                label="Open bills"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="outstanding"
                label="Outstanding"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="oldest"
                label="Oldest bill"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedSummaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {summaries.length === 0
                      ? 'No outstanding receivables — all store bills are paid.'
                      : 'No Sales Officers match your search.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedSummaries.map((row) => {
                const key = rowKey(row);
                const open = expandedSoId === key;
                return (
                  <React.Fragment key={key}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => setExpandedSoId(open ? null : key)}
                          aria-label={open ? 'Collapse' : 'Expand'}
                        >
                          {open ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={500}>{row.displayName}</Typography>
                        {row.phoneNumber ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.phoneNumber}
                          </Typography>
                        ) : row.salesOfficerId ? (
                          <Typography variant="caption" color="warning.main" display="block">
                            No phone on file
                          </Typography>
                        ) : null}
                        {!row.salesOfficerId && (
                          <Chip size="small" label="Unassigned" sx={{ mt: 0.5 }} />
                        )}
                      </TableCell>
                      <TableCell align="right">{row.retailerCount}</TableCell>
                      <TableCell align="right">{row.orderCount}</TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={600} color="error.main">
                          {formatCurrency(row.totalOutstanding)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {row.oldestOrderDate
                          ? format(row.oldestOrderDate, 'MMM dd, yyyy')
                          : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Box display="flex" gap={0.75} justifyContent="flex-end" flexWrap="wrap">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Receipt />}
                            onClick={() => setDrillDown(row)}
                          >
                            View
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            startIcon={<WhatsApp />}
                            disabled={!row.salesOfficerId}
                            onClick={() => void handleWhatsApp(row)}
                          >
                            WhatsApp
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Download />}
                            onClick={() => void handleDownloadOne(row)}
                          >
                            Excel
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
                        <Collapse in={open} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Store code</TableCell>
                                  <TableCell>Shop</TableCell>
                                  <TableCell align="right">Bills</TableCell>
                                  <TableCell align="right">Outstanding</TableCell>
                                  <TableCell align="right">Open</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {row.retailers.map((r) => (
                                  <TableRow key={r.retailerId}>
                                    <TableCell>{r.storeCode}</TableCell>
                                    <TableCell>{r.displayName}</TableCell>
                                    <TableCell align="right">{r.orderCount}</TableCell>
                                    <TableCell align="right">
                                      {formatCurrency(r.totalOutstanding)}
                                    </TableCell>
                                    <TableCell align="right">
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          navigate(`/store-receivables`)
                                        }
                                      >
                                        Store receivables
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {sortedSummaries.length > rowsPerPage && (
        <Box display="flex" justifyContent="center" mt={3}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
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
              Outstanding bills — {drillDown.displayName}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {formatCurrency(drillDown.totalOutstanding)} due · {drillDown.retailerCount}{' '}
                store{drillDown.retailerCount === 1 ? '' : 's'} · {drillDown.orderCount} bill
                {drillDown.orderCount === 1 ? '' : 's'}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              {drillDown.retailers.map((retailer) => (
                <Box key={retailer.retailerId} mb={3}>
                  <Typography fontWeight={600}>
                    {retailer.displayName}{' '}
                    <Typography component="span" variant="body2" color="text.secondary">
                      ({retailer.storeCode}) — {formatCurrency(retailer.totalOutstanding)}
                    </Typography>
                  </Typography>
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Invoice</TableCell>
                          <TableCell>Date</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Total</TableCell>
                          <TableCell align="right">Outstanding</TableCell>
                          <TableCell align="right" />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {retailer.orders.map((bill) => (
                          <TableRow key={bill.id}>
                            <TableCell>{formatOrderInvoiceLabel(bill)}</TableCell>
                            <TableCell>
                              {bill.orderDate
                                ? format(new Date(bill.orderDate), 'MMM dd, yyyy')
                                : '—'}
                            </TableCell>
                            <TableCell>{bill.paymentStatus || 'Unpaid'}</TableCell>
                            <TableCell align="right">
                              {formatCurrency(resolveOrderInvoiceGrandTotal(bill))}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(bill.outstanding)}
                            </TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                onClick={() => {
                                  setDrillDown(null);
                                  navigate(`/orders/${bill.id}`);
                                }}
                              >
                                Open order
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ))}
            </DialogContent>
            <DialogActions>
              <Button
                startIcon={<WhatsApp />}
                color="success"
                disabled={!drillDown.salesOfficerId}
                onClick={() => void handleWhatsApp(drillDown)}
              >
                WhatsApp SO
              </Button>
              <Button
                startIcon={<Download />}
                onClick={() => void handleDownloadOne(drillDown)}
              >
                Download Excel
              </Button>
              <Button onClick={() => setDrillDown(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

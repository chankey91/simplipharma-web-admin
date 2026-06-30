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
  Chip,
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
  IconButton,
} from '@mui/material';
import { Search, Visibility, Receipt } from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { usePurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { useVendors } from '../hooks/useVendors';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import {
  buildVendorLedgerSummaries,
  type VendorLedgerSummary,
  type PayablePurchaseInvoice,
} from '../utils/vendorLedger';

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const paymentChipColor = (status?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'Paid') return 'success';
  if (status === 'Partial') return 'warning';
  if (status === 'Unpaid' || !status) return 'error';
  return 'default';
};

export const VendorLedgerPage: React.FC = () => {
  const { data: invoices, isLoading: invoicesLoading } = usePurchaseInvoices();
  const { data: vendors, isLoading: vendorsLoading } = useVendors();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [drillDown, setDrillDown] = useState<VendorLedgerSummary | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('outstanding', 'desc');

  const summaries = useMemo(
    () => buildVendorLedgerSummaries(invoices ?? [], vendors ?? []),
    [invoices, vendors]
  );

  const totals = useMemo(() => {
    const totalOutstanding = summaries.reduce((s, r) => s + r.totalOutstanding, 0);
    const openInvoices = summaries.reduce((s, r) => s + r.invoiceCount, 0);
    return {
      totalOutstanding,
      vendorsWithPayables: summaries.length,
      openInvoices,
    };
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.gstNumber.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q)
    );
  }, [summaries, searchTerm]);

  const sortedSummaries = useMemo(() => {
    const list = [...filteredSummaries];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'vendorName':
          return applyDirection(
            compareAsc(a.displayName.toLowerCase(), b.displayName.toLowerCase()),
            sortDirection
          );
        case 'gst':
          return applyDirection(compareAsc(a.gstNumber, b.gstNumber), sortDirection);
        case 'invoiceCount':
          return applyDirection(compareAsc(a.invoiceCount, b.invoiceCount), sortDirection);
        case 'outstanding':
          return applyDirection(compareAsc(a.totalOutstanding, b.totalOutstanding), sortDirection);
        case 'oldest':
          return applyDirection(
            compareAsc(
              a.oldestInvoiceDate ? toTimeMs(a.oldestInvoiceDate) : 0,
              b.oldestInvoiceDate ? toTimeMs(b.oldestInvoiceDate) : 0
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

  const totalPages = Math.ceil(sortedSummaries.length / rowsPerPage);
  const paginatedSummaries = sortedSummaries.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  if (invoicesLoading || vendorsLoading) {
    return <Loading message="Loading vendor ledger..." />;
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Vendor ledger
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Amounts payable to vendors from purchase invoices. Open a vendor to see unpaid bills,
          then record payment on the purchase invoice details page.
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Total payable
              </Typography>
              <Typography variant="h5" color="error.main" fontWeight={600}>
                {formatCurrency(totals.totalOutstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Vendors with dues
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.vendorsWithPayables}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" variant="subtitle2" gutterBottom>
                Open purchase bills
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {totals.openInvoices}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          placeholder="Search by vendor name, GSTIN, or phone..."
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
              <SortableTableHeadCell
                columnId="vendorName"
                label="Vendor"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="gst"
                label="GSTIN"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
              />
              <SortableTableHeadCell
                columnId="invoiceCount"
                label="Open bills"
                sortKey={sortKey}
                sortDirection={sortDirection}
                onRequestSort={requestSortResetPage}
                align="right"
              />
              <SortableTableHeadCell
                columnId="outstanding"
                label="Payable"
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
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {summaries.length === 0
                      ? 'No outstanding payables — all vendor bills are paid.'
                      : 'No vendors match your search.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedSummaries.map((row) => (
                <TableRow key={row.vendorId} hover>
                  <TableCell>
                    <Typography fontWeight={500}>{row.displayName}</Typography>
                    {row.phone !== '—' && (
                      <Typography variant="caption" color="text.secondary">
                        {row.phone}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{row.gstNumber}</TableCell>
                  <TableCell align="right">{row.invoiceCount}</TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={600} color="error.main">
                      {formatCurrency(row.totalOutstanding)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.oldestInvoiceDate
                      ? format(row.oldestInvoiceDate, 'MMM dd, yyyy')
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Receipt />}
                      onClick={() => setDrillDown(row)}
                    >
                      View bills
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {sortedSummaries.length > 0 && (
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
              Payable bills — {drillDown.displayName}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {formatCurrency(drillDown.totalOutstanding)} due across{' '}
                {drillDown.invoiceCount} bill{drillDown.invoiceCount === 1 ? '' : 's'}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">Paid</TableCell>
                      <TableCell align="right">Due</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drillDown.invoices.map((inv) => (
                      <PayableInvoiceRow
                        key={inv.id}
                        invoice={inv}
                        onOpen={() => {
                          setDrillDown(null);
                          navigate(`/purchases/${inv.id}`);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDrillDown(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

const PayableInvoiceRow: React.FC<{
  invoice: PayablePurchaseInvoice;
  onOpen: () => void;
}> = ({ invoice, onOpen }) => {
  const paid = invoice.paidAmount ?? 0;
  const total = invoice.totalAmount ?? 0;

  return (
    <TableRow hover>
      <TableCell>{invoice.invoiceNumber}</TableCell>
      <TableCell>
        {format(
          invoice.invoiceDate instanceof Date
            ? invoice.invoiceDate
            : new Date(invoice.invoiceDate),
          'MMM dd, yyyy'
        )}
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={invoice.paymentStatus || 'Unpaid'}
          color={paymentChipColor(invoice.paymentStatus)}
        />
      </TableCell>
      <TableCell align="right">{formatCurrency(total)}</TableCell>
      <TableCell align="right">{formatCurrency(paid)}</TableCell>
      <TableCell align="right">
        <Typography fontWeight={600} color="error.main">
          {formatCurrency(invoice.outstanding)}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <IconButton size="small" onClick={onOpen} title="Open invoice & record payment">
          <Visibility />
        </IconButton>
      </TableCell>
    </TableRow>
  );
};

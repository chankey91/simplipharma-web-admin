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
  Grid,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import { Download, PictureAsPdf, Search } from '@mui/icons-material';
import { format } from 'date-fns';
import { useVendors } from '../hooks/useVendors';
import { useVendorPurchaseInvoices } from '../hooks/usePurchaseInvoices';
import { Loading } from '../components/Loading';
import {
  buildVendorLedger,
  defaultVendorLedgerDateRange,
  formatLedgerAmount,
  type VendorLedgerResult,
} from '../utils/vendorLedger';
import {
  downloadVendorLedgerExcel,
  downloadVendorLedgerPdf,
} from '../utils/vendorLedgerExport';
import { useAppDialog } from '../context/AppDialogProvider';

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const VendorLedgerPage: React.FC = () => {
  const { data: vendors, isLoading: vendorsLoading } = useVendors();
  const { alert } = useAppDialog();

  const defaults = useMemo(() => defaultVendorLedgerDateRange(), []);
  const [vendorId, setVendorId] = useState('');
  const [fromDate, setFromDate] = useState(toInputDate(defaults.from));
  const [toDate, setToDate] = useState(toInputDate(defaults.to));
  const [vendorSearch, setVendorSearch] = useState('');
  const [generated, setGenerated] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const { data: invoices, isLoading: invoicesLoading, isFetching } = useVendorPurchaseInvoices(
    vendorId,
    { enabled: !!vendorId && generated }
  );

  const selectedVendor = vendors?.find((v) => v.id === vendorId) ?? null;

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    const list = (vendors ?? []).filter((v) => v.isActive !== false);
    if (!q) return list;
    return list.filter(
      (v) =>
        v.vendorName.toLowerCase().includes(q) ||
        v.gstNumber?.toLowerCase().includes(q) ||
        v.phoneNumber?.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  const ledger: VendorLedgerResult | null = useMemo(() => {
    if (!generated || !vendorId || !invoices) return null;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return null;
    return buildVendorLedger(selectedVendor, invoices, from, to);
  }, [generated, vendorId, invoices, fromDate, toDate, selectedVendor]);

  const handleGenerate = () => {
    if (!vendorId) {
      void alert('Please select a vendor.', { severity: 'warning' });
      return;
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      void alert('Please enter valid dates.', { severity: 'warning' });
      return;
    }
    if (from > to) {
      void alert('From date must be on or before To date.', { severity: 'warning' });
      return;
    }
    setGenerated(true);
  };

  const handlePdf = async () => {
    if (!ledger) return;
    setExportingPdf(true);
    try {
      await downloadVendorLedgerPdf(ledger);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      await alert(`Failed to export PDF: ${msg}`, { severity: 'error' });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExcel = () => {
    if (!ledger) return;
    setExportingExcel(true);
    try {
      downloadVendorLedgerExcel(ledger);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      void alert(`Failed to export Excel: ${msg}`, { severity: 'error' });
    } finally {
      setExportingExcel(false);
    }
  };

  if (vendorsLoading) {
    return <Loading message="Loading vendors..." />;
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Vendor ledger
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Select a vendor and date range to generate a debit/credit ledger account. Download as PDF
          or Excel.
        </Typography>
      </Box>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search vendors..."
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />,
              }}
              sx={{ mb: 1 }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Vendor</InputLabel>
              <Select
                label="Vendor"
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setGenerated(false);
                }}
              >
                <MenuItem value="">
                  <em>Select vendor</em>
                </MenuItem>
                {filteredVendors.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.vendorName}
                    {v.gstNumber ? ` (${v.gstNumber})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              size="small"
              label="From date"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setGenerated(false);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              size="small"
              label="To date"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setGenerated(false);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Box display="flex" gap={1} flexWrap="wrap">
              <Button variant="contained" onClick={handleGenerate} disabled={!vendorId}>
                Generate ledger
              </Button>
              <Button
                variant="outlined"
                startIcon={<PictureAsPdf />}
                onClick={() => void handlePdf()}
                disabled={!ledger || exportingPdf}
              >
                {exportingPdf ? 'Exporting…' : 'PDF'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleExcel}
                disabled={!ledger || exportingExcel}
              >
                {exportingExcel ? 'Exporting…' : 'Excel'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {generated && (invoicesLoading || isFetching) && <Loading message="Building ledger..." />}

      {generated && !invoicesLoading && !isFetching && ledger && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" align="center" fontWeight={700}>
              {ledger.vendorName}
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary">
              Ledger Account · {format(ledger.fromDate, 'd-MMM-yy')} to{' '}
              {format(ledger.toDate, 'd-MMM-yy')}
            </Typography>
            {ledger.vendorAddress !== '—' && (
              <Typography variant="caption" align="center" display="block" color="text.secondary">
                {ledger.vendorAddress}
              </Typography>
            )}
            <Grid container spacing={2} sx={{ mt: 2 }}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Opening
                </Typography>
                <Typography fontWeight={600}>{formatCurrency(ledger.openingBalance)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Total debit
                </Typography>
                <Typography fontWeight={600}>{formatCurrency(ledger.totalDebit)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Total credit
                </Typography>
                <Typography fontWeight={600}>{formatCurrency(ledger.totalCredit)}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">
                  Closing
                </Typography>
                <Typography fontWeight={600} color="error.main">
                  {formatCurrency(ledger.closingBalance)}
                </Typography>
              </Grid>
            </Grid>
          </Paper>

          {ledger.entries.length === 0 ? (
            <Alert severity="info">No transactions in this period for the selected vendor.</Alert>
          ) : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Particulars</TableCell>
                    <TableCell>Vch Type</TableCell>
                    <TableCell>Vch No.</TableCell>
                    <TableCell align="right">Debit</TableCell>
                    <TableCell align="right">Credit</TableCell>
                    <TableCell align="right">Balance</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ledger.entries.map((row, idx) => (
                    <TableRow
                      key={`${row.vchNo}-${idx}`}
                      sx={row.isSummary ? { bgcolor: 'action.hover' } : undefined}
                    >
                      <TableCell>{format(row.date, 'd-MMM-yy')}</TableCell>
                      <TableCell>
                        {row.particulars}
                        {row.particularsBold ? (
                          <Typography component="span" fontWeight={700}>
                            {row.particularsBold}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.vchType === 'Opening' ? '' : row.vchType}</TableCell>
                      <TableCell>{row.vchNo}</TableCell>
                      <TableCell align="right">
                        {row.debit ? formatLedgerAmount(row.debit) : ''}
                      </TableCell>
                      <TableCell align="right">
                        {row.credit ? formatLedgerAmount(row.credit) : ''}
                      </TableCell>
                      <TableCell align="right">{formatLedgerAmount(row.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell colSpan={4}>
                      <Typography fontWeight={700}>Closing Balance</Typography>
                    </TableCell>
                    <TableCell align="right">
                      {ledger.closingBalance > 0
                        ? formatLedgerAmount(ledger.closingBalance)
                        : ''}
                    </TableCell>
                    <TableCell align="right">
                      {ledger.closingBalance < 0
                        ? formatLedgerAmount(Math.abs(ledger.closingBalance))
                        : ''}
                    </TableCell>
                    <TableCell align="right">
                      {formatLedgerAmount(ledger.closingBalance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Box>
  );
};

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
import { useStores } from '../hooks/useStores';
import { useRetailerLedgerData } from '../hooks/useOrders';
import { Loading } from '../components/Loading';
import {
  buildStoreLedger,
  defaultStoreLedgerDateRange,
  formatLedgerAmount,
  type StoreLedgerResult,
} from '../utils/storeLedger';
import {
  downloadStoreLedgerExcel,
  downloadStoreLedgerPdf,
} from '../utils/storeLedgerExport';
import { useAppDialog } from '../context/AppDialogProvider';

const toInputDate = (d: Date) => format(d, 'yyyy-MM-dd');

const formatCurrency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const StoreLedgerPage: React.FC = () => {
  const { data: stores, isLoading: storesLoading } = useStores();
  const { alert } = useAppDialog();

  const defaults = useMemo(() => defaultStoreLedgerDateRange(), []);
  const [retailerId, setRetailerId] = useState('');
  const [fromDate, setFromDate] = useState(toInputDate(defaults.from));
  const [toDate, setToDate] = useState(toInputDate(defaults.to));
  const [storeSearch, setStoreSearch] = useState('');
  const [generated, setGenerated] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const { data: ledgerData, isLoading: ledgerLoading, isFetching, refetch } = useRetailerLedgerData(
    retailerId,
    { enabled: !!retailerId && generated }
  );

  const selectedStore = stores?.find((s) => s.id === retailerId) ?? null;

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    const list = (stores ?? []).filter((s) => s.isActive !== false);
    if (!q) return list;
    return list.filter(
      (s) =>
        (s.shopName || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q) ||
        (s.storeCode || '').toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        (s.gst || '').toLowerCase().includes(q)
    );
  }, [stores, storeSearch]);

  const ledger: StoreLedgerResult | null = useMemo(() => {
    if (!generated || !retailerId || !ledgerData) return null;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return null;
    return buildStoreLedger(
      selectedStore,
      ledgerData.orders,
      ledgerData.creditNotes,
      ledgerData.debitNotes,
      from,
      to
    );
  }, [generated, retailerId, ledgerData, fromDate, toDate, selectedStore]);

  const handleGenerate = () => {
    if (!retailerId) {
      void alert('Please select a medical store.', { severity: 'warning' });
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
    if (generated) {
      void refetch();
    }
  };

  const handlePdf = async () => {
    if (!ledger) return;
    setExportingPdf(true);
    try {
      await downloadStoreLedgerPdf(ledger);
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
      downloadStoreLedgerExcel(ledger);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      void alert(`Failed to export Excel: ${msg}`, { severity: 'error' });
    } finally {
      setExportingExcel(false);
    }
  };

  if (storesLoading) {
    return <Loading message="Loading medical stores..." />;
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Store ledger
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Select a medical store and date range to generate a debit/credit receivables ledger
          (sales, receipts, credit notes, and debit notes). Download as PDF or Excel.
        </Typography>
      </Box>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search stores..."
              value={storeSearch}
              onChange={(e) => setStoreSearch(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />,
              }}
              sx={{ mb: 1 }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Medical store</InputLabel>
              <Select
                label="Medical store"
                value={retailerId}
                onChange={(e) => {
                  setRetailerId(e.target.value);
                  setGenerated(false);
                }}
              >
                <MenuItem value="">
                  <em>Select store</em>
                </MenuItem>
                {filteredStores.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.shopName || s.displayName || s.email}
                    {s.storeCode ? ` (${s.storeCode})` : ''}
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
              <Button variant="contained" onClick={handleGenerate} disabled={!retailerId}>
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

      {generated && (ledgerLoading || isFetching) && <Loading message="Building ledger..." />}

      {generated && !ledgerLoading && !isFetching && ledger && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" align="center" fontWeight={700}>
              {ledger.storeName}
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary">
              Ledger Account · {format(ledger.fromDate, 'd-MMM-yy')} to{' '}
              {format(ledger.toDate, 'd-MMM-yy')}
            </Typography>
            {ledger.storeCode !== '—' && (
              <Typography variant="caption" align="center" display="block" color="text.secondary">
                Store code: {ledger.storeCode}
              </Typography>
            )}
            {ledger.storeAddress !== '—' && (
              <Typography variant="caption" align="center" display="block" color="text.secondary">
                {ledger.storeAddress}
              </Typography>
            )}
            {ledger.storeGstNumber !== '—' && (
              <Typography variant="caption" align="center" display="block" color="text.secondary">
                GSTIN: {ledger.storeGstNumber}
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
            <Alert severity="info">No transactions in this period for the selected store.</Alert>
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

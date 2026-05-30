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
  IconButton,
  TextField,
  InputAdornment,
  Pagination,
  Button,
  Alert,
  Tabs,
  Tab,
  Chip,
} from '@mui/material';
import { Search, Download, Refresh, Build } from '@mui/icons-material';
import { format } from 'date-fns';
import { useCreditNotes, useDebitNotes, useBackfillCreditNotes } from '../hooks/useCreditNotes';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generateCreditNotePdf } from '../utils/creditNote';
import { generateDebitNotePdf } from '../utils/debitNote';
import { CreditNote, DebitNote } from '../types';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

type NoteTab = 'credit' | 'debit';

const formatAmount = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

export const CreditNotesPage: React.FC = () => {
  const [tab, setTab] = useState<NoteTab>('credit');
  const { data: creditNotes, isLoading: creditLoading, error: creditError, refetch: refetchCredit } =
    useCreditNotes();
  const { data: debitNotes, isLoading: debitLoading, error: debitError, refetch: refetchDebit } =
    useDebitNotes();
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage] = useState(10);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const backfillMutation = useBackfillCreditNotes();
  const { alert, confirm, prompt } = useAppDialog();

  const { sortKey, sortDirection, requestSort } = useTableSort('documentDate', 'desc');

  const filteredCredit = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const list = creditNotes || [];
    if (!term) return list;
    return list.filter(
      (n) =>
        n.creditNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        n.orderId.toLowerCase().includes(term)
    );
  }, [creditNotes, searchTerm]);

  const filteredDebit = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const list = debitNotes || [];
    if (!term) return list;
    return list.filter(
      (n) =>
        n.debitNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        (n.reason || '').toLowerCase().includes(term) ||
        (n.orderId || '').toLowerCase().includes(term)
    );
  }, [debitNotes, searchTerm]);

  const sortedCredit = useMemo(() => {
    const list = [...filteredCredit];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'documentNumber':
          return applyDirection(compareAsc(a.creditNoteNumber, b.creditNoteNumber), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.retailerName || a.retailerEmail || ''}`.toLowerCase(),
              `${b.retailerName || b.retailerEmail || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'originalInvoice':
          return applyDirection(
            compareAsc(a.originalInvoiceNumber || '', b.originalInvoiceNumber || ''),
            sortDirection
          );
        case 'amount':
          return applyDirection(compareAsc(a.totalAmount ?? 0, b.totalAmount ?? 0), sortDirection);
        case 'documentDate':
        default:
          return applyDirection(
            compareAsc(toTimeMs(a.creditNoteDate), toTimeMs(b.creditNoteDate)),
            sortDirection
          );
      }
    });
    return list;
  }, [filteredCredit, sortKey, sortDirection]);

  const sortedDebit = useMemo(() => {
    const list = [...filteredDebit];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'documentNumber':
          return applyDirection(compareAsc(a.debitNoteNumber, b.debitNoteNumber), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.retailerName || a.retailerEmail || ''}`.toLowerCase(),
              `${b.retailerName || b.retailerEmail || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'originalInvoice':
          return applyDirection(
            compareAsc(a.originalInvoiceNumber || '', b.originalInvoiceNumber || ''),
            sortDirection
          );
        case 'amount':
          return applyDirection(compareAsc(a.totalAmount ?? 0, b.totalAmount ?? 0), sortDirection);
        case 'documentDate':
        default:
          return applyDirection(
            compareAsc(toTimeMs(a.debitNoteDate), toTimeMs(b.debitNoteDate)),
            sortDirection
          );
      }
    });
    return list;
  }, [filteredDebit, sortKey, sortDirection]);

  const activeList = tab === 'credit' ? sortedCredit : sortedDebit;
  const paginated = activeList.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const totalPages = Math.max(1, Math.ceil(activeList.length / rowsPerPage));

  const isLoading = tab === 'credit' ? creditLoading : debitLoading;
  const loadError = tab === 'credit' ? creditError : debitError;

  const handleDownloadCredit = async (note: CreditNote) => {
    setDownloadingId(note.id);
    try {
      await generateCreditNotePdf(note);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadDebit = async (note: DebitNote) => {
    setDownloadingId(note.id);
    try {
      await generateDebitNotePdf(note);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleTabChange = (_: React.SyntheticEvent, value: NoteTab) => {
    setTab(value);
    setPage(1);
    setSearchTerm('');
    requestSort('documentDate');
  };

  const handleBackfillOldCreditNotes = async () => {
    if (
      !(await confirm(
        'Repair batch and MRP on older credit notes from linked order/return data? This updates stored credit note documents in Firestore.'
      ))
    ) {
      return;
    }
    try {
      const summary = await backfillMutation.mutateAsync();
      await alert(
        `Backfill complete.\nScanned: ${summary.scanned}\nUpdated: ${summary.updated}\nUnchanged: ${summary.unchanged}\nFailed: ${summary.failed}`,
        { severity: 'success' }
      );
      refetchCredit();
    } catch (err: unknown) {
      await alert(err instanceof Error ? err.message : 'Backfill failed', { severity: 'error' });
    }
  };

  if (creditLoading && debitLoading) {
    return <Loading message="Loading credit & debit notes..." />;
  }

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Credit & debit notes' }]} />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Credit & debit notes
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Credit notes from order returns; debit notes for future billing adjustments
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {tab === 'credit' && (
            <Button
              startIcon={<Build />}
              variant="outlined"
              onClick={handleBackfillOldCreditNotes}
              disabled={backfillMutation.isPending}
            >
              {backfillMutation.isPending ? 'Repairing…' : 'Repair batch/MRP'}
            </Button>
          )}
          <Button
            startIcon={<Refresh />}
            variant="outlined"
            onClick={() => (tab === 'credit' ? refetchCredit() : refetchDebit())}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab
          value="credit"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Credit notes
              <Chip label={creditNotes?.length ?? 0} size="small" />
            </Box>
          }
        />
        <Tab
          value="debit"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Debit notes
              <Chip label={debitNotes?.length ?? 0} size="small" />
            </Box>
          }
        />
      </Tabs>

      {tab === 'credit' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Credit notes are created automatically when order returns are approved. Use &quot;Repair batch/MRP&quot; once
          to fix older notes that were saved before batch and MRP were stored on line items.
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          Debit notes are not issued yet. This tab is ready for future use when additional charges or billing corrections
          are recorded against retailers (collection: <code>debit_notes</code>).
        </Alert>
      )}

      {loadError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load {tab === 'credit' ? 'credit' : 'debit'} notes
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={
            tab === 'credit'
              ? 'Search credit note no., retailer, invoice, order...'
              : 'Search debit note no., retailer, invoice, reason...'
          }
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

      {isLoading ? (
        <Loading message={`Loading ${tab === 'credit' ? 'credit' : 'debit'} notes...`} />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortableTableHeadCell
                  columnId="documentNumber"
                  label={tab === 'credit' ? 'Credit note' : 'Debit note'}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onRequestSort={requestSort}
                />
                <SortableTableHeadCell
                  columnId="documentDate"
                  label="Date"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onRequestSort={requestSort}
                />
                <SortableTableHeadCell
                  columnId="retailer"
                  label="Retailer"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onRequestSort={requestSort}
                />
                <SortableTableHeadCell
                  columnId="originalInvoice"
                  label="Reference invoice"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onRequestSort={requestSort}
                />
                {tab === 'debit' ? <TableCell>Reason</TableCell> : null}
                <SortableTableHeadCell
                  columnId="amount"
                  label="Amount"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onRequestSort={requestSort}
                  align="right"
                />
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tab === 'debit' ? 7 : 6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {tab === 'credit' ? 'No credit notes yet' : 'No debit notes yet'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : tab === 'credit' ? (
                paginated.map((note) => {
                  const cn = note as CreditNote;
                  return (
                    <TableRow key={cn.id} hover>
                      <TableCell>{cn.creditNoteNumber}</TableCell>
                      <TableCell>
                        {format(
                          cn.creditNoteDate instanceof Date ? cn.creditNoteDate : new Date(cn.creditNoteDate),
                          'dd MMM yyyy'
                        )}
                      </TableCell>
                      <TableCell>{cn.retailerName || cn.retailerEmail || cn.retailerId}</TableCell>
                      <TableCell>{cn.originalInvoiceNumber || '—'}</TableCell>
                      <TableCell align="right">{formatAmount(cn.totalAmount)}</TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          title="Download credit note PDF"
                          onClick={() => handleDownloadCredit(cn)}
                          disabled={downloadingId === cn.id}
                        >
                          <Download />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                paginated.map((note) => {
                  const dn = note as DebitNote;
                  return (
                    <TableRow key={dn.id} hover>
                      <TableCell>{dn.debitNoteNumber}</TableCell>
                      <TableCell>
                        {format(
                          dn.debitNoteDate instanceof Date ? dn.debitNoteDate : new Date(dn.debitNoteDate),
                          'dd MMM yyyy'
                        )}
                      </TableCell>
                      <TableCell>{dn.retailerName || dn.retailerEmail || dn.retailerId}</TableCell>
                      <TableCell>{dn.originalInvoiceNumber || dn.orderId || '—'}</TableCell>
                      <TableCell>{dn.reason || dn.sourceType || '—'}</TableCell>
                      <TableCell align="right">{formatAmount(dn.totalAmount)}</TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          title="Download debit note PDF"
                          onClick={() => handleDownloadDebit(dn)}
                          disabled={downloadingId === dn.id}
                        >
                          <Download />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {activeList.length > rowsPerPage && !isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
        </Box>
      ) : null}
    </Box>
  );
};

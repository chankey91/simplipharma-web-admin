import React, { useEffect, useMemo, useState } from 'react';
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
  LinearProgress,
} from '@mui/material';
import { Search, Download, Refresh, Build, CloudSync } from '@mui/icons-material';
import { format } from 'date-fns';
import {
  useCreditNotes,
  useDebitNotes,
  useCreditNotesSearch,
  useDebitNotesSearch,
  useBackfillCreditNotes,
} from '../hooks/useCreditNotes';
import { getCreditNoteById } from '../services/creditNotes';
import { getDebitNoteById } from '../services/debitNotes';
import {
  reindexCreditNotesTypesense,
  reindexDebitNotesTypesense,
} from '../services/creditNoteSearch';
import { Loading } from '../components/Loading';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { generateCreditNotePdf } from '../utils/creditNote';
import { generateDebitNotePdf } from '../utils/debitNote';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

type NoteTab = 'credit' | 'debit';

const ROWS_PER_PAGE = 10;

const formatAmount = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

/** Normalized row for the notes table (works for both credit and debit). */
interface NoteRow {
  id: string;
  documentNumber: string;
  date: Date;
  retailer: string;
  originalInvoiceNumber: string;
  reason: string;
  totalAmount: number;
}

const mapSortField = (key: string, isCredit: boolean): string => {
  switch (key) {
    case 'documentNumber':
      return isCredit ? 'creditNoteNumber' : 'debitNoteNumber';
    case 'retailer':
      return 'retailerSort';
    case 'originalInvoice':
      return 'originalInvoiceNumber';
    case 'amount':
      return 'totalAmount';
    case 'documentDate':
    default:
      return isCredit ? 'creditNoteDate' : 'debitNoteDate';
  }
};

export const CreditNotesPage: React.FC = () => {
  const [tab, setTab] = useState<NoteTab>('credit');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const backfillMutation = useBackfillCreditNotes();
  const { alert, confirm } = useAppDialog();

  const { sortKey, sortDirection, requestSort } = useTableSort('documentDate', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const creditSearch = useCreditNotesSearch(
    {
      query: debouncedTerm,
      sortField: mapSortField(sortKey, true),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );
  const debitSearch = useDebitNotesSearch(
    {
      query: debouncedTerm,
      sortField: mapSortField(sortKey, false),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );

  useEffect(() => {
    if (creditSearch.isError || debitSearch.isError) setTypesenseDisabled(true);
  }, [creditSearch.isError, debitSearch.isError]);

  // Fallback: full-load client-side (only when Typesense unavailable).
  const {
    data: creditNotes,
    isLoading: creditLoading,
    error: creditError,
    refetch: refetchCreditAll,
  } = useCreditNotes({ enabled: typesenseDisabled });
  const {
    data: debitNotes,
    isLoading: debitLoading,
    error: debitError,
    refetch: refetchDebitAll,
  } = useDebitNotes({ enabled: typesenseDisabled });

  const fallbackCreditRows = useMemo(() => {
    if (!typesenseDisabled) return [];
    const term = debouncedTerm.toLowerCase();
    const list = (creditNotes || []).filter(
      (n) =>
        !term ||
        n.creditNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        n.orderId.toLowerCase().includes(term)
    );
    const sorted = [...list];
    sorted.sort((a, b) => {
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
    return sorted;
  }, [typesenseDisabled, creditNotes, debouncedTerm, sortKey, sortDirection]);

  const fallbackDebitRows = useMemo(() => {
    if (!typesenseDisabled) return [];
    const term = debouncedTerm.toLowerCase();
    const list = (debitNotes || []).filter(
      (n) =>
        !term ||
        n.debitNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        (n.reason || '').toLowerCase().includes(term) ||
        (n.orderId || '').toLowerCase().includes(term)
    );
    const sorted = [...list];
    sorted.sort((a, b) => {
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
    return sorted;
  }, [typesenseDisabled, debitNotes, debouncedTerm, sortKey, sortDirection]);

  const isCredit = tab === 'credit';

  // Normalized rows + totals for the active tab.
  const rows: NoteRow[] = useMemo(() => {
    if (typesenseDisabled) {
      const src = isCredit ? fallbackCreditRows : fallbackDebitRows;
      return src.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE).map((n: any) => ({
        id: n.id,
        documentNumber: isCredit ? n.creditNoteNumber : n.debitNoteNumber,
        date: (isCredit ? n.creditNoteDate : n.debitNoteDate) instanceof Date
          ? (isCredit ? n.creditNoteDate : n.debitNoteDate)
          : new Date(isCredit ? n.creditNoteDate : n.debitNoteDate),
        retailer: n.retailerName || n.retailerEmail || n.retailerId,
        originalInvoiceNumber: n.originalInvoiceNumber || (isCredit ? '' : n.orderId) || '',
        reason: isCredit ? '' : n.reason || n.sourceType || '',
        totalAmount: n.totalAmount ?? 0,
      }));
    }
    if (isCredit) {
      return (creditSearch.data?.rows ?? []).map((n) => ({
        id: n.id,
        documentNumber: n.creditNoteNumber,
        date: new Date(n.creditNoteDate),
        retailer: n.retailerName || n.retailerEmail || n.retailerId,
        originalInvoiceNumber: n.originalInvoiceNumber || '',
        reason: '',
        totalAmount: n.totalAmount,
      }));
    }
    return (debitSearch.data?.rows ?? []).map((n) => ({
      id: n.id,
      documentNumber: n.debitNoteNumber,
      date: new Date(n.debitNoteDate),
      retailer: n.retailerName || n.retailerEmail || n.retailerId,
      originalInvoiceNumber: n.originalInvoiceNumber || n.orderId || '',
      reason: n.reason || n.sourceType || '',
      totalAmount: n.totalAmount,
    }));
  }, [typesenseDisabled, isCredit, fallbackCreditRows, fallbackDebitRows, page, creditSearch.data, debitSearch.data]);

  const activeTotal = typesenseDisabled
    ? (isCredit ? fallbackCreditRows.length : fallbackDebitRows.length)
    : (isCredit ? creditSearch.data?.found ?? 0 : debitSearch.data?.found ?? 0);
  const totalPages = Math.max(1, Math.ceil(activeTotal / ROWS_PER_PAGE));

  const creditCount = typesenseDisabled
    ? (creditNotes?.length ?? 0)
    : creditSearch.data?.totalAll ?? 0;
  const debitCount = typesenseDisabled
    ? (debitNotes?.length ?? 0)
    : debitSearch.data?.totalAll ?? 0;

  const isLoading = typesenseDisabled
    ? (isCredit ? creditLoading : debitLoading)
    : (isCredit ? creditSearch.isLoading : debitSearch.isLoading);
  const isBusy = !typesenseDisabled && (isCredit ? creditSearch.isFetching : debitSearch.isFetching);
  const loadError = typesenseDisabled ? (isCredit ? creditError : debitError) : null;

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      if (isCredit) {
        const note = await getCreditNoteById(id);
        if (note) await generateCreditNotePdf(note);
      } else {
        const note = await getDebitNoteById(id);
        if (note) await generateDebitNotePdf(note);
      }
    } catch (err) {
      console.error('Failed to generate note PDF', err);
      await alert('Failed to generate PDF', { severity: 'error' });
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

  const handleRefresh = () => {
    if (typesenseDisabled) {
      if (isCredit) refetchCreditAll();
      else refetchDebitAll();
    } else if (isCredit) {
      creditSearch.refetch();
    } else {
      debitSearch.refetch();
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const d = isCredit
        ? await reindexCreditNotesTypesense()
        : await reindexDebitNotesTypesense();
      await alert(
        `Search index updated: ${d.indexed ?? 0} documents indexed (${d.totalDocs ?? 0} Firestore docs scanned).`,
        { severity: 'success' }
      );
      handleRefresh();
    } catch (err) {
      await alert(
        `Search index rebuild failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { severity: 'error' }
      );
    } finally {
      setReindexing(false);
    }
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
      handleRefresh();
    } catch (err: unknown) {
      await alert(err instanceof Error ? err.message : 'Backfill failed', { severity: 'error' });
    }
  };

  const searchErrored = creditSearch.isError || debitSearch.isError;
  if (!typesenseDisabled && (searchErrored || (creditSearch.isLoading && debitSearch.isLoading))) {
    // Keep the loader up while we transition to the client-side fallback.
    return <Loading message="Loading credit & debit notes..." />;
  }
  if (typesenseDisabled && creditLoading && debitLoading) {
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
          {isCredit && (
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
            startIcon={<CloudSync />}
            variant="outlined"
            color="secondary"
            onClick={() => void handleReindex()}
            disabled={reindexing}
          >
            {reindexing ? 'Indexing…' : 'Rebuild search index'}
          </Button>
          <Button startIcon={<Refresh />} variant="outlined" onClick={handleRefresh}>
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
              <Chip label={creditCount} size="small" />
            </Box>
          }
        />
        <Tab
          value="debit"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Debit notes
              <Chip label={debitCount} size="small" />
            </Box>
          }
        />
      </Tabs>

      {isCredit ? (
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
          Failed to load {isCredit ? 'credit' : 'debit'} notes
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={
            isCredit
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
        <Loading message={`Loading ${isCredit ? 'credit' : 'debit'} notes...`} />
      ) : (
        <TableContainer component={Paper}>
          {isBusy && <LinearProgress />}
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortableTableHeadCell
                  columnId="documentNumber"
                  label={isCredit ? 'Credit note' : 'Debit note'}
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
                {!isCredit ? <TableCell>Reason</TableCell> : null}
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
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={!isCredit ? 7 : 6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {isCredit ? 'No credit notes yet' : 'No debit notes yet'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((note) => (
                  <TableRow key={note.id} hover>
                    <TableCell>{note.documentNumber}</TableCell>
                    <TableCell>{format(note.date, 'dd MMM yyyy')}</TableCell>
                    <TableCell>{note.retailer}</TableCell>
                    <TableCell>{note.originalInvoiceNumber || '—'}</TableCell>
                    {!isCredit ? <TableCell>{note.reason || '—'}</TableCell> : null}
                    <TableCell align="right">{formatAmount(note.totalAmount)}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        title={`Download ${isCredit ? 'credit' : 'debit'} note PDF`}
                        onClick={() => handleDownload(note.id)}
                        disabled={downloadingId === note.id}
                      >
                        <Download />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {activeTotal > ROWS_PER_PAGE && !isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
        </Box>
      ) : null}
    </Box>
  );
};

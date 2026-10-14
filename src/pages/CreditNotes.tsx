import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Chip,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import { Search, Download, Refresh, Build, CloudSync, Add, WhatsApp, Block } from '@mui/icons-material';
import { format } from 'date-fns';
import {
  useCreditNotes,
  useDebitNotes,
  useCreditNotesSearch,
  useDebitNotesSearch,
  useCreditNotesInDateRange,
  useDebitNotesInDateRange,
  useBackfillCreditNotes,
} from '../hooks/useCreditNotes';
import { getCreditNoteById } from '../services/creditNotes';
import { getDebitNoteById } from '../services/debitNotes';
import {
  reindexCreditNotesTypesense,
  reindexDebitNotesTypesense,
  searchAllCreditNoteIds,
  searchAllDebitNoteIds,
} from '../services/creditNoteSearch';
import { Loading } from '../components/Loading';
import { IstDateField } from '../components/IstDateField';
import { generateCreditNotePdf, generateCreditNotePdfBlob } from '../utils/creditNote';
import { generateDebitNotePdf, generateDebitNotePdfBlob } from '../utils/debitNote';
import { shareCreditNoteOnWhatsApp, shareDebitNoteOnWhatsApp } from '../utils/noteWhatsApp';
import {
  getDefaultNotesFilterRangeIST,
  getTodayDateStringIST,
  isDateInIstRange,
  isIstDateString,
  istDayEndExclusiveMs,
  istDayStartMs,
} from '../utils/dateTime';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';
import { CreateLedgerNoteDialog } from '../components/CreateLedgerNoteDialog';
import { voidLedgerNote } from '../services/ledgerNotes';
import { useInvalidateRetailerWallet } from '../hooks/useRetailerWallet';

type NoteTab = 'credit' | 'debit';

const ROWS_PER_PAGE = 10;
const MAX_BULK_NOTE_PDFS = 40;

const formatAmount = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalized row for the notes table (works for both credit and debit). */
interface NoteRow {
  id: string;
  documentNumber: string;
  date: Date;
  retailer: string;
  originalInvoiceNumber: string;
  reason: string;
  totalAmount: number;
  status?: string;
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
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [draftFromDateFilter, setDraftFromDateFilter] = useState('');
  const [draftToDateFilter, setDraftToDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [createLedgerOpen, setCreateLedgerOpen] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidedIds, setVoidedIds] = useState<Set<string>>(new Set());
  const backfillMutation = useBackfillCreditNotes();
  const { alert, confirm } = useAppDialog();
  const invalidateWallet = useInvalidateRetailerWallet();

  const { sortKey, sortDirection, requestSort } = useTableSort('documentDate', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fromFilterMs = fromDateFilter && isIstDateString(fromDateFilter)
    ? istDayStartMs(fromDateFilter)
    : null;
  const toFilterMs = toDateFilter && isIstDateString(toDateFilter)
    ? istDayEndExclusiveMs(toDateFilter)
    : null;
  const dateRangeInvalid = Boolean(
    fromDateFilter && toDateFilter && fromDateFilter > toDateFilter
  );
  const draftDateRangeInvalid = Boolean(
    draftFromDateFilter && draftToDateFilter && draftFromDateFilter > draftToDateFilter
  );
  const dateDraftDirty =
    draftFromDateFilter !== fromDateFilter || draftToDateFilter !== toDateFilter;
  const hasDateFilter = Boolean((fromDateFilter || toDateFilter) && !dateRangeInvalid);
  const useLocalList = typesenseDisabled || hasDateFilter;

  const applyDateRange = useCallback((from: string, to: string) => {
    setDraftFromDateFilter(from);
    setDraftToDateFilter(to);
    setFromDateFilter(from);
    setToDateFilter(to);
    setPage(1);
  }, []);

  const commitDraftDateRange = useCallback(() => {
    if (draftFromDateFilter === fromDateFilter && draftToDateFilter === toDateFilter) return;
    if (draftDateRangeInvalid) return;
    applyDateRange(draftFromDateFilter, draftToDateFilter);
  }, [
    applyDateRange,
    draftDateRangeInvalid,
    draftFromDateFilter,
    draftToDateFilter,
    fromDateFilter,
    toDateFilter,
  ]);

  const creditSearch = useCreditNotesSearch(
    {
      query: debouncedTerm,
      sortField: mapSortField(sortKey, true),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled && !hasDateFilter }
  );
  const debitSearch = useDebitNotesSearch(
    {
      query: debouncedTerm,
      sortField: mapSortField(sortKey, false),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled && !hasDateFilter }
  );

  useEffect(() => {
    if (creditSearch.isError || debitSearch.isError) setTypesenseDisabled(true);
  }, [creditSearch.isError, debitSearch.isError]);

  // Full-load client-side when Typesense is unavailable and no date window is set.
  const {
    data: creditNotes,
    isLoading: creditLoading,
    error: creditError,
    refetch: refetchCreditAll,
  } = useCreditNotes({ enabled: typesenseDisabled && !hasDateFilter });
  const {
    data: debitNotes,
    isLoading: debitLoading,
    error: debitError,
    refetch: refetchDebitAll,
  } = useDebitNotes({ enabled: typesenseDisabled && !hasDateFilter });

  const creditRange = useCreditNotesInDateRange(fromFilterMs, toFilterMs, {
    enabled: hasDateFilter,
  });
  const debitRange = useDebitNotesInDateRange(fromFilterMs, toFilterMs, {
    enabled: hasDateFilter,
  });

  const fallbackCreditRows = useMemo(() => {
    if (!useLocalList) return [];
    const term = debouncedTerm.toLowerCase();
    const source = hasDateFilter ? creditRange.data : creditNotes;
    const list = (source || []).filter((n) => {
      if (
        !isDateInIstRange(
          n.creditNoteDate ?? n.createdAt,
          fromDateFilter || undefined,
          toDateFilter || undefined
        )
      ) {
        return false;
      }
      return (
        !term ||
        n.creditNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        (n.orderId || '').toLowerCase().includes(term) ||
        (n.reason || '').toLowerCase().includes(term)
      );
    });
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
  }, [
    useLocalList,
    hasDateFilter,
    creditRange.data,
    creditNotes,
    debouncedTerm,
    fromDateFilter,
    toDateFilter,
    sortKey,
    sortDirection,
  ]);

  const fallbackDebitRows = useMemo(() => {
    if (!useLocalList) return [];
    const term = debouncedTerm.toLowerCase();
    const source = hasDateFilter ? debitRange.data : debitNotes;
    const list = (source || []).filter((n) => {
      if (
        !isDateInIstRange(
          n.debitNoteDate ?? n.createdAt,
          fromDateFilter || undefined,
          toDateFilter || undefined
        )
      ) {
        return false;
      }
      return (
        !term ||
        n.debitNoteNumber.toLowerCase().includes(term) ||
        (n.retailerName || '').toLowerCase().includes(term) ||
        (n.retailerEmail || '').toLowerCase().includes(term) ||
        (n.originalInvoiceNumber || '').toLowerCase().includes(term) ||
        (n.reason || '').toLowerCase().includes(term) ||
        (n.orderId || '').toLowerCase().includes(term)
      );
    });
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
  }, [
    useLocalList,
    hasDateFilter,
    debitRange.data,
    debitNotes,
    debouncedTerm,
    fromDateFilter,
    toDateFilter,
    sortKey,
    sortDirection,
  ]);

  const isCredit = tab === 'credit';

  // Normalized rows + totals for the active tab.
  const rows: NoteRow[] = useMemo(() => {
    if (useLocalList) {
      const src = isCredit ? fallbackCreditRows : fallbackDebitRows;
      return src.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE).map((n: any) => ({
        id: n.id,
        documentNumber: isCredit ? n.creditNoteNumber : n.debitNoteNumber,
        date: (isCredit ? n.creditNoteDate : n.debitNoteDate) instanceof Date
          ? (isCredit ? n.creditNoteDate : n.debitNoteDate)
          : new Date(isCredit ? n.creditNoteDate : n.debitNoteDate),
        retailer: n.retailerName || n.retailerEmail || n.retailerId,
        originalInvoiceNumber: n.originalInvoiceNumber || (isCredit ? '' : n.orderId) || '',
        reason: isCredit ? n.reason || (n.type === 'ledger_adjustment' ? 'Ledger adjustment' : '') : n.reason || n.sourceType || '',
        totalAmount: n.totalAmount ?? 0,
        status: n.status,
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
  }, [useLocalList, isCredit, fallbackCreditRows, fallbackDebitRows, page, creditSearch.data, debitSearch.data]);

  const activeTotal = useLocalList
    ? (isCredit ? fallbackCreditRows.length : fallbackDebitRows.length)
    : (isCredit ? creditSearch.data?.found ?? 0 : debitSearch.data?.found ?? 0);
  const totalPages = Math.max(1, Math.ceil(activeTotal / ROWS_PER_PAGE));

  const creditCount = typesenseDisabled
    ? (creditNotes?.length ?? creditRange.data?.length ?? 0)
    : creditSearch.data?.totalAll ?? creditRange.data?.length ?? 0;
  const debitCount = typesenseDisabled
    ? (debitNotes?.length ?? debitRange.data?.length ?? 0)
    : debitSearch.data?.totalAll ?? debitRange.data?.length ?? 0;

  const isLoading = useLocalList
    ? hasDateFilter
      ? (isCredit ? creditRange.isLoading : debitRange.isLoading)
      : (isCredit ? creditLoading : debitLoading)
    : (isCredit ? creditSearch.isLoading : debitSearch.isLoading);
  const isBusy =
    bulkDownloading ||
    (!useLocalList && (isCredit ? creditSearch.isFetching : debitSearch.isFetching)) ||
    (hasDateFilter && (isCredit ? creditRange.isFetching : debitRange.isFetching));
  const loadError = useLocalList
    ? hasDateFilter
      ? (isCredit ? creditRange.error : debitRange.error)
      : (isCredit ? creditError : debitError)
    : null;

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

  const handleDownloadMatching = async () => {
    if (bulkDownloading) return;
    setBulkDownloading(true);
    try {
      let ids: string[] = [];
      if (useLocalList) {
        ids = (isCredit ? fallbackCreditRows : fallbackDebitRows).map((n: { id: string }) => n.id);
      } else if (isCredit) {
        ids = await searchAllCreditNoteIds({
          query: debouncedTerm,
          sortField: mapSortField(sortKey, true),
          sortOrder: sortDirection,
        });
      } else {
        ids = await searchAllDebitNoteIds({
          query: debouncedTerm,
          sortField: mapSortField(sortKey, false),
          sortOrder: sortDirection,
        });
      }

      if (ids.length === 0) {
        await alert(`No ${isCredit ? 'credit' : 'debit'} notes match the current search.`, {
          severity: 'info',
        });
        return;
      }

      const limited = ids.length > MAX_BULK_NOTE_PDFS;
      const toDownload = limited ? ids.slice(0, MAX_BULK_NOTE_PDFS) : ids;
      const ok = await confirm(
        limited
          ? `${ids.length} notes match. Download the first ${MAX_BULK_NOTE_PDFS}?`
          : `Download ${toDownload.length} ${isCredit ? 'credit' : 'debit'} note PDF${
              toDownload.length === 1 ? '' : 's'
            } matching the current search?`,
        { title: 'Download matching notes', confirmLabel: 'Download' }
      );
      if (!ok) return;

      let okCount = 0;
      let failCount = 0;
      for (const id of toDownload) {
        try {
          if (isCredit) {
            const note = await getCreditNoteById(id);
            if (!note) {
              failCount += 1;
              continue;
            }
            const { blob, fileName } = await generateCreditNotePdfBlob(note);
            downloadBlob(blob, fileName);
          } else {
            const note = await getDebitNoteById(id);
            if (!note) {
              failCount += 1;
              continue;
            }
            const { blob, fileName } = await generateDebitNotePdfBlob(note);
            downloadBlob(blob, fileName);
          }
          okCount += 1;
          await delay(350);
        } catch (err) {
          console.error('Bulk note PDF failed', id, err);
          failCount += 1;
        }
      }

      await alert(
        failCount
          ? `Downloaded ${okCount} note${okCount === 1 ? '' : 's'}. ${failCount} failed.`
          : `Downloaded ${okCount} note PDF${okCount === 1 ? '' : 's'}.`,
        { severity: failCount ? 'warning' : 'success' }
      );
    } catch (err) {
      await alert(
        `Failed to download notes: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { severity: 'error' }
      );
    } finally {
      setBulkDownloading(false);
    }
  };

  const handleWhatsApp = async (id: string) => {
    setSharingId(id);
    try {
      if (isCredit) {
        const note = await getCreditNoteById(id);
        if (!note) {
          await alert('Credit note not found', { severity: 'error' });
          return;
        }
        const result = await shareCreditNoteOnWhatsApp(note);
        if (!result.opened) {
          await alert(
            'Credit note PDF link copied. This store has no phone number on file — paste into WhatsApp Web and share the link.',
            { severity: 'warning' }
          );
        }
      } else {
        const note = await getDebitNoteById(id);
        if (!note) {
          await alert('Debit note not found', { severity: 'error' });
          return;
        }
        const result = await shareDebitNoteOnWhatsApp(note);
        if (!result.opened) {
          await alert(
            'Debit note PDF link copied. This store has no phone number on file — paste into WhatsApp Web and share the link.',
            { severity: 'warning' }
          );
        }
      }
    } catch (err) {
      console.error('Failed to share note on WhatsApp', err);
      await alert(
        `Failed to share on WhatsApp: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { severity: 'error' }
      );
    } finally {
      setSharingId(null);
    }
  };

  const handleVoid = async (note: NoteRow) => {
    const ok = await confirm(
      `Void ${note.documentNumber}? This removes it from wallet and store ledger. The note is kept as cancelled, not deleted.`,
      { title: 'Void note', confirmLabel: 'Void', destructive: true }
    );
    if (!ok) return;
    setVoidingId(note.id);
    try {
      const result = await voidLedgerNote(isCredit ? 'credit' : 'debit', note.id);
      setVoidedIds((prev) => new Set(prev).add(note.id));
      invalidateWallet();
      handleRefresh();
      await alert(`${result.documentNumber} voided.`, { severity: 'success' });
    } catch (err) {
      await alert(err instanceof Error ? err.message : 'Failed to void note', { severity: 'error' });
    } finally {
      setVoidingId(null);
    }
  };

  const handleTabChange = (value: NoteTab) => {
    if (value === tab) return;
    setTab(value);
    setPage(1);
    setSearchTerm('');
    requestSort('documentDate');
  };

  const handleRefresh = () => {
    if (hasDateFilter) {
      if (isCredit) void creditRange.refetch();
      else void debitRange.refetch();
    } else if (typesenseDisabled) {
      if (isCredit) void refetchCreditAll();
      else void refetchDebitAll();
    } else if (isCredit) {
      void creditSearch.refetch();
    } else {
      void debitSearch.refetch();
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
  if (!useLocalList && (searchErrored || (creditSearch.isLoading && debitSearch.isLoading))) {
    // Keep the loader up while we transition to the client-side fallback.
    return <Loading message="Loading credit & debit notes..." />;
  }
  if (useLocalList && hasDateFilter && creditRange.isLoading && debitRange.isLoading) {
    return <Loading message="Loading credit & debit notes..." />;
  }
  if (useLocalList && !hasDateFilter && creditLoading && debitLoading) {
    return <Loading message="Loading credit & debit notes..." />;
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 0.5 }}>
          Credit & debit notes
        </Typography>
        <Chip
          size="small"
          label={`Credit ${creditCount}`}
          color="primary"
          variant={isCredit ? 'filled' : 'outlined'}
          onClick={() => handleTabChange('credit')}
          sx={{ fontWeight: isCredit ? 600 : 400 }}
        />
        <Chip
          size="small"
          label={`Debit ${debitCount}`}
          color="primary"
          variant={!isCredit ? 'filled' : 'outlined'}
          onClick={() => handleTabChange('debit')}
          sx={{ fontWeight: !isCredit ? 600 : 400 }}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          startIcon={<Add fontSize="small" />}
          variant="contained"
          onClick={() => setCreateLedgerOpen(true)}
        >
          {isCredit ? 'Create credit note' : 'Create debit note'}
        </Button>
        {isCredit && (
          <Tooltip title={backfillMutation.isPending ? 'Repairing…' : 'Repair batch/MRP on older notes'}>
            <span>
              <IconButton
                size="small"
                onClick={() => void handleBackfillOldCreditNotes()}
                disabled={backfillMutation.isPending}
                aria-label="Repair batch/MRP"
              >
                <Build fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={reindexing ? 'Indexing…' : 'Rebuild search index'}>
          <span>
            <IconButton
              size="small"
              color="secondary"
              onClick={() => void handleReindex()}
              disabled={reindexing}
              aria-label="Rebuild search index"
            >
              <CloudSync fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Refresh list">
          <span>
            <IconButton size="small" onClick={handleRefresh} aria-label="Refresh">
              <Refresh fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {loadError ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          Failed to load {isCredit ? 'credit' : 'debit'} notes
        </Alert>
      ) : null}

      <Paper sx={{ px: 1.5, py: 1, mb: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <TextField
            size="small"
            placeholder={
              isCredit
                ? 'Search note no., retailer, invoice, order…'
                : 'Search note no., retailer, invoice, reason…'
            }
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 200, flex: '1 1 180px' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <IstDateField
            label="From"
            value={draftFromDateFilter}
            onChange={setDraftFromDateFilter}
            sx={{ width: { xs: '100%', sm: 160 } }}
          />
          <IstDateField
            label="To"
            value={draftToDateFilter}
            onChange={setDraftToDateFilter}
            sx={{ width: { xs: '100%', sm: 160 } }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!dateDraftDirty || draftDateRangeInvalid}
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitDraftDateRange}
          >
            OK
          </Button>
          <Button
            size="small"
            variant="text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const range = getDefaultNotesFilterRangeIST();
              applyDateRange(range.fromDate, range.toDate);
            }}
          >
            7 days
          </Button>
          <Button
            size="small"
            variant="text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const today = getTodayDateStringIST();
              applyDateRange(today, today);
            }}
          >
            Today
          </Button>
          {(draftFromDateFilter || draftToDateFilter || fromDateFilter || toDateFilter) && (
            <Button
              size="small"
              variant="text"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyDateRange('', '')}
            >
              All dates
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download fontSize="small" />}
            disabled={bulkDownloading || isLoading || activeTotal === 0}
            onClick={() => void handleDownloadMatching()}
          >
            {bulkDownloading
              ? 'Downloading…'
              : `Download${activeTotal > 0 ? ` (${activeTotal})` : ''}`}
          </Button>
        </Box>
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
                <TableCell>Reason / source</TableCell>
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
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {debouncedTerm || hasDateFilter
                        ? `No ${isCredit ? 'credit' : 'debit'} notes match the current search`
                        : isCredit
                          ? 'No credit notes yet'
                          : 'No debit notes yet'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((note) => {
                  const cancelled =
                    voidedIds.has(note.id) || String(note.status || '').toLowerCase() === 'cancelled';
                  return (
                  <TableRow key={note.id} hover sx={cancelled ? { opacity: 0.6 } : undefined}>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        {note.documentNumber}
                        {cancelled ? <Chip size="small" label="Voided" color="default" /> : null}
                      </Box>
                    </TableCell>
                    <TableCell>{format(note.date, 'dd MMM yyyy')}</TableCell>
                    <TableCell>{note.retailer}</TableCell>
                    <TableCell>{note.originalInvoiceNumber || '—'}</TableCell>
                    <TableCell>{note.reason || '—'}</TableCell>
                    <TableCell align="right">{formatAmount(note.totalAmount)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={`Download ${isCredit ? 'credit' : 'debit'} note PDF`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => void handleDownload(note.id)}
                            disabled={
                              bulkDownloading ||
                              downloadingId === note.id ||
                              sharingId === note.id
                            }
                            aria-label={`Download ${isCredit ? 'credit' : 'debit'} note PDF`}
                          >
                            <Download />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Send on WhatsApp">
                        <span>
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => void handleWhatsApp(note.id)}
                            disabled={
                              bulkDownloading ||
                              downloadingId === note.id ||
                              sharingId === note.id
                            }
                            aria-label={`Send ${isCredit ? 'credit' : 'debit'} note on WhatsApp`}
                          >
                            <WhatsApp />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={cancelled ? 'Already voided' : 'Void this note'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => void handleVoid(note)}
                            disabled={cancelled || voidingId === note.id}
                            aria-label={`Void ${isCredit ? 'credit' : 'debit'} note`}
                          >
                            <Block />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                  );
                })
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

      <CreateLedgerNoteDialog
        open={createLedgerOpen}
        kind={tab}
        onClose={() => setCreateLedgerOpen(false)}
        onCreated={async ({ documentNumber }) => {
          invalidateWallet();
          handleRefresh();
          await alert(
            `${tab === 'credit' ? 'Credit' : 'Debit'} note ${documentNumber} created. It is reflected in the store ledger and retailer wallet.`,
            { severity: 'success' }
          );
        }}
      />
    </Box>
  );
};

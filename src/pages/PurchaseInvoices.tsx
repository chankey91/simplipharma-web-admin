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
  Button,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Tooltip,
  Pagination,
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  Search,
  Add,
  Visibility,
  Receipt,
  CloudSync,
  CameraAlt,
  Delete,
} from '@mui/icons-material';
import {
  usePurchaseInvoices,
  usePurchaseInvoicesSearch,
  usePurchaseInvoicesInDateRange,
  useVendorPurchaseInvoices,
  usePurchaseInvoiceAmountTotal,
  useDeletePurchaseInvoice,
} from '../hooks/usePurchaseInvoices';
import { useVendors } from '../hooks/useVendors';
import { IstDateField } from '../components/IstDateField';
import {
  getDefaultNotesFilterRangeIST,
  getTodayDateStringIST,
  isDateInIstRange,
  isIstDateString,
  istDayEndExclusiveMs,
  istDayStartMs,
} from '../utils/dateTime';
import { reindexPurchaseInvoicesTypesense } from '../services/purchaseInvoiceSearch';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import type { PaymentStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { useAppDialog } from '../context/AppDialogProvider';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_ROWS_PER_PAGE = 20;

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  vendorName: string;
  itemCount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus | '';
}

const sortKeyToField = (key: string): string => {
  switch (key) {
    case 'invoiceNumber':
      return 'invoiceNumber';
    case 'vendorName':
      return 'vendorName';
    case 'items':
      return 'itemCount';
    case 'totalAmount':
      return 'totalAmount';
    case 'paymentStatus':
      return 'paymentStatus';
    case 'invoiceDate':
    default:
      return 'invoiceDate';
  }
};

export const PurchaseInvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { canWrite, panelRole } = useAuth();
  const canEditPurchases = canWrite('purchases');
  const canReindexPurchases = panelRole === 'admin' || panelRole === 'operations';
  const { alert, confirm } = useAppDialog();
  const deleteInvoiceMutation = useDeletePurchaseInvoice();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [vendorId, setVendorId] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [draftFromDateFilter, setDraftFromDateFilter] = useState('');
  const [draftToDateFilter, setDraftToDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);

  const { sortKey, sortDirection, requestSort } = useTableSort('invoiceDate', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fromFilterMs =
    fromDateFilter && isIstDateString(fromDateFilter) ? istDayStartMs(fromDateFilter) : null;
  const toFilterMs =
    toDateFilter && isIstDateString(toDateFilter) ? istDayEndExclusiveMs(toDateFilter) : null;
  const dateRangeInvalid = Boolean(fromDateFilter && toDateFilter && fromDateFilter > toDateFilter);
  const draftDateRangeInvalid = Boolean(
    draftFromDateFilter && draftToDateFilter && draftFromDateFilter > draftToDateFilter
  );
  const dateDraftDirty =
    draftFromDateFilter !== fromDateFilter || draftToDateFilter !== toDateFilter;
  const hasDateFilter = Boolean((fromDateFilter || toDateFilter) && !dateRangeInvalid);
  const hasVendorFilter = Boolean(vendorId);
  const useLocalList = typesenseDisabled || hasDateFilter || hasVendorFilter;

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

  const { data: vendors } = useVendors();
  const vendorOptions = useMemo(
    () =>
      [...(vendors ?? [])]
        .filter((v) => v.isActive !== false)
        .sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
    [vendors]
  );

  const {
    data: searchData,
    isError: searchErrored,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = usePurchaseInvoicesSearch(
    {
      query: debouncedTerm,
      filter: statusFilter,
      sortField: sortKeyToField(sortKey),
      sortOrder: sortDirection,
      page,
      perPage: rowsPerPage,
    },
    { enabled: !typesenseDisabled && !useLocalList }
  );

  useEffect(() => {
    if (searchErrored) setTypesenseDisabled(true);
  }, [searchErrored]);

  // Total Purchases sum via Firestore aggregation (independent of Typesense).
  const { data: amountTotal } = usePurchaseInvoiceAmountTotal();

  const { data: invoices, isLoading: allLoading } = usePurchaseInvoices({
    enabled: typesenseDisabled && !hasDateFilter && !hasVendorFilter,
  });
  const invoiceRange = usePurchaseInvoicesInDateRange(fromFilterMs, toFilterMs, {
    enabled: hasDateFilter,
  });
  const vendorInvoices = useVendorPurchaseInvoices(vendorId, {
    enabled: hasVendorFilter && !hasDateFilter,
  });

  const fallbackSorted = useMemo(() => {
    if (!useLocalList) return [];
    const source = hasDateFilter
      ? invoiceRange.data
      : hasVendorFilter
        ? vendorInvoices.data
        : invoices;
    const term = debouncedTerm.toLowerCase();
    const filtered = (source ?? []).filter((invoice) => {
      if (hasVendorFilter && invoice.vendorId !== vendorId) return false;
      if (
        !isDateInIstRange(
          invoice.invoiceDate,
          fromDateFilter || undefined,
          toDateFilter || undefined
        )
      ) {
        return false;
      }
      const matchesSearch =
        !term ||
        invoice.invoiceNumber.toLowerCase().includes(term) ||
        invoice.vendorName.toLowerCase().includes(term) ||
        (invoice.vendorInvoiceNumber || '').toLowerCase().includes(term) ||
        invoice.items.some((item) => item.medicineName.toLowerCase().includes(term));
      const matchesStatus = statusFilter === 'All' || invoice.paymentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'invoiceNumber':
          cmp = compareAsc(a.invoiceNumber, b.invoiceNumber);
          break;
        case 'vendorName':
          cmp = compareAsc(a.vendorName, b.vendorName);
          break;
        case 'items':
          cmp = compareAsc(a.items.length, b.items.length);
          break;
        case 'totalAmount':
          cmp = compareAsc(a.totalAmount, b.totalAmount);
          break;
        case 'paymentStatus':
          cmp = compareAsc(a.paymentStatus, b.paymentStatus);
          break;
        case 'invoiceDate':
        default:
          cmp = compareAsc(toTimeMs(a.invoiceDate), toTimeMs(b.invoiceDate));
      }
      if (cmp !== 0) return applyDirection(cmp, sortDirection);
      return applyDirection(compareAsc(a.invoiceNumber, b.invoiceNumber), sortDirection);
    });
    return sorted;
  }, [
    useLocalList,
    hasDateFilter,
    hasVendorFilter,
    invoiceRange.data,
    vendorInvoices.data,
    invoices,
    vendorId,
    fromDateFilter,
    toDateFilter,
    debouncedTerm,
    statusFilter,
    sortKey,
    sortDirection,
  ]);

  const rows: InvoiceRow[] = useMemo(() => {
    if (useLocalList) {
      return fallbackSorted
        .slice((page - 1) * rowsPerPage, page * rowsPerPage)
        .map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate instanceof Date ? inv.invoiceDate : new Date(inv.invoiceDate),
          vendorName: inv.vendorName,
          itemCount: inv.items.length,
          totalAmount: inv.totalAmount,
          paymentStatus: inv.paymentStatus,
        }));
    }
    return (searchData?.rows ?? []).map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: new Date(r.invoiceDate),
      vendorName: r.vendorName,
      itemCount: r.itemCount,
      totalAmount: r.totalAmount,
      paymentStatus: r.paymentStatus,
    }));
  }, [useLocalList, fallbackSorted, page, rowsPerPage, searchData]);

  const totalCount = useLocalList ? fallbackSorted.length : searchData?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  const scopedForCounts = hasDateFilter
    ? invoiceRange.data
    : hasVendorFilter
      ? vendorInvoices.data
      : invoices;
  const totalInvoices = useLocalList
    ? (scopedForCounts?.length ?? 0)
    : searchData?.totalAll ?? 0;
  const paidInvoices = useLocalList
    ? (scopedForCounts ?? []).filter((i) => i.paymentStatus === 'Paid').length
    : searchData?.facetCounts?.['Paid'] ?? 0;
  const unpaidInvoices = useLocalList
    ? (scopedForCounts ?? []).filter((i) => i.paymentStatus === 'Unpaid').length
    : searchData?.facetCounts?.['Unpaid'] ?? 0;
  const totalPurchases = typesenseDisabled
    ? (invoices ?? []).reduce((sum, inv) => sum + inv.totalAmount, 0)
    : amountTotal ?? 0;

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const d = await reindexPurchaseInvoicesTypesense();
      setReindexMessage(
        `Search index updated: ${d.indexed ?? 0} documents indexed (${d.totalDocs ?? 0} Firestore docs scanned).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setReindexMessage(`Search index rebuild failed: ${msg}.`);
    } finally {
      setReindexing(false);
    }
  };

  const handleDeleteInvoice = async (invoice: InvoiceRow) => {
    const ok = await confirm(
      `Delete purchase bill #${invoice.invoiceNumber}? Stock added from this bill will be removed from inventory. Units already sold cannot be fully reverted. This cannot be undone.`,
      { destructive: true }
    );
    if (!ok) return;
    try {
      const result = await deleteInvoiceMutation.mutateAsync(invoice.id);
      if (result.stockSyncErrors.length > 0) {
        await alert(
          `Bill deleted. Some stock could not be fully reverted:\n${result.stockSyncErrors.slice(0, 5).join('\n')}`,
          { severity: 'warning' }
        );
      } else {
        await alert('Purchase bill deleted and stock reverted.', { severity: 'success' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete purchase bill';
      await alert(message, { severity: 'error' });
    }
  };

  const localLoading = hasDateFilter
    ? invoiceRange.isLoading
    : hasVendorFilter
      ? vendorInvoices.isLoading
      : allLoading;
  const initialLoading = useLocalList ? localLoading : searchLoading || searchErrored;
  if (initialLoading) return <Loading message="Loading purchase invoices..." />;

  const isBusy =
    (!useLocalList && searchFetching) ||
    (hasDateFilter && invoiceRange.isFetching) ||
    (hasVendorFilter && !hasDateFilter && vendorInvoices.isFetching);

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 0.5 }}>
          Purchase invoices
        </Typography>
        <Chip
          size="small"
          label={`Paid ${paidInvoices}`}
          color="success"
          variant={statusFilter === 'Paid' ? 'filled' : 'outlined'}
          onClick={() => {
            setStatusFilter(statusFilter === 'Paid' ? 'All' : 'Paid');
            setPage(1);
          }}
          sx={{ fontWeight: statusFilter === 'Paid' ? 600 : 400 }}
        />
        <Chip
          size="small"
          label={`Unpaid ${unpaidInvoices}`}
          color="warning"
          variant={statusFilter === 'Unpaid' ? 'filled' : 'outlined'}
          onClick={() => {
            setStatusFilter(statusFilter === 'Unpaid' ? 'All' : 'Unpaid');
            setPage(1);
          }}
          sx={{ fontWeight: statusFilter === 'Unpaid' ? 600 : 400 }}
        />
        <Typography variant="caption" color="text.secondary">
          {totalInvoices} total
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          ₹{Math.round(totalPurchases).toLocaleString('en-IN')}
        </Typography>
        {canReindexPurchases && (
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
        )}
        {canEditPurchases && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CameraAlt fontSize="small" />}
              onClick={() => navigate('/purchases/ingest')}
            >
              Ingest
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<Add fontSize="small" />}
              onClick={() => navigate('/purchases/new')}
            >
              Add invoice
            </Button>
          </>
        )}
      </Box>

      {reindexMessage && (
        <Alert
          severity={reindexMessage.startsWith('Search index updated') ? 'success' : 'error'}
          onClose={() => setReindexMessage(null)}
          sx={{ mb: 1 }}
        >
          {reindexMessage}
        </Alert>
      )}

      <Paper sx={{ px: 1.5, py: 1, mb: 1.5 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search invoice, vendor…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 220, flex: '1 1 220px' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Vendor</InputLabel>
            <Select
              value={vendorId}
              label="Vendor"
              onChange={(e) => {
                setVendorId(e.target.value);
                setPage(1);
              }}
              MenuProps={{ PaperProps: { style: { maxHeight: 360 } } }}
            >
              <MenuItem value="">All vendors</MenuItem>
              {vendorOptions.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.vendorName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Payment</InputLabel>
            <Select
              value={statusFilter}
              label="Payment"
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="All">All status</MenuItem>
              <MenuItem value="Paid">Paid</MenuItem>
              <MenuItem value="Unpaid">Unpaid</MenuItem>
              <MenuItem value="Partial">Partial</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        {isBusy && <LinearProgress />}
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableTableHeadCell columnId="invoiceNumber" label="Invoice Number" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="invoiceDate" label="Date" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="vendorName" label="Vendor" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="totalAmount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="paymentStatus" label="Payment Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>
                    {debouncedTerm || hasDateFilter || hasVendorFilter || statusFilter !== 'All'
                      ? 'No invoices match the current search'
                      : 'No invoices found'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((invoice) => (
                <TableRow key={invoice.id} hover onClick={() => navigate(`/purchases/${invoice.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">{invoice.invoiceNumber}</Typography>
                  </TableCell>
                  <TableCell>{format(invoice.invoiceDate, 'MMM dd, yyyy')}</TableCell>
                  <TableCell>{invoice.vendorName}</TableCell>
                  <TableCell>{invoice.itemCount} items</TableCell>
                  <TableCell align="right">₹{invoice.totalAmount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      label={invoice.paymentStatus}
                      size="small"
                      color={
                        invoice.paymentStatus === 'Paid' ? 'success' :
                        invoice.paymentStatus === 'Partial' ? 'warning' : 'error'
                      }
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" color="primary" onClick={() => navigate(`/purchases/${invoice.id}`)}>
                      <Visibility />
                    </IconButton>
                    <IconButton size="small" onClick={() => {/* Print invoice */}}>
                      <Receipt />
                    </IconButton>
                    {canEditPurchases && (
                      <IconButton
                        size="small"
                        color="error"
                        disabled={deleteInvoiceMutation.isPending}
                        onClick={() => void handleDeleteInvoice(invoice)}
                        title="Delete bill"
                        aria-label="Delete bill"
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {totalCount > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2} flexWrap="wrap" gap={2}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="purchases-rows-per-page-label">Per page</InputLabel>
            <Select
              labelId="purchases-rows-per-page-label"
              label="Per page"
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Pagination
            count={totalPages}
            page={Math.min(page, totalPages)}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" color="text.secondary">
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, totalCount)} of {totalCount} invoices
          </Typography>
        </Box>
      )}
    </Box>
  );
};

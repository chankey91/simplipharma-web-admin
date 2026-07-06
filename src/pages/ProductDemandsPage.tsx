import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom';
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
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  Alert,
  Link as MuiLink,
  ToggleButtonGroup,
  ToggleButton,
  InputAdornment,
  Pagination,
  LinearProgress,
} from '@mui/material';
import { format } from 'date-fns';
import { getTodayDateStringIST } from '../utils/dateTime';
import * as XLSX from 'xlsx';
import { CloudSync, FileDownload, PostAdd, Search } from '@mui/icons-material';
import {
  useProductDemandsSearch,
  useProductDemandsPage,
  useProductDemand,
  useProductDemandDetailsByIds,
  useFulfillProductDemand,
  useRejectProductDemand,
  useMigrateProductDemandsToMedicines,
} from '../hooks/useProductDemands';
import { getProductDemandsByIds, getProductDemandsPage } from '../services/productDemands';
import { reindexProductDemandsTypesense, searchProductDemandsTypesense } from '../services/productDemandSearch';
import { useMedicines } from '../hooks/useInventory';
import { ProductDemand, Medicine } from '../types';
import { Loading } from '../components/Loading';
import { ProductDemandImage } from '../components/ProductDemandImage';
import { Breadcrumbs } from '../components/Breadcrumbs';
import {
  searchMedicinesTypesenseAdmin,
  resolveMedicineAfterPickerSelection,
  refineMedicineSearchResults,
} from '../services/medicineSearch';
import { MEDICINE_SEARCH_DEBOUNCE_MS } from '../constants/medicineSearchDebounce';
import { getMedicinePickerLabel } from '../utils/medicinePickerLabel';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { useAppDialog } from '../context/AppDialogProvider';

type Filter = 'pending' | 'all';

const ROWS_PER_PAGE = 15;

const sortKeyToField = (key: string): string => {
  switch (key) {
    case 'productName':
      return 'productName';
    case 'manufacturerName':
      return 'manufacturerName';
    case 'requestedQuantity':
      return 'requestedQuantity';
    case 'retailer':
      return 'retailerSort';
    case 'status':
      return 'status';
    case 'createdAt':
    default:
      return 'createdAt';
  }
};

function rowToMinimalDemand(row: {
  id: string;
  productName: string;
  manufacturerName: string;
  retailerName: string;
  retailerEmail: string;
  requestedQuantity: number;
  requestedUnit: string;
  status: ProductDemand['status'];
  createdAt: number;
}): ProductDemand {
  return {
    id: row.id,
    retailerId: '',
    productName: row.productName,
    manufacturerName: row.manufacturerName,
    requestedQuantity: row.requestedQuantity,
    requestedUnit: row.requestedUnit,
    status: row.status,
    retailerName: row.retailerName,
    retailerEmail: row.retailerEmail,
    createdAt: new Date(row.createdAt),
  };
}

function isSafeOrderReturnPath(path: string | null): path is string {
  return Boolean(path && path.startsWith('/orders/') && !path.includes('//'));
}

function navigateToReturnPath(navigate: NavigateFunction, returnToRef: React.MutableRefObject<string | null>) {
  const path = returnToRef.current;
  returnToRef.current = null;
  if (isSafeOrderReturnPath(path)) {
    navigate(path);
  }
}

export const ProductDemandsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: medicines } = useMedicines();
  const fulfillMutation = useFulfillProductDemand();
  const rejectMutation = useRejectProductDemand();
  const migrateMutation = useMigrateProductDemandsToMedicines();
  const { alert, confirm } = useAppDialog();

  const [filter, setFilter] = useState<Filter>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [page, setPage] = useState(1);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<ProductDemand | null>(null);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [fulfillNote, setFulfillNote] = useState('');
  const [purchaseInvoiceId, setPurchaseInvoiceId] = useState('');
  const [cartQty, setCartQty] = useState('1');
  const [rejectReason, setRejectReason] = useState('');

  const [fulfillMedicineSearchInput, setFulfillMedicineSearchInput] = useState('');
  const [fulfillMedicineSearchHits, setFulfillMedicineSearchHits] = useState<Medicine[]>([]);
  const [fulfillMedicineSearchLoading, setFulfillMedicineSearchLoading] = useState(false);
  const fulfillMedicineSearchSeq = useRef(0);
  const fulfillMedicineSearchInputRef = useRef(fulfillMedicineSearchInput);
  fulfillMedicineSearchInputRef.current = fulfillMedicineSearchInput;

  const { sortKey, sortDirection, requestSort } = useTableSort('createdAt', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const demandSearch = useProductDemandsSearch(
    {
      query: debouncedTerm,
      filter: filter === 'pending' ? 'pending' : 'All',
      sortField: sortKeyToField(sortKey),
      sortOrder: sortDirection,
      page,
      perPage: ROWS_PER_PAGE,
    },
    { enabled: !typesenseDisabled }
  );

  const fallbackSearchActive = typesenseDisabled && debouncedTerm.length > 0;
  const fallbackPage = useProductDemandsPage(
    {
      status: filter === 'pending' ? 'pending' : 'all',
      page: fallbackSearchActive ? 1 : page,
      perPage: fallbackSearchActive ? 250 : ROWS_PER_PAGE,
    },
    { enabled: typesenseDisabled }
  );

  useEffect(() => {
    if (demandSearch.isError) setTypesenseDisabled(true);
  }, [demandSearch.isError]);

  const pageIds = useMemo(() => {
    if (typesenseDisabled) return [];
    return (demandSearch.data?.rows ?? []).map((r) => r.id);
  }, [typesenseDisabled, demandSearch.data?.rows]);

  const { data: detailsMap } = useProductDemandDetailsByIds(pageIds);

  const fallbackFiltered = useMemo(() => {
    if (!typesenseDisabled || !fallbackSearchActive) return [];
    const term = debouncedTerm.toLowerCase();
    let list = fallbackPage.data?.rows ?? [];
    if (term) {
      list = list.filter(
        (d) =>
          d.productName.toLowerCase().includes(term) ||
          d.manufacturerName.toLowerCase().includes(term) ||
          (d.retailerName || '').toLowerCase().includes(term) ||
          (d.retailerEmail || '').toLowerCase().includes(term)
      );
    }
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'productName':
          return applyDirection(compareAsc(a.productName, b.productName), sortDirection);
        case 'manufacturerName':
          return applyDirection(compareAsc(a.manufacturerName, b.manufacturerName), sortDirection);
        case 'requestedQuantity':
          return applyDirection(compareAsc(a.requestedQuantity, b.requestedQuantity), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc(
              `${a.retailerName || ''} ${a.retailerEmail || ''}`.toLowerCase(),
              `${b.retailerName || ''} ${b.retailerEmail || ''}`.toLowerCase()
            ),
            sortDirection
          );
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'createdAt':
        default:
          return applyDirection(compareAsc(toTimeMs(a.createdAt), toTimeMs(b.createdAt)), sortDirection);
      }
    });
    return list;
  }, [typesenseDisabled, fallbackSearchActive, fallbackPage.data?.rows, debouncedTerm, sortKey, sortDirection]);

  const sortedDemands: ProductDemand[] = useMemo(() => {
    if (typesenseDisabled) {
      if (fallbackSearchActive) {
        return fallbackFiltered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
      }
      return fallbackPage.data?.rows ?? [];
    }
    return (demandSearch.data?.rows ?? []).map((row) => {
      const full = detailsMap?.get(row.id);
      return full ?? rowToMinimalDemand(row);
    });
  }, [
    typesenseDisabled,
    fallbackSearchActive,
    fallbackFiltered,
    page,
    fallbackPage.data?.rows,
    demandSearch.data?.rows,
    detailsMap,
  ]);

  const totalCount = typesenseDisabled
    ? fallbackSearchActive
      ? fallbackFiltered.length
      : fallbackPage.data?.total ?? 0
    : demandSearch.data?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));

  const pendingCount = typesenseDisabled
    ? (fallbackPage.data?.rows ?? []).filter((d) => d.status === 'pending').length
    : demandSearch.data?.facetCounts?.pending ?? 0;

  const demandIdFromUrl = searchParams.get('demandId');
  const { data: deepLinkDemand, isLoading: deepLinkLoading } = useProductDemand(demandIdFromUrl || '');

  useEffect(() => {
    if (!fulfillOpen) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchInput('');
      setFulfillMedicineSearchHits([]);
      setFulfillMedicineSearchLoading(false);
      setSelectedMedicine(null);
    }
  }, [fulfillOpen]);

  useEffect(() => {
    if (!fulfillOpen) return;

    const trimmed = fulfillMedicineSearchInput.trim();
    if (trimmed.length < 2) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchHits([]);
      setFulfillMedicineSearchLoading(false);
      return;
    }
    if (
      selectedMedicine &&
      trimmed === getMedicinePickerLabel(selectedMedicine).trim()
    ) {
      fulfillMedicineSearchSeq.current += 1;
      setFulfillMedicineSearchLoading(false);
      return;
    }
    const seq = ++fulfillMedicineSearchSeq.current;
    setFulfillMedicineSearchHits([]);
    setFulfillMedicineSearchLoading(true);
    const t = setTimeout(() => {
      searchMedicinesTypesenseAdmin(trimmed, { hydrate: false, limit: 40, strict: true })
        .then((rows) => {
          if (fulfillMedicineSearchSeq.current !== seq) return;
          if (fulfillMedicineSearchInputRef.current.trim() !== trimmed) return;
          setFulfillMedicineSearchHits(rows);
        })
        .finally(() => {
          if (fulfillMedicineSearchSeq.current === seq) {
            setFulfillMedicineSearchLoading(false);
          }
        });
    }, MEDICINE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fulfillOpen, fulfillMedicineSearchInput, selectedMedicine]);

  const fulfillMasterMedicineOptions = useMemo(() => {
    const q = fulfillMedicineSearchInput.trim();
    const all = medicines || [];

    if (
      selectedMedicine &&
      q === getMedicinePickerLabel(selectedMedicine).trim()
    ) {
      return [selectedMedicine];
    }

    if (q.length >= 2) {
      let list = refineMedicineSearchResults(fulfillMedicineSearchHits, q, all);
      if (selectedMedicine && !list.some((m) => m.id === selectedMedicine.id)) {
        return [selectedMedicine, ...list];
      }
      return list;
    }

    if (selectedMedicine && !all.some((m) => m.id === selectedMedicine.id)) {
      return [selectedMedicine];
    }
    return [];
  }, [fulfillMedicineSearchInput, fulfillMedicineSearchHits, medicines, selectedMedicine]);

  const openFulfill = useCallback((d: ProductDemand) => {
    setSelectedDemand(d);
    setSelectedMedicine(null);
    setFulfillMedicineSearchInput('');
    setFulfillMedicineSearchHits([]);
    fulfillMedicineSearchSeq.current += 1;
    setFulfillNote('');
    setPurchaseInvoiceId('');
    const q = d.requestedQuantity;
    const n = typeof q === 'number' && !isNaN(q) && q >= 1 ? Math.floor(q) : 1;
    setCartQty(String(n));
    setFulfillOpen(true);
  }, []);

  const consumedDemandQueryIdRef = useRef<string | null>(null);
  const returnToRef = useRef<string | null>(null);

  useEffect(() => {
    const id = searchParams.get('demandId');
    if (!id) {
      consumedDemandQueryIdRef.current = null;
      return;
    }
    if (deepLinkLoading) return;
    if (consumedDemandQueryIdRef.current === id) return;
    consumedDemandQueryIdRef.current = id;

    const returnTo = searchParams.get('returnTo');
    if (isSafeOrderReturnPath(returnTo)) {
      returnToRef.current = returnTo;
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('demandId');
        next.delete('returnTo');
        return next;
      },
      { replace: true }
    );

    const d = deepLinkDemand;
    if (d?.status === 'pending') {
      setFilter('pending');
      openFulfill(d);
    } else if (returnToRef.current) {
      navigateToReturnPath(navigate, returnToRef);
    }
  }, [deepLinkLoading, deepLinkDemand, searchParams, setSearchParams, openFulfill, navigate]);

  const openReject = (d: ProductDemand) => {
    setSelectedDemand(d);
    setRejectReason('');
    setRejectOpen(true);
  };

  const closeFulfillDialog = useCallback(
    (options?: { navigateBack?: boolean }) => {
      setFulfillOpen(false);
      setSelectedDemand(null);
      setSelectedMedicine(null);
      if (options?.navigateBack) {
        navigateToReturnPath(navigate, returnToRef);
      }
    },
    [navigate]
  );

  const handleFulfill = async () => {
    if (!selectedDemand) return;
    const q = parseInt(cartQty, 10);
    try {
      const result = await fulfillMutation.mutateAsync({
        demandId: selectedDemand.id,
        medicineId: selectedMedicine?.id,
        quantity: !isNaN(q) && q > 0 ? q : 1,
        fulfillmentNote: fulfillNote,
        purchaseInvoiceId: purchaseInvoiceId,
      });
      if (result.medicineCreated) {
        await alert(
          `Added "${selectedDemand.productName}" to the medicine catalog (medicines collection) and fulfilled the demand.`,
          { severity: 'success', title: 'Catalog item created' }
        );
      } else if (!selectedMedicine) {
        await alert(
          `Linked to existing catalog medicine and fulfilled the demand.`,
          { severity: 'success' }
        );
      }
      closeFulfillDialog({ navigateBack: true });
    } catch (e: any) {
      await alert(e?.message || 'Failed to fulfill', { severity: 'error' });
    }
  };

  const downloadDemandsExcel = async () => {
    let exportRows: ProductDemand[] = sortedDemands;
    try {
      if (!typesenseDisabled) {
        const res = await searchProductDemandsTypesense({
          query: debouncedTerm,
          filter: filter === 'pending' ? 'pending' : 'All',
          sortField: sortKeyToField(sortKey),
          sortOrder: sortDirection,
          page: 1,
          perPage: 500,
        });
        const map = await getProductDemandsByIds(res.rows.map((r) => r.id));
        exportRows = res.rows
          .map((r) => map.get(r.id) ?? rowToMinimalDemand(r))
          .filter(Boolean) as ProductDemand[];
      } else if (!fallbackSearchActive) {
        const res = await getProductDemandsPage({
          status: filter === 'pending' ? 'pending' : 'all',
          page: 1,
          perPage: 500,
        });
        exportRows = res.rows;
      } else {
        exportRows = fallbackFiltered;
      }
    } catch {
      /* use current page rows */
    }

    if (exportRows.length === 0) {
      await alert('No demands in this view to export', { severity: 'warning' });
      return;
    }
    const rows = exportRows.map((d) => ({
      'Requested product': d.productName,
      Manufacturer: d.manufacturerName,
      Quantity: d.requestedQuantity,
      Unit: d.requestedUnit,
      Notes: d.notes ?? '',
      Retailer: d.retailerName ?? '',
      'Retailer email': d.retailerEmail ?? '',
      'Retailer id': d.retailerId,
      Status: d.status,
      'Created at': d.createdAt
        ? format(
            d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt as string | number),
            'yyyy-MM-dd HH:mm'
          )
        : '',
      'Fulfilled as': d.fulfilledMedicineName ?? '',
      'Fulfillment note': d.fulfillmentNote ?? '',
      'Purchase invoice ref': d.purchaseInvoiceId ?? '',
      'Rejection reason': d.rejectionReason ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Product demands');
    const stamp = getTodayDateStringIST();
    XLSX.writeFile(wb, `product-demands-${stamp}.xlsx`);
  };

  const handleMigrateToCatalog = async () => {
    const fulfilledCount = typesenseDisabled
      ? undefined
      : demandSearch.data?.facetCounts?.fulfilled ?? 0;
    if (!typesenseDisabled && fulfilledCount === 0) {
      await alert('No fulfilled demands to migrate. Fulfill demands first, or use Fulfill on each row.', {
        severity: 'info',
      });
      return;
    }
    const ok = await confirm(
      `Sync fulfilled demand(s) into the medicines catalog?\n\n` +
        `• Creates missing medicines documents (matched by product name)\n` +
        `• Updates fulfilledMedicineId on product_demands\n` +
        `• Repairs order lines still marked as product requests\n\n` +
        `product_demands records are kept for history.`,
      {
        title: 'Sync demands → medicines',
        confirmLabel: 'Run migration',
        cancelLabel: 'Cancel',
      }
    );
    if (!ok) return;

    try {
      const result = await migrateMutation.mutateAsync({
        includePending: false,
        repairOrders: true,
      });
      await alert(
        `Migration finished.\n\n` +
          `Processed: ${result.processed}\n` +
          `Created in medicines: ${result.created}\n` +
          `Linked to existing: ${result.linkedExisting}\n` +
          `Demands updated: ${result.demandsUpdated}\n` +
          `Orders repaired: ${result.ordersRepaired}\n` +
          `Skipped: ${result.skipped}` +
          (result.errors.length ? `\n\nErrors:\n${result.errors.slice(0, 8).join('\n')}` : ''),
        { severity: result.errors.length ? 'warning' : 'success', title: 'Migration complete' }
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Migration failed';
      await alert(msg, { severity: 'error' });
    }
  };

  const handleReject = async () => {
    if (!selectedDemand || !rejectReason.trim()) {
      await alert('Enter a rejection reason', { severity: 'warning' });
      return;
    }
    try {
      await rejectMutation.mutateAsync({ demandId: selectedDemand.id, reason: rejectReason.trim() });
      setRejectOpen(false);
      setSelectedDemand(null);
    } catch (e: any) {
      await alert(e?.message || 'Failed to reject', { severity: 'error' });
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const d = await reindexProductDemandsTypesense();
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

  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const initialLoading = typesenseDisabled ? fallbackPage.isLoading : demandSearch.isLoading;
  if (initialLoading) return <Loading message="Loading product demands..." />;

  const isBusy = !typesenseDisabled && demandSearch.isFetching;

  return (
    <Box>
      <Breadcrumbs items={[{ label: 'Product demands' }]} />
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h4" display="flex" alignItems="center" gap={1}>
          <PostAdd color="primary" />
          Product demands
        </Typography>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            startIcon={<CloudSync />}
            onClick={() => void handleReindex()}
            disabled={reindexing}
          >
            {reindexing ? 'Indexing…' : 'Rebuild search index'}
          </Button>
          <ToggleButtonGroup
            value={filter}
            exclusive
            onChange={(_, v) => {
              if (v) {
                setFilter(v);
                setPage(1);
              }
            }}
            size="small"
          >
            <ToggleButton value="pending">Pending ({pendingCount})</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="outlined"
            size="small"
            onClick={() => void handleMigrateToCatalog()}
            disabled={migrateMutation.isPending}
          >
            {migrateMutation.isPending ? 'Migrating…' : 'Sync to medicines catalog'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownload />}
            onClick={() => void downloadDemandsExcel()}
            disabled={sortedDemands.length === 0}
          >
            Download Excel
          </Button>
        </Box>
      </Box>

      {reindexMessage && (
        <Alert
          severity={reindexMessage.startsWith('Search index updated') ? 'success' : 'error'}
          onClose={() => setReindexMessage(null)}
          sx={{ mb: 2 }}
        >
          {reindexMessage}
        </Alert>
      )}

      <TextField
        fullWidth
        size="small"
        placeholder="Search product, manufacturer, retailer…"
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setPage(1);
        }}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search />
            </InputAdornment>
          ),
        }}
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        Fulfill creates or links a row in the <strong>medicines</strong> catalog (matched by product name if it
        already exists), updates <strong>product_demands</strong> to fulfilled, and promotes any linked order
        line. Optionally pick an existing medicine below, or leave blank to auto-add from the request. Record
        stock via{' '}
        <MuiLink component="button" type="button" onClick={() => navigate('/purchases/new')}>
          New purchase invoice
        </MuiLink>{' '}
        when stock arrives.
      </Alert>

      <TableContainer component={Paper}>
        {isBusy && <LinearProgress />}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Photo</TableCell>
              <SortableTableHeadCell columnId="productName" label="Requested product" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="manufacturerName" label="Manufacturer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="requestedQuantity" label="Qty" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} align="right" />
              <SortableTableHeadCell columnId="retailer" label="Retailer" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="createdAt" label="Created" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedDemands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No demands in this view.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedDemands.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <ProductDemandImage
                      imageUrl={row.imageUrl}
                      alt={row.productName}
                      showPlaceholder
                    />
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={600}>{row.productName}</Typography>
                    {row.notes ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.notes}
                      </Typography>
                    ) : null}
                    {row.fulfilledMedicineName ? (
                      <Typography variant="caption" color="success.main" display="block">
                        Fulfilled as: {row.fulfilledMedicineName}
                      </Typography>
                    ) : null}
                    {row.rejectionReason ? (
                      <Typography variant="caption" color="error" display="block">
                        Rejected: {row.rejectionReason}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.manufacturerName}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {row.requestedQuantity}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {row.requestedUnit}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.retailerName || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.retailerEmail || row.retailerId}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.status}
                      color={
                        row.status === 'fulfilled'
                          ? 'success'
                          : row.status === 'rejected'
                            ? 'default'
                            : 'warning'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {row.createdAt
                      ? format(
                          row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
                          'dd MMM yyyy HH:mm'
                        )
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {row.status === 'pending' ? (
                      <>
                        <Button size="small" variant="contained" color="success" onClick={() => openFulfill(row)} sx={{ mr: 1 }}>
                          Fulfill
                        </Button>
                        <Button size="small" color="error" onClick={() => openReject(row)}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {row.fulfillmentNote || row.purchaseInvoiceId || '—'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalCount > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
            showFirstButton
            showLastButton
          />
          <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
            Showing {(page - 1) * ROWS_PER_PAGE + 1} to{' '}
            {Math.min(page * ROWS_PER_PAGE, totalCount)} of {totalCount} demands
          </Typography>
        </Box>
      )}

      <Dialog
        open={fulfillOpen}
        onClose={() => closeFulfillDialog({ navigateBack: true })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Fulfill demand</DialogTitle>
        <DialogContent>
          {selectedDemand?.imageUrl?.trim() ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                Product photo from retailer
              </Typography>
              <ProductDemandImage
                imageUrl={selectedDemand.imageUrl}
                alt={selectedDemand.productName}
                size={140}
              />
            </Box>
          ) : null}
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Requested: <strong>{selectedDemand?.productName}</strong> — {selectedDemand?.manufacturerName}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Retailer needs:{' '}
            <strong>
              {selectedDemand?.requestedQuantity} {selectedDemand?.requestedUnit}
            </strong>{' '}
            (cart quantity below defaults to this; adjust if needed)
          </Typography>
          <Autocomplete
            sx={{ mt: 2 }}
            loading={fulfillMedicineSearchLoading}
            options={fulfillMasterMedicineOptions}
            getOptionLabel={getMedicinePickerLabel}
            value={selectedMedicine}
            inputValue={fulfillMedicineSearchInput}
            onInputChange={(_, newInputValue, reason) => {
              if (reason === 'clear') {
                setFulfillMedicineSearchInput('');
                setSelectedMedicine(null);
                return;
              }
              if (reason === 'input') {
                setFulfillMedicineSearchInput(newInputValue);
                if (
                  selectedMedicine &&
                  newInputValue !== getMedicinePickerLabel(selectedMedicine)
                ) {
                  setSelectedMedicine(null);
                }
                return;
              }
              setFulfillMedicineSearchInput(newInputValue);
            }}
            onChange={(_, newValue) => {
              setFulfillMedicineSearchHits([]);
              if (!newValue) {
                setSelectedMedicine(null);
                setFulfillMedicineSearchInput('');
                return;
              }
              void resolveMedicineAfterPickerSelection(newValue, medicines ?? undefined).then((merged) => {
                setSelectedMedicine(merged);
                setFulfillMedicineSearchInput(getMedicinePickerLabel(merged));
              });
            }}
            filterOptions={(options) => options}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Link existing medicine (optional)"
                placeholder="Leave empty to add to catalog from request, or search to link existing…"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            )}
          />
          <TextField
            fullWidth
            label="Quantity to add to retailer cart"
            type="number"
            value={cartQty}
            onChange={(e) => setCartQty(e.target.value)}
            sx={{ mt: 2 }}
            inputProps={{ min: 1 }}
          />
          <TextField
            fullWidth
            label="Fulfillment note (internal)"
            value={fulfillNote}
            onChange={(e) => setFulfillNote(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="e.g. Added via supplier X"
          />
          <TextField
            fullWidth
            label="Purchase invoice reference"
            value={purchaseInvoiceId}
            onChange={(e) => setPurchaseInvoiceId(e.target.value)}
            sx={{ mt: 2 }}
            helperText="Paste PI Firestore document id or invoice number (required for correct order pricing)"
            placeholder="e.g. nqIHWIEr9kl9PyKQBK1Z"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeFulfillDialog({ navigateBack: true })}>Cancel</Button>
          <Button variant="contained" onClick={handleFulfill} disabled={fulfillMutation.isPending}>
            Fulfill & notify retailer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject demand</DialogTitle>
        <DialogContent>
          {selectedDemand?.imageUrl ? (
            <Box sx={{ mt: 1, mb: 1 }}>
              <ProductDemandImage imageUrl={selectedDemand.imageUrl} alt={selectedDemand.productName} size={80} />
            </Box>
          ) : null}
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={rejectMutation.isPending}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

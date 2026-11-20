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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Pagination,
  LinearProgress,
  Alert,
  Checkbox,
  FormControlLabel,
  Toolbar,
  Link,
  Tooltip,
} from '@mui/material';
import {
  Search,
  Visibility,
  Cancel,
  Download,
  CloudSync,
  Publish,
  LocalShipping,
  CheckCircle,
  MergeType,
  OpenInNew,
  Refresh,
  Undo,
} from '@mui/icons-material';
import {
  useOrders,
  useOrdersSearch,
  useCancelOrder,
  useMergePendingOrders,
  invalidateOrderListQueries,
} from '../hooks/useOrders';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStores } from '../hooks/useStores';
import { getOrdersInRange, getOrderById, updateOrderDispatch, markOrderDelivered, unfulfillOrder, mergePendingOrdersBefore, markOrdersPickedUp } from '../services/orders';
import { generateOrderInvoice } from '../utils/invoice';
import {
  extractOrderShortfallsFromOrders,
  exportOrderShortfallsToExcel,
} from '../utils/orderShortfalls';
import { Order, OrderStatus, User } from '../types';
import { format } from 'date-fns';
import { auth } from '../services/firebase';
import { Loading } from '../components/Loading';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { exportPendingOrdersByStore, exportPendingOrdersProductSummary, exportSelectedOrderStores, formatTownDistrict } from '../utils/export';
import { ORDER_CANCEL_REASONS } from '../constants/orderCancelReasons';
import { isAwaitingFulfillmentStatus, isCancelledOrderStatus } from '../utils/orderStatus';
import { publishPurchaseList } from '../services/purchaseLists';
import { useTableSort } from '../hooks/useTableSort';
import { SortableTableHeadCell } from '../components/SortableTableHeadCell';
import { applyDirection, compareAsc, toTimeMs } from '../utils/tableSort';
import { formatOrderNumberForDisplay } from '../utils/orderDisplay';
import { resolveOrderListTotalAmount } from '../utils/orderTotalOverrides';
import { useAppDialog } from '../context/AppDialogProvider';
import { useAuth } from '../context/AuthContext';
import type { OrderSearchParams } from '../services/orderSearch';
import { reindexOrdersTypesense } from '../services/orderSearch';
import {
  getDefaultNoonToNoonRangeIST,
  getDefaultOrdersFilterRangeIST,
  isDateInIstDateTimeRange,
  parseIstDateTimeLocal,
  formatIstDateTimeLocal,
} from '../utils/dateTime';
import { loadOrdersListView, saveOrdersListView } from '../utils/ordersListView';
import { useSessionPrintedIds } from '../utils/sessionPrintedInvoices';
import { IstDateTimeField } from '../components/IstDateTimeField';
import { SellingFirmFilterField } from '../components/SellingFirmField';
import { matchesSellingFirmFilter } from '../constants/sellingFirms';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_ROWS_PER_PAGE = 20;

function getInitialOrdersListView() {
  const saved = loadOrdersListView();
  const defaultRange = getDefaultOrdersFilterRangeIST();
  let fromDateFilter = saved.fromDateFilter ?? defaultRange.fromDateTime;
  const toDateFilter = defaultRange.toDateTime;
  const fromMs = fromDateFilter ? parseIstDateTimeLocal(fromDateFilter) : null;
  const toMs = parseIstDateTimeLocal(toDateFilter);
  if (fromMs != null && toMs != null && fromMs >= toMs) {
    fromDateFilter = defaultRange.fromDateTime;
  }
  return {
    searchTerm: saved.searchTerm ?? '',
    statusFilter: saved.statusFilter ?? ('All' as const),
    firmFilter: saved.firmFilter ?? 'All',
    fromDateFilter,
    toDateFilter,
    page: saved.page ?? 1,
    rowsPerPage: saved.rowsPerPage ?? DEFAULT_ROWS_PER_PAGE,
    sortKey: saved.sortKey ?? 'orderDate',
    sortDirection: saved.sortDirection ?? ('desc' as const),
  };
}

const isBulkSelectableStatus = (status: OrderStatus) =>
  status === 'Pending' ||
  status === 'Picked up' ||
  status === 'Order Fulfillment' ||
  status === 'In Transit' ||
  status === 'Delivered';

/** Normalized row shape rendered by the table, sourced from either Typesense or the fallback full list. */
interface OrderRow {
  id: string;
  orderDate: Date;
  storeName: string;
  retailerId: string;
  retailerEmail: string;
  townDistrict: string;
  itemCount: number;
  totalAmount: number;
  status: OrderStatus;
}

type SelectedOrderMeta = {
  status: OrderStatus;
  retailerId: string;
  storeName: string;
  retailerEmail: string;
};

/** Map the table's sort column id to the Typesense-indexed field name. */
const sortKeyToField = (key: string): OrderSearchParams['sortField'] => {
  switch (key) {
    case 'id':
      return 'docId';
    case 'retailer':
      return 'retailerEmail';
    case 'storeName':
      return 'retailerName';
    case 'items':
      return 'itemCount';
    case 'amount':
      return 'amountSortable';
    case 'status':
      return 'status';
    case 'orderDate':
    default:
      return 'orderDate';
  }
};

export const OrdersPage: React.FC = () => {
  const cancelOrderMutation = useCancelOrder();
  const mergePendingMutation = useMergePendingOrders();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { alert, confirm } = useAppDialog();
  const { canWrite, panelRole } = useAuth();
  const canEditOrders = canWrite('orders');
  const canReindexOrders = panelRole === 'admin' || panelRole === 'operations';
  const { data: stores } = useStores();
  const printedInvoiceIds = useSessionPrintedIds();

  const [viewInit] = useState(getInitialOrdersListView);
  const [searchTerm, setSearchTerm] = useState(viewInit.searchTerm);
  const [debouncedTerm, setDebouncedTerm] = useState(viewInit.searchTerm.trim());
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>(viewInit.statusFilter);
  const [firmFilter, setFirmFilter] = useState(viewInit.firmFilter);
  const [fromDateFilter, setFromDateFilter] = useState(viewInit.fromDateFilter);
  const [toDateFilter, setToDateFilter] = useState(viewInit.toDateFilter);
  const [draftFromDateFilter, setDraftFromDateFilter] = useState(viewInit.fromDateFilter);
  const [draftToDateFilter, setDraftToDateFilter] = useState(viewInit.toDateFilter);
  const [page, setPage] = useState(viewInit.page);
  const [rowsPerPage, setRowsPerPage] = useState<number>(viewInit.rowsPerPage);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingProductSummary, setIsExportingProductSummary] = useState(false);
  const [isPublishingPurchaseList, setIsPublishingPurchaseList] = useState(false);
  const [typesenseDisabled, setTypesenseDisabled] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [selectedById, setSelectedById] = useState<Record<string, SelectedOrderMeta>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDispatchDialog, setBulkDispatchDialog] = useState({
    open: false,
    courierName: '',
    trackingNumber: '',
    notes: '',
  });
  const [bulkDeliverDialog, setBulkDeliverDialog] = useState({ open: false });
  const [mergePendingDialog, setMergePendingDialog] = useState({ open: false });
  const [mergeAllDialog, setMergeAllDialog] = useState({ open: false, beforeDateTime: '' });
  const [mergeAllBusy, setMergeAllBusy] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; orderId: string; reason: string }>({
    open: false,
    orderId: '',
    reason: '',
  });
  const [pendingExportDialog, setPendingExportDialog] = useState({
    open: false,
    fromDateTime: '',
    toDateTime: '',
  });
  const [productSummaryDialog, setProductSummaryDialog] = useState({
    open: false,
    fromDateTime: '',
    toDateTime: '',
    markPickedUp: false,
    includePickedUp: false,
  });

  const { sortKey, sortDirection, requestSort } = useTableSort(
    viewInit.sortKey,
    viewInit.sortDirection
  );

  useEffect(() => {
    saveOrdersListView({
      searchTerm,
      statusFilter,
      firmFilter,
      fromDateFilter,
      toDateFilter,
      page,
      rowsPerPage,
      sortKey,
      sortDirection,
    });
  }, [
    searchTerm,
    statusFilter,
    firmFilter,
    fromDateFilter,
    toDateFilter,
    page,
    rowsPerPage,
    sortKey,
    sortDirection,
  ]);

  // Drop selection when filters / paging change so actions match what's on screen.
  useEffect(() => {
    setSelectedById({});
  }, [debouncedTerm, statusFilter, firmFilter, fromDateFilter, toDateFilter, page, rowsPerPage, sortKey, sortDirection]);

  const storeNameByRetailerId = useMemo(() => {
    const map = new Map<string, string>();
    stores?.forEach((store) => {
      const name = store.shopName || store.displayName;
      if (!name) return;
      map.set(store.id, name);
      if (store.uid) map.set(store.uid, name);
    });
    return map;
  }, [stores]);

  const storeByRetailerId = useMemo(() => {
    const map = new Map<string, User>();
    stores?.forEach((store) => {
      map.set(store.id, store);
      if (store.uid) map.set(store.uid, store);
    });
    return map;
  }, [stores]);

  const storeByEmail = useMemo(() => {
    const map = new Map<string, User>();
    stores?.forEach((store) => {
      const email = (store.email || '').trim().toLowerCase();
      if (email) map.set(email, store);
    });
    return map;
  }, [stores]);

  const resolveStoreName = (retailerName?: string, retailerId?: string) =>
    retailerName?.trim() ||
    (retailerId ? storeNameByRetailerId.get(retailerId) : undefined) ||
    'N/A';

  const resolveTownDistrict = (retailerId?: string, retailerEmail?: string) => {
    const store =
      (retailerId ? storeByRetailerId.get(retailerId) : undefined) ||
      (retailerEmail ? storeByEmail.get(retailerEmail.trim().toLowerCase()) : undefined);
    const label = formatTownDistrict(store?.town, store?.district);
    return label || '—';
  };

  const resolveRetailerId = (retailerId?: string, retailerEmail?: string) => {
    if (retailerId?.trim()) return retailerId.trim();
    const email = (retailerEmail || '').trim().toLowerCase();
    if (email) return storeByEmail.get(email)?.id || '';
    return '';
  };

  // Debounce the search term so we don't fire a Typesense query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fromFilterMs = fromDateFilter ? parseIstDateTimeLocal(fromDateFilter) : null;
  const toFilterMs = toDateFilter ? parseIstDateTimeLocal(toDateFilter) : null;
  const dateRangeInvalid = Boolean(
    fromDateFilter &&
      toDateFilter &&
      (fromFilterMs == null || toFilterMs == null || fromFilterMs >= toFilterMs)
  );
  const draftFromMs = draftFromDateFilter ? parseIstDateTimeLocal(draftFromDateFilter) : null;
  const draftToMs = draftToDateFilter ? parseIstDateTimeLocal(draftToDateFilter) : null;
  const draftDateRangeInvalid = Boolean(
    draftFromDateFilter &&
      draftToDateFilter &&
      (draftFromMs == null || draftToMs == null || draftFromMs >= draftToMs)
  );
  const dateDraftDirty =
    draftFromDateFilter !== fromDateFilter || draftToDateFilter !== toDateFilter;

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
  const hasDateFilter = Boolean((fromDateFilter || toDateFilter) && !dateRangeInvalid);
  /** Prefer Firestore for any date filter — Typesense can lag behind new orders. */
  const hasFirmFilter = firmFilter !== 'All';
  /** Firm lives on the Firestore bill. Search index does not know it, so a firm pick uses the loaded orders. */
  const useLocalList = typesenseDisabled || hasDateFilter || hasFirmFilter;

  /** Retailer ids whose town/district matches the search term (for Typesense location filter). */
  const locationMatchedRetailerIds = useMemo(() => {
    const term = debouncedTerm.toLowerCase();
    // Avoid hijacking short queries (e.g. "a") into location-only results.
    if (term.length < 3) return [] as string[];
    const ids = new Set<string>();
    for (const store of stores || []) {
      const town = (store.town || '').trim().toLowerCase();
      const district = (store.district || '').trim().toLowerCase();
      const label = formatTownDistrict(store.town, store.district).toLowerCase();
      if (
        (town && town.includes(term)) ||
        (district && district.includes(term)) ||
        (label && label.includes(term))
      ) {
        if (store.id) ids.add(store.id);
        if (store.uid) ids.add(store.uid);
      }
    }
    return Array.from(ids);
  }, [debouncedTerm, stores]);

  // Primary path: server-side search/filter/sort/pagination via Typesense.
  const searchParams: OrderSearchParams = {
    query: debouncedTerm,
    status: statusFilter,
    sortField: sortKeyToField(sortKey),
    sortOrder: sortDirection,
    page,
    perPage: rowsPerPage,
    ...(fromDateFilter && !dateRangeInvalid ? { fromDate: fromDateFilter.slice(0, 10) } : {}),
    ...(toDateFilter && !dateRangeInvalid ? { toDate: toDateFilter.slice(0, 10) } : {}),
    ...(locationMatchedRetailerIds.length > 0
      ? { locationRetailerIds: locationMatchedRetailerIds }
      : {}),
  };
  const {
    data: searchData,
    isError: searchErrored,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useOrdersSearch(searchParams, { enabled: !useLocalList && !dateRangeInvalid });

  // If Typesense is unreachable/misconfigured, permanently fall back for this session.
  useEffect(() => {
    if (searchErrored) setTypesenseDisabled(true);
  }, [searchErrored]);

  const dateRangeBounds = useMemo(() => {
    if (!hasDateFilter) return null;
    return {
      startMs: fromFilterMs ?? 0,
      endMsExclusive: toFilterMs ?? undefined,
    };
  }, [hasDateFilter, fromFilterMs, toFilterMs]);

  const { data: rangedOrders, isLoading: rangeLoading, isFetching: rangeFetching } = useQuery({
    queryKey: ['ordersInRange', dateRangeBounds?.startMs, dateRangeBounds?.endMsExclusive],
    queryFn: () =>
      getOrdersInRange(dateRangeBounds!.startMs, dateRangeBounds!.endMsExclusive),
    enabled: hasDateFilter && dateRangeBounds != null,
    // Always reload when navigating back to Orders Management.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fallback path: full collection when Typesense unavailable and no date filter.
  const { data: allOrders, isLoading: allLoading, isFetching: allFetching } = useOrders({
    enabled: (typesenseDisabled || hasFirmFilter) && !hasDateFilter,
  });

  const localOrdersSource = hasDateFilter ? rangedOrders ?? [] : allOrders ?? [];

  const filterLocalOrders = useCallback(
    (orders: Order[], applyStatusFilter: boolean) => {
      const term = debouncedTerm.toLowerCase();
      return orders.filter((order) => {
        const townDistrict = resolveTownDistrict(order.retailerId, order.retailerEmail).toLowerCase();
      const invoiceNumber = (order.invoiceNumber || '').toLowerCase();
        const invoiceCompact = invoiceNumber.replace(/[^a-z0-9]/g, '');
        const termCompact = term.replace(/[^a-z0-9]/g, '');
        const matchesSearch =
          !term ||
          order.id.toLowerCase().includes(term) ||
          invoiceNumber.includes(term) ||
          (termCompact.length >= 3 && invoiceCompact.includes(termCompact)) ||
          resolveStoreName(order.retailerName, order.retailerId).toLowerCase().includes(term) ||
          order.retailerEmail?.toLowerCase().includes(term) ||
          townDistrict.includes(term) ||
          order.medicines.some((m) => m.name.toLowerCase().includes(term));
        const matchesStatus =
          !applyStatusFilter || statusFilter === 'All' || order.status === statusFilter;
        const matchesFirm = matchesSellingFirmFilter(order.sellingFirmId, firmFilter);
        const matchesDate = isDateInIstDateTimeRange(
          order.orderDate,
          fromDateFilter || undefined,
          toDateFilter || undefined
        );
        return matchesSearch && matchesStatus && matchesDate && matchesFirm;
      });
    },
    [
      debouncedTerm,
      statusFilter,
      firmFilter,
      fromDateFilter,
      toDateFilter,
      storeNameByRetailerId,
      storeByRetailerId,
      storeByEmail,
    ]
  );

  // (locationMatchedRetailerIds defined above searchParams)

  const localFilteredSorted = useMemo(() => {
    if (!useLocalList) return [];
    if (dateRangeInvalid) return [];
    const filtered = filterLocalOrders(localOrdersSource, true);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'id':
          return applyDirection(compareAsc(a.id, b.id), sortDirection);
        case 'retailer':
          return applyDirection(
            compareAsc((a.retailerEmail || '').toLowerCase(), (b.retailerEmail || '').toLowerCase()),
            sortDirection
          );
        case 'storeName':
          return applyDirection(
            compareAsc(
              resolveStoreName(a.retailerName, a.retailerId).toLowerCase(),
              resolveStoreName(b.retailerName, b.retailerId).toLowerCase()
            ),
            sortDirection
          );
        case 'townDistrict':
          return applyDirection(
            compareAsc(
              resolveTownDistrict(a.retailerId, a.retailerEmail).toLowerCase(),
              resolveTownDistrict(b.retailerId, b.retailerEmail).toLowerCase()
            ),
            sortDirection
          );
        case 'items':
          return applyDirection(compareAsc(a.medicines.length, b.medicines.length), sortDirection);
        case 'amount': {
          const va = isAwaitingFulfillmentStatus(a.status) ? 0 : a.totalAmount;
          const vb = isAwaitingFulfillmentStatus(b.status) ? 0 : b.totalAmount;
          return applyDirection(compareAsc(va, vb), sortDirection);
        }
        case 'status':
          return applyDirection(compareAsc(a.status, b.status), sortDirection);
        case 'orderDate':
        default:
          return applyDirection(compareAsc(toTimeMs(a.orderDate), toTimeMs(b.orderDate)), sortDirection);
      }
    });
    return sorted;
  }, [
    useLocalList,
    dateRangeInvalid,
    localOrdersSource,
    filterLocalOrders,
    sortKey,
    sortDirection,
    storeByRetailerId,
    storeByEmail,
    storeNameByRetailerId,
  ]);

  const localStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of filterLocalOrders(localOrdersSource, false)) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
    }
    return counts;
  }, [localOrdersSource, filterLocalOrders]);

  // Normalized view model shared by both paths.
  const rows: OrderRow[] = useMemo(() => {
    if (useLocalList) {
      return localFilteredSorted
        .slice((page - 1) * rowsPerPage, page * rowsPerPage)
        .map((o) => {
          const retailerId = resolveRetailerId(o.retailerId, o.retailerEmail);
          return {
            id: o.id,
            orderDate: o.orderDate instanceof Date ? o.orderDate : new Date(o.orderDate),
            storeName: resolveStoreName(o.retailerName, o.retailerId),
            retailerId,
            retailerEmail: o.retailerEmail || '',
            townDistrict: resolveTownDistrict(o.retailerId || retailerId, o.retailerEmail),
            itemCount: o.medicines.length,
            totalAmount: resolveOrderListTotalAmount(o.id, o.totalAmount),
            status: o.status,
          };
        });
    }
    return (searchData?.orders ?? []).map((o) => {
      const retailerId = resolveRetailerId(o.retailerId, o.retailerEmail);
      return {
        id: o.id,
        orderDate: new Date(o.orderDate),
        storeName: o.retailerName?.trim() || 'N/A',
        retailerId,
        retailerEmail: o.retailerEmail || '',
        townDistrict: resolveTownDistrict(retailerId, o.retailerEmail),
        itemCount: o.itemCount,
        totalAmount: resolveOrderListTotalAmount(o.id, o.totalAmount),
        status: o.status,
      };
    });
  }, [
    useLocalList,
    localFilteredSorted,
    page,
    rowsPerPage,
    searchData,
    storeNameByRetailerId,
    storeByRetailerId,
    storeByEmail,
  ]);

  const statusCounts = useLocalList ? localStatusCounts : searchData?.statusCounts ?? {};
  const totalCount = useLocalList ? localFilteredSorted.length : searchData?.found ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  useEffect(() => {
    if (totalCount > 0 && page > totalPages) setPage(totalPages);
  }, [totalCount, page, totalPages]);

  const ordersByStatus = {
    Pending: statusCounts['Pending'] ?? 0,
    PickedUp: statusCounts['Picked up'] ?? 0,
    Fulfillment: statusCounts['Order Fulfillment'] ?? 0,
    Transit: statusCounts['In Transit'] ?? 0,
    Delivered: statusCounts['Delivered'] ?? 0,
    Cancelled: statusCounts['Cancelled'] ?? 0,
    CancelledMerged: statusCounts['Cancelled-Merged'] ?? 0,
  };
  const requestSortResetPage = (key: string) => {
    requestSort(key);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const openOrder = (orderId: string, newTab = false) => {
    const path = `/orders/${orderId}`;
    if (newTab) {
      window.open(path, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(path);
  };

  const handleCancelOrder = async () => {
    const user = auth.currentUser;
    if (!user || !cancelDialog.orderId) return;

    try {
      const res = await cancelOrderMutation.mutateAsync({
        orderId: cancelDialog.orderId,
        cancelledBy: user.uid,
        reason: cancelDialog.reason,
      });
      setCancelDialog({ open: false, orderId: '', reason: '' });
      if (res.stockRestoreErrors.length > 0) {
        console.warn('Stock restore errors on cancel:', res.stockRestoreErrors);
        window.alert(
          `Order cancelled, but some stock could not be restored:\n${res.stockRestoreErrors.slice(0, 3).join('\n')}`
        );
      }
    } catch (error) {
      console.error('Error cancelling order:', error);
    }
  };

  const selectedIds = useMemo(() => Object.keys(selectedById), [selectedById]);
  const selectedFulfillmentIds = useMemo(
    () => selectedIds.filter((id) => selectedById[id]?.status === 'Order Fulfillment'),
    [selectedIds, selectedById]
  );
  const selectedTransitIds = useMemo(
    () => selectedIds.filter((id) => selectedById[id]?.status === 'In Transit'),
    [selectedIds, selectedById]
  );
  const selectedUnfulfillIds = useMemo(
    () =>
      selectedIds.filter((id) => {
        const status = selectedById[id]?.status;
        return (
          status === 'Order Fulfillment' || status === 'In Transit' || status === 'Delivered'
        );
      }),
    [selectedIds, selectedById]
  );
  const selectedPendingIds = useMemo(
    () => selectedIds.filter((id) => selectedById[id]?.status === 'Pending'),
    [selectedIds, selectedById]
  );
  const pendingMergeRetailerId = useMemo(() => {
    if (selectedPendingIds.length < 2) return '';
    const first = String(selectedById[selectedPendingIds[0]]?.retailerId || '').trim();
    if (!first) return '';
    const same = selectedPendingIds.every(
      (id) => String(selectedById[id]?.retailerId || '').trim() === first
    );
    return same ? first : '';
  }, [selectedPendingIds, selectedById]);
  const canMergePending = Boolean(pendingMergeRetailerId) && selectedPendingIds.length >= 2;
  const mergePendingStoreName = pendingMergeRetailerId
    ? selectedById[selectedPendingIds[0]]?.storeName || 'this retailer'
    : '';

  const selectableRowsOnPage = useMemo(
    () => (canEditOrders ? rows.filter((r) => isBulkSelectableStatus(r.status)) : []),
    [rows, canEditOrders]
  );
  const allSelectableOnPageSelected =
    selectableRowsOnPage.length > 0 &&
    selectableRowsOnPage.every((r) => Boolean(selectedById[r.id]));
  const someSelectableOnPageSelected =
    selectableRowsOnPage.some((r) => Boolean(selectedById[r.id])) && !allSelectableOnPageSelected;

  const toSelectedMeta = (order: OrderRow): SelectedOrderMeta => ({
    status: order.status,
    retailerId: order.retailerId,
    storeName: order.storeName,
    retailerEmail: order.retailerEmail,
  });

  const toggleRowSelected = (order: OrderRow) => {
    if (!canEditOrders || !isBulkSelectableStatus(order.status)) return;
    setSelectedById((prev) => {
      const next = { ...prev };
      if (next[order.id]) delete next[order.id];
      else next[order.id] = toSelectedMeta(order);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    if (!canEditOrders) return;
    setSelectedById((prev) => {
      const next = { ...prev };
      if (allSelectableOnPageSelected) {
        for (const r of selectableRowsOnPage) delete next[r.id];
      } else {
        for (const r of selectableRowsOnPage) next[r.id] = toSelectedMeta(r);
      }
      return next;
    });
  };

  const handleDownloadSelectedStores = async () => {
    if (selectedIds.length === 0) {
      await alert('Select at least one order first', { severity: 'warning' });
      return;
    }
    await exportSelectedOrderStores(
      selectedIds.map((id) => ({
        orderId: id,
        status: selectedById[id]?.status || '',
        retailerId: selectedById[id]?.retailerId || '',
        storeName: selectedById[id]?.storeName || '',
        retailerEmail: selectedById[id]?.retailerEmail || '',
      })),
      stores || [],
      'selected-order-stores'
    );
  };

  const handleDownloadSelectedShortItems = async () => {
    if (selectedIds.length === 0) {
      await alert('Select at least one order first', { severity: 'warning' });
      return;
    }
    setBulkBusy(true);
    try {
      const orders: Order[] = [];
      const loadErrors: string[] = [];
      for (const orderId of selectedIds) {
        try {
          const order = await getOrderById(orderId);
          if (order) orders.push(order);
          else loadErrors.push(`${formatOrderNumberForDisplay(orderId)}: not found`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          loadErrors.push(`${formatOrderNumberForDisplay(orderId)}: ${msg}`);
        }
      }
      const shortRows = extractOrderShortfallsFromOrders(orders);
      if (shortRows.length === 0) {
        await alert(
          loadErrors.length > 0
            ? `No short items on the selected orders.\nLoad issues:\n${loadErrors.slice(0, 5).join('\n')}`
            : 'No short items on the selected orders.',
          { severity: 'warning' }
        );
        return;
      }
      exportOrderShortfallsToExcel(shortRows, 'selected-order-short-items');
      await alert(
        `Downloaded ${shortRows.length} short item line(s) from ${orders.length} order(s)${
          loadErrors.length > 0 ? ` (${loadErrors.length} load issue(s))` : ''
        }.`,
        { severity: loadErrors.length > 0 ? 'warning' : 'success' }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to export short items';
      await alert(msg, { severity: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };

  const refreshOrderLists = async () => {
    await invalidateOrderListQueries(queryClient);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['ordersSearch'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['ordersInRange'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['orders'], type: 'active' }),
    ]);
  };

  const handleRefresh = () => {
    void refreshOrderLists();
  };

  const refreshListsAfterBulk = async () => {
    await refreshOrderLists();
    setSelectedById({});
  };

  const handleBulkDispatchConfirm = async () => {
    const user = auth.currentUser;
    if (!user || selectedFulfillmentIds.length === 0) return;
    setBulkBusy(true);
    const errors: string[] = [];
    try {
      for (const orderId of selectedFulfillmentIds) {
        try {
          await updateOrderDispatch(orderId, {
            status: 'In Transit',
            dispatchDate: new Date(),
            dispatchedBy: user.uid,
            courierName: bulkDispatchDialog.courierName.trim() || undefined,
            trackingNumber: bulkDispatchDialog.trackingNumber.trim() || undefined,
            dispatchNotes: bulkDispatchDialog.notes.trim() || undefined,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${formatOrderNumberForDisplay(orderId)}: ${msg}`);
        }
      }
      setBulkDispatchDialog({ open: false, courierName: '', trackingNumber: '', notes: '' });
      await refreshListsAfterBulk();
      if (errors.length > 0) {
        await alert(
          `Dispatched ${selectedFulfillmentIds.length - errors.length} order(s). Failed:\n${errors.slice(0, 5).join('\n')}`,
          { severity: 'warning' }
        );
      } else {
        await alert(`Marked ${selectedFulfillmentIds.length} order(s) as In Transit.`, {
          severity: 'success',
        });
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDeliverConfirm = async () => {
    const user = auth.currentUser;
    if (!user || selectedTransitIds.length === 0) return;
    setBulkBusy(true);
    const errors: string[] = [];
    const emailErrors: string[] = [];
    let emailedCount = 0;
    try {
      for (const orderId of selectedTransitIds) {
        try {
          await markOrderDelivered(orderId, user.uid);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${formatOrderNumberForDisplay(orderId)}: ${msg}`);
          continue;
        }
        try {
          const order = await getOrderById(orderId);
          if (!order) {
            emailErrors.push(`${formatOrderNumberForDisplay(orderId)}: order not found for invoice email`);
            continue;
          }
          const emailResult = await generateOrderInvoice(order, {
            emailPdfToRetailer: true,
            downloadPdf: false,
            awaitEmail: true,
            suppressEmailAlerts: true,
          });
          if (emailResult.emailed) {
            emailedCount += 1;
          } else {
            emailErrors.push(
              `${formatOrderNumberForDisplay(orderId)}: ${emailResult.emailError || 'email failed'}`
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          emailErrors.push(`${formatOrderNumberForDisplay(orderId)}: ${msg}`);
        }
      }
      setBulkDeliverDialog({ open: false });
      await refreshListsAfterBulk();
      const deliveredOk = selectedTransitIds.length - errors.length;
      const parts: string[] = [
        `Marked ${deliveredOk} order(s) as Delivered.`,
        emailedCount > 0 ? `Invoices emailed to ${emailedCount} store(s).` : '',
      ].filter(Boolean);
      if (errors.length > 0) {
        parts.push(`Deliver failed:\n${errors.slice(0, 5).join('\n')}`);
      }
      if (emailErrors.length > 0) {
        parts.push(`Invoice email failed:\n${emailErrors.slice(0, 5).join('\n')}`);
      }
      await alert(parts.join('\n\n'), {
        severity: errors.length > 0 || emailErrors.length > 0 ? 'warning' : 'success',
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkUnfulfill = async () => {
    const user = auth.currentUser;
    if (!user || selectedUnfulfillIds.length === 0) return;
    const ok = await confirm(
      `Un-fulfill ${selectedUnfulfillIds.length} order(s)? They will return to Pending, stock will be restored, and wallet applied on those invoices will be reversed. You will need to fulfill again.`,
      { destructive: true }
    );
    if (!ok) return;
    setBulkBusy(true);
    const errors: string[] = [];
    let restoredWarn = 0;
    try {
      for (const orderId of selectedUnfulfillIds) {
        try {
          const res = await unfulfillOrder(orderId, user.uid);
          if (res.stockRestoreErrors.length > 0) restoredWarn += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${formatOrderNumberForDisplay(orderId)}: ${msg}`);
        }
      }
      await refreshListsAfterBulk();
      if (errors.length > 0) {
        await alert(
          `Un-fulfilled ${selectedUnfulfillIds.length - errors.length} order(s). Failed:\n${errors.slice(0, 5).join('\n')}`,
          { severity: 'warning' }
        );
      } else if (restoredWarn > 0) {
        await alert(
          `Un-fulfilled ${selectedUnfulfillIds.length} order(s). ${restoredWarn} had stock restore issues — check the order and Restore deducted stock if needed.`,
          { severity: 'warning' }
        );
      } else {
        await alert(`Un-fulfilled ${selectedUnfulfillIds.length} order(s). They are back in Pending.`, {
          severity: 'success',
        });
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleMergeAllPendingConfirm = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const cutoffMs = parseIstDateTimeLocal(mergeAllDialog.beforeDateTime);
    if (cutoffMs == null) {
      await alert('Please choose a valid date and time', { severity: 'warning' });
      return;
    }
    setMergeAllBusy(true);
    try {
      const result = await mergePendingOrdersBefore(cutoffMs, user.uid);
      setMergeAllDialog({ open: false, beforeDateTime: '' });
      setStatusFilter('Pending');
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['productDemands'] });
      await refreshListsAfterBulk();
      if (result.pendingBeforeCutoff === 0) {
        await alert('No pending orders were placed before that time.', { severity: 'info' });
        return;
      }
      if (result.retailersMerged === 0 && result.failures.length === 0) {
        await alert(
          `${result.pendingBeforeCutoff} pending order(s) were before that time, and each retailer had only one. Nothing was merged.`,
          { severity: 'info' }
        );
        return;
      }
      const failureNote =
        result.failures.length > 0
          ? `\n${result.failures.length} retailer(s) could not be merged:\n${result.failures.slice(0, 5).join('\n')}`
          : '';
      await alert(
        `Merged pending orders for ${result.retailersMerged} retailer(s) (${result.ordersCombined} orders combined into one order each). ${result.retailersLeftSingle} retailer(s) had only one order and were left as they are.${failureNote}`,
        { severity: result.failures.length > 0 ? 'warning' : 'success' }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to merge pending orders';
      await alert(msg, { severity: 'error' });
    } finally {
      setMergeAllBusy(false);
    }
  };

  const handleMergePendingConfirm = async () => {
    const user = auth.currentUser;
    if (!user || !canMergePending) return;
    setBulkBusy(true);
    try {
      const result = await mergePendingMutation.mutateAsync({
        orderIds: selectedPendingIds,
        mergedBy: user.uid,
      });
      setMergePendingDialog({ open: false });
      // Hide merge-cancelled sources: show Pending only after merge.
      setStatusFilter('Pending');
      setPage(1);
      await refreshListsAfterBulk();
      await alert(
        `Merged into #${formatOrderNumberForDisplay(result.targetOrderId)} (${result.lineCount} line(s)). ${result.cancelledOrderIds.length} source order(s) are Cancelled-Merged and hidden from the retailer.`,
        { severity: 'success' }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to merge orders';
      await alert(msg, { severity: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'warning';
      case 'Picked up': return 'secondary';
      case 'Order Fulfillment': return 'primary';
      case 'In Transit': return 'info';
      case 'Delivered': return 'success';
      case 'Cancelled':
      case 'Cancelled-Merged':
        return 'error';
      default: return 'default';
    }
  };

  const parseExportDateTimeRange = async (
    fromDateTime: string,
    toDateTime: string
  ): Promise<{ startMs: number; endMs: number } | null> => {
    if (!fromDateTime || !toDateTime) {
      await alert('Please select both From and To date & time', { severity: 'warning' });
      return null;
    }
    const startMs = parseIstDateTimeLocal(fromDateTime);
    const endMs = parseIstDateTimeLocal(toDateTime);
    if (startMs == null || endMs == null) {
      await alert('Please enter valid From and To date & time', { severity: 'warning' });
      return null;
    }
    if (startMs >= endMs) {
      await alert('From must be before To', { severity: 'warning' });
      return null;
    }
    return { startMs, endMs };
  };

  const handleExportPendingOrders = async () => {
    const range = await parseExportDateTimeRange(
      pendingExportDialog.fromDateTime,
      pendingExportDialog.toDateTime
    );
    if (!range) return;

    setIsExporting(true);
    try {
      const ordersInRange = await getOrdersInRange(range.startMs, range.endMs);
      const pendingOrders = ordersInRange.filter(
        (o) => o.status === 'Pending' && matchesSellingFirmFilter(o.sellingFirmId, firmFilter)
      );
      if (pendingOrders.length === 0) {
        await alert('No pending orders found in the selected date & time range', {
          severity: 'warning',
        });
        return;
      }
      const fromStamp = pendingExportDialog.fromDateTime.replace(/[-:T]/g, '');
      const toStamp = pendingExportDialog.toDateTime.replace(/[-:T]/g, '');
      await exportPendingOrdersByStore(
        pendingOrders,
        stores || [],
        `pending-orders-by-store-${fromStamp}-${toStamp}`
      );
      setPendingExportDialog((prev) => ({ ...prev, open: false }));
      await alert('Excel file generated successfully!', { severity: 'success' });
    } catch (error: any) {
      console.error('Error exporting orders:', error);
      await alert(`Failed to export: ${error.message || 'Unknown error'}`, { severity: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPendingProductSummary = async () => {
    const { fromDateTime, toDateTime } = productSummaryDialog;
    const range = await parseExportDateTimeRange(fromDateTime, toDateTime);
    if (!range) return;

    setIsExportingProductSummary(true);
    try {
      const ordersInRange = await getOrdersInRange(range.startMs, range.endMs);
      const pendingInRange = ordersInRange.filter(
        (o) => o.status === 'Pending' && matchesSellingFirmFilter(o.sellingFirmId, firmFilter)
      );
      const pickedUpInRange = ordersInRange.filter(
        (o) => o.status === 'Picked up' && matchesSellingFirmFilter(o.sellingFirmId, firmFilter)
      );
      const exportOrders = productSummaryDialog.includePickedUp
        ? [...pendingInRange, ...pickedUpInRange]
        : pendingInRange;

      if (exportOrders.length === 0) {
        await alert(
          productSummaryDialog.includePickedUp
            ? 'No pending or picked up orders found in the selected date & time range'
            : 'No pending orders found in the selected date & time range',
          { severity: 'warning' }
        );
        return;
      }

      const fromStamp = fromDateTime.replace(/[-:T]/g, '');
      const toStamp = toDateTime.replace(/[-:T]/g, '');
      const filename = `pending-orders-product-summary-${fromStamp}-${toStamp}`;
      await exportPendingOrdersProductSummary(exportOrders, filename);

      let marked = 0;
      if (productSummaryDialog.markPickedUp && pendingInRange.length > 0) {
        const user = auth.currentUser;
        if (!user) throw new Error('Sign in required to mark orders picked up');
        marked = await markOrdersPickedUp(
          pendingInRange.map((order) => order.id),
          user.uid
        );
        await refreshOrderLists();
      }

      setProductSummaryDialog((prev) => ({ ...prev, open: false }));
      await alert(
        marked > 0
          ? `Product summary downloaded. ${marked} pending order(s) marked as Picked up.`
          : 'Product summary Excel file generated successfully!',
        { severity: 'success' }
      );
    } catch (error: unknown) {
      console.error('Error exporting product summary:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to export: ${message}`, { severity: 'error' });
    } finally {
      setIsExportingProductSummary(false);
    }
  };

  const handlePublishPurchaseList = async () => {
    const fromDate = productSummaryDialog.fromDateTime.slice(0, 10);
    const toDate = productSummaryDialog.toDateTime.slice(0, 10);
    if (!fromDate || !toDate) {
      await alert('Please select both From and To dates', { severity: 'warning' });
      return;
    }
    if (fromDate > toDate) {
      await alert('From date must be on or before To date', { severity: 'warning' });
      return;
    }

    setIsPublishingPurchaseList(true);
    try {
      const result = await publishPurchaseList({
        orders: [],
        fromDate,
        toDate,
      });
      setProductSummaryDialog((prev) => ({ ...prev, open: false }));
      const eliminated = result.eliminatedCount ?? 0;
      const reduced = result.reducedCount ?? 0;
      await alert(
        `Published purchase list with ${result.itemCount} medicines (net remaining).` +
          (eliminated || reduced
            ? ` Eliminated ${eliminated} fully covered; reduced ${reduced} partially covered.`
            : '') +
          ' Prior open lists were superseded. Auto jobs also run daily at 12:00 & 15:00 IST.',
        { severity: 'success' }
      );
    } catch (error: unknown) {
      console.error('Error publishing purchase list:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await alert(`Failed to publish: ${message}`, { severity: 'error' });
    } finally {
      setIsPublishingPurchaseList(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const d = await reindexOrdersTypesense();
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

  // While Typesense is erroring but before the fallback has engaged, keep showing
  // the loader instead of a flash of "No orders found".
  const initialLoading = useLocalList
    ? hasDateFilter
      ? rangeLoading
      : allLoading
    : searchLoading || searchErrored;
  if (initialLoading) {
    return <Loading message="Loading orders..." />;
  }

  const isBusy = useLocalList
    ? hasDateFilter
      ? rangeFetching && !rangeLoading
      : allFetching && !allLoading
    : searchFetching;

  const statusSummary: Array<{
    label: string;
    status: OrderStatus | 'All';
    count: number;
    color: 'default' | 'warning' | 'secondary' | 'primary' | 'info' | 'success' | 'error';
  }> = [
    {
      label: 'All',
      status: 'All',
      count: Object.values(ordersByStatus).reduce((sum, n) => sum + n, 0),
      color: 'default',
    },
    { label: 'Pending', status: 'Pending', count: ordersByStatus.Pending, color: 'warning' },
    { label: 'Picked up', status: 'Picked up', count: ordersByStatus.PickedUp, color: 'secondary' },
    { label: 'Fulfillment', status: 'Order Fulfillment', count: ordersByStatus.Fulfillment, color: 'primary' },
    { label: 'In Transit', status: 'In Transit', count: ordersByStatus.Transit, color: 'info' },
    { label: 'Delivered', status: 'Delivered', count: ordersByStatus.Delivered, color: 'success' },
    { label: 'Cancelled', status: 'Cancelled', count: ordersByStatus.Cancelled, color: 'error' },
    {
      label: 'Cancelled-Merged',
      status: 'Cancelled-Merged',
      count: ordersByStatus.CancelledMerged,
      color: 'error',
    },
  ];

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 0.5 }}>
          Orders
        </Typography>
        {statusSummary.map((stat) => (
          <Chip
            key={stat.status}
            size="small"
            label={`${stat.label} ${stat.count}`}
            color={stat.color}
            variant={statusFilter === stat.status ? 'filled' : 'outlined'}
            onClick={() => {
              setStatusFilter(stat.status);
              setPage(1);
            }}
            sx={{ fontWeight: statusFilter === stat.status ? 600 : 400 }}
          />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Refresh list">
          <span>
            <IconButton size="small" onClick={handleRefresh} disabled={isBusy} aria-label="Refresh">
              <Refresh fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {canReindexOrders && (
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
            placeholder="Search order, invoice, store, email…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 220, flex: '1 1 200px' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <SellingFirmFilterField
            value={firmFilter}
            onChange={(next) => {
              setFirmFilter(next);
              setPage(1);
            }}
          />
          <IstDateTimeField
            label="From"
            value={draftFromDateFilter}
            onChange={setDraftFromDateFilter}
            ampm
            sx={{ width: { xs: '100%', sm: 270 } }}
          />
          <IstDateTimeField
            label="To"
            value={draftToDateFilter}
            onChange={setDraftToDateFilter}
            ampm
            sx={{ width: { xs: '100%', sm: 270 } }}
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
              const range = getDefaultOrdersFilterRangeIST();
              applyDateRange(range.fromDateTime, range.toDateTime);
            }}
          >
            7 days
          </Button>
          <Button
            size="small"
            variant="text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const range = getDefaultNoonToNoonRangeIST();
              applyDateRange(range.fromDateTime, range.toDateTime);
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
            variant="text"
            size="small"
            startIcon={<Download fontSize="small" />}
            onClick={() =>
              setPendingExportDialog({
                open: true,
                ...getDefaultNoonToNoonRangeIST(),
              })
            }
            disabled={isExporting || isExportingProductSummary}
          >
            {isExporting ? 'Exporting…' : 'Pending'}
          </Button>
          <Tooltip title="A product summary of pending orders is emailed daily at 3:33 PM IST, except Sundays and holidays.">
            <span>
              <Button
                variant="text"
                size="small"
                startIcon={<Download fontSize="small" />}
                onClick={() =>
                  setProductSummaryDialog({
                    open: true,
                    markPickedUp: false,
                    includePickedUp: false,
                    ...getDefaultNoonToNoonRangeIST(),
                  })
                }
                disabled={isExporting || isExportingProductSummary}
              >
                {isExportingProductSummary ? 'Exporting…' : 'Summary'}
              </Button>
            </span>
          </Tooltip>
        </Box>
        {draftDateRangeInvalid && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75 }}>
            From must be before To.
          </Typography>
        )}
        {dateDraftDirty && !draftDateRangeInvalid && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Finish From and To, then click OK to refresh the list.
          </Typography>
        )}
      </Paper>

      {canEditOrders && (
        <Paper sx={{ mb: 2 }}>
          <Toolbar
            sx={{
              gap: 1,
              flexWrap: 'wrap',
              py: 1,
              minHeight: 56,
            }}
          >
            {selectedIds.length > 0 && (
              <>
            <Typography variant="body2" sx={{ mr: 1 }}>
              {selectedIds.length} selected
              {selectedPendingIds.length > 0 ? ` · ${selectedPendingIds.length} pending` : ''}
              {selectedFulfillmentIds.length > 0
                ? ` · ${selectedFulfillmentIds.length} fulfillment`
                : ''}
              {selectedTransitIds.length > 0 ? ` · ${selectedTransitIds.length} in transit` : ''}
              {selectedUnfulfillIds.length > 0
                ? ` · ${selectedUnfulfillIds.length} can un-fulfill`
                : ''}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              startIcon={<MergeType />}
              disabled={bulkBusy || !canMergePending || mergePendingMutation.isPending}
              onClick={() => setMergePendingDialog({ open: true })}
            >
              Merge Pending ({selectedPendingIds.length})
            </Button>
              </>
            )}
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<MergeType />}
              disabled={mergeAllBusy || bulkBusy}
              onClick={() =>
                setMergeAllDialog({ open: true, beforeDateTime: formatIstDateTimeLocal() })
              }
            >
              {mergeAllBusy ? 'Merging…' : 'Merge by retailer'}
            </Button>
            {selectedIds.length > 0 && (
            <>
            <Button
              size="small"
              variant="contained"
              startIcon={<LocalShipping />}
              disabled={bulkBusy || selectedFulfillmentIds.length === 0}
              onClick={() =>
                setBulkDispatchDialog({
                  open: true,
                  courierName: '',
                  trackingNumber: '',
                  notes: '',
                })
              }
            >
              Mark In Transit ({selectedFulfillmentIds.length})
            </Button>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircle />}
              disabled={bulkBusy || selectedTransitIds.length === 0}
              onClick={() => setBulkDeliverDialog({ open: true })}
            >
              Mark Delivered ({selectedTransitIds.length})
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<Undo />}
              disabled={bulkBusy || selectedUnfulfillIds.length === 0}
              onClick={() => void handleBulkUnfulfill()}
            >
              Un-fulfill ({selectedUnfulfillIds.length})
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Download />}
              disabled={bulkBusy || selectedIds.length === 0}
              onClick={() => void handleDownloadSelectedStores()}
            >
              Download store list
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<Download />}
              disabled={bulkBusy || selectedIds.length === 0}
              onClick={() => void handleDownloadSelectedShortItems()}
            >
              Download short items
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={bulkBusy}
              onClick={() => setSelectedById({})}
            >
              Clear selection
            </Button>
            {selectedPendingIds.length >= 2 && !canMergePending && (
              <Typography variant="caption" color="warning.main" sx={{ width: '100%' }}>
                Merge needs 2+ Pending orders for the same retailer (check Town / store).
              </Typography>
            )}
            </>
            )}
          </Toolbar>
          {bulkBusy && <LinearProgress />}
        </Paper>
      )}

      {/* Orders Table */}
      <TableContainer component={Paper}>
        {isBusy && <LinearProgress />}
        <Table>
          <TableHead>
            <TableRow>
              {canEditOrders && (
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={someSelectableOnPageSelected}
                    checked={allSelectableOnPageSelected}
                    disabled={selectableRowsOnPage.length === 0 || bulkBusy}
                    onChange={toggleSelectAllOnPage}
                    inputProps={{ 'aria-label': 'Select all eligible orders on this page' }}
                  />
                </TableCell>
              )}
              <SortableTableHeadCell columnId="id" label="Order ID" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="orderDate" label="Date & Time" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="storeName" label="Store Name" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="townDistrict" label="Town / District" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="retailer" label="Email" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="items" label="Items" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="amount" label="Amount" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <SortableTableHeadCell columnId="status" label="Status" sortKey={sortKey} sortDirection={sortDirection} onRequestSort={requestSortResetPage} />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEditOrders ? 10 : 9} align="center">
                  <Typography color="textSecondary" sx={{ py: 3 }}>No orders found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((order) => {
                const selectable = canEditOrders && isBulkSelectableStatus(order.status);
                const selected = Boolean(selectedById[order.id]);
                return (
                <TableRow
                  key={order.id}
                  hover
                  selected={selected}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      openOrder(order.id, true);
                      return;
                    }
                    openOrder(order.id);
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openOrder(order.id, true);
                    }
                  }}
                  sx={{ cursor: 'pointer' }}
                >
                  {canEditOrders && (
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected}
                        disabled={!selectable || bulkBusy}
                        onChange={() => toggleRowSelected(order)}
                        inputProps={{ 'aria-label': `Select order ${order.id}` }}
                      />
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Link
                      component={RouterLink}
                      to={`/orders/${order.id}`}
                      underline="hover"
                    >
                      #{formatOrderNumberForDisplay(order.id)}
                    </Link>
                  </TableCell>
                  <TableCell>{format(order.orderDate, 'MMM dd, yyyy hh:mm a')}</TableCell>
                  <TableCell>{order.storeName}</TableCell>
                  <TableCell>{order.townDistrict}</TableCell>
                  <TableCell>{order.retailerEmail || 'N/A'}</TableCell>
                  <TableCell>{order.itemCount} items</TableCell>
                  <TableCell>
                    {isAwaitingFulfillmentStatus(order.status) ? (
                      <Typography variant="caption" color="textSecondary">-</Typography>
                    ) : (
                      <>₹{order.totalAmount.toFixed(2)}</>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                      <Chip
                        label={order.status}
                        color={getStatusColor(order.status) as any}
                        size="small"
                        sx={{ fontWeight: 'bold' }}
                      />
                      {printedInvoiceIds.has(order.id) && (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label="Printed"
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="View order">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => openOrder(order.id)}
                        aria-label={`View order ${order.id}`}
                      >
                        <Visibility />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Open in new tab">
                      <IconButton
                        size="small"
                        color="primary"
                        component={RouterLink}
                        to={`/orders/${order.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open order ${order.id} in a new tab`}
                      >
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canEditOrders && !isCancelledOrderStatus(order.status) && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setCancelDialog({ open: true, orderId: order.id, reason: '' });
                        }}
                      >
                        <Cancel />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {totalCount > 0 && (
        <Box display="flex" justifyContent="center" alignItems="center" mt={3} mb={2} flexWrap="wrap" gap={2}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="orders-rows-per-page-label">Per page</InputLabel>
            <Select
              labelId="orders-rows-per-page-label"
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
            Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, totalCount)} of {totalCount} orders
          </Typography>
        </Box>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ ...cancelDialog, open: false })}>
        <DialogTitle>Cancel Order</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Are you sure you want to cancel order #{formatOrderNumberForDisplay(cancelDialog.orderId)}?
            If stock was deducted, it will be restored to inventory.
          </Typography>
          <FormControl fullWidth sx={{ mt: 2 }} required>
            <InputLabel id="cancel-order-reason-label">Reason for cancellation</InputLabel>
            <Select
              labelId="cancel-order-reason-label"
              label="Reason for cancellation"
              value={cancelDialog.reason}
              onChange={(e) => setCancelDialog({ ...cancelDialog, reason: e.target.value })}
            >
              {ORDER_CANCEL_REASONS.map((reason) => (
                <MenuItem key={reason} value={reason}>
                  {reason}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialog({ ...cancelDialog, open: false })}>Keep Order</Button>
          <Button 
            variant="contained" 
            color="error" 
            onClick={handleCancelOrder}
            disabled={!cancelDialog.reason || cancelOrderMutation.isPending}
          >
            Cancel Order
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={bulkDispatchDialog.open}
        onClose={() => !bulkBusy && setBulkDispatchDialog((p) => ({ ...p, open: false }))}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Mark orders In Transit</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Dispatch {selectedFulfillmentIds.length} fulfilled order(s). Courier and tracking are
            optional and applied to every selected order.
          </Typography>
          <TextField
            fullWidth
            label="Courier name"
            value={bulkDispatchDialog.courierName}
            onChange={(e) =>
              setBulkDispatchDialog((p) => ({ ...p, courierName: e.target.value }))
            }
            sx={{ mt: 2 }}
            disabled={bulkBusy}
          />
          <TextField
            fullWidth
            label="Tracking number"
            value={bulkDispatchDialog.trackingNumber}
            onChange={(e) =>
              setBulkDispatchDialog((p) => ({ ...p, trackingNumber: e.target.value }))
            }
            sx={{ mt: 2 }}
            disabled={bulkBusy}
          />
          <TextField
            fullWidth
            label="Dispatch notes"
            multiline
            rows={2}
            value={bulkDispatchDialog.notes}
            onChange={(e) => setBulkDispatchDialog((p) => ({ ...p, notes: e.target.value }))}
            sx={{ mt: 2 }}
            disabled={bulkBusy}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setBulkDispatchDialog((p) => ({ ...p, open: false }))}
            disabled={bulkBusy}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<LocalShipping />}
            onClick={() => void handleBulkDispatchConfirm()}
            disabled={bulkBusy || selectedFulfillmentIds.length === 0}
          >
            {bulkBusy ? 'Updating…' : `Mark In Transit (${selectedFulfillmentIds.length})`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={bulkDeliverDialog.open}
        onClose={() => !bulkBusy && setBulkDeliverDialog({ open: false })}
      >
        <DialogTitle>Mark orders Delivered</DialogTitle>
        <DialogContent>
          <Typography>
            Confirm delivery for {selectedTransitIds.length} in-transit order(s)? Each store will
            receive its tax invoice by email.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeliverDialog({ open: false })} disabled={bulkBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<CheckCircle />}
            onClick={() => void handleBulkDeliverConfirm()}
            disabled={bulkBusy || selectedTransitIds.length === 0}
          >
            {bulkBusy ? 'Updating…' : `Mark Delivered (${selectedTransitIds.length})`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={mergeAllDialog.open}
        onClose={() => !mergeAllBusy && setMergeAllDialog({ open: false, beforeDateTime: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Merge pending orders by retailer</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Choose a cutoff. Every pending order placed before that time is combined per retailer
            into that retailer&apos;s latest order. Same medicines add their quantities. A retailer
            with only one pending order is left unchanged, and orders placed at or after this time
            stay separate.
          </Typography>
          <Box sx={{ mt: 2 }}>
            <IstDateTimeField
              label="Merge orders before"
              value={mergeAllDialog.beforeDateTime}
              onChange={(value) => setMergeAllDialog((prev) => ({ ...prev, beforeDateTime: value }))}
              ampm
              disabled={mergeAllBusy}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setMergeAllDialog({ open: false, beforeDateTime: '' })}
            disabled={mergeAllBusy}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<MergeType />}
            onClick={() => void handleMergeAllPendingConfirm()}
            disabled={mergeAllBusy || !mergeAllDialog.beforeDateTime}
          >
            {mergeAllBusy ? 'Merging…' : 'Merge orders'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={mergePendingDialog.open}
        onClose={() =>
          !bulkBusy &&
          !mergePendingMutation.isPending &&
          setMergePendingDialog({ open: false })
        }
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Merge Pending orders</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Merge {selectedPendingIds.length} Pending orders for <strong>{mergePendingStoreName}</strong>{' '}
            into the latest order. Same medicines combine quantities; source orders are Cancelled-Merged for
            admin audit but are hidden from the retailer (they only see the combined order).
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Orders:{' '}
            {selectedPendingIds.map((id) => `#${formatOrderNumberForDisplay(id)}`).join(', ')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setMergePendingDialog({ open: false })}
            disabled={bulkBusy || mergePendingMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<MergeType />}
            onClick={() => void handleMergePendingConfirm()}
            disabled={bulkBusy || !canMergePending || mergePendingMutation.isPending}
          >
            {bulkBusy || mergePendingMutation.isPending ? 'Merging…' : 'Merge orders'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={pendingExportDialog.open}
        onClose={() =>
          !isExporting && setPendingExportDialog((prev) => ({ ...prev, open: false }))
        }
      >
        <DialogTitle>Export Pending Orders</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the order date &amp; time range (IST). Defaults to one day from 12:00 to 12:00.
          </Typography>
          <Box display="flex" gap={2} flexWrap="wrap" sx={{ pt: 1 }}>
            <IstDateTimeField
              label="From"
              value={pendingExportDialog.fromDateTime}
              onChange={(fromDateTime) =>
                setPendingExportDialog((prev) => ({ ...prev, fromDateTime }))
              }
              disabled={isExporting}
              sx={{ width: 250 }}
            />
            <IstDateTimeField
              label="To"
              value={pendingExportDialog.toDateTime}
              onChange={(toDateTime) =>
                setPendingExportDialog((prev) => ({ ...prev, toDateTime }))
              }
              disabled={isExporting}
              sx={{ width: 250 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPendingExportDialog((prev) => ({ ...prev, open: false }))}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<Download />}
            onClick={() => void handleExportPendingOrders()}
            disabled={
              isExporting ||
              !pendingExportDialog.fromDateTime ||
              !pendingExportDialog.toDateTime
            }
          >
            {isExporting ? 'Exporting…' : 'Download Excel'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={productSummaryDialog.open}
        onClose={() =>
          !isExportingProductSummary &&
          !isPublishingPurchaseList &&
          setProductSummaryDialog((prev) => ({ ...prev, open: false }))
        }
      >
        <DialogTitle>Product Summary</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the order date &amp; time range for Excel download (IST; defaults to one day from
            12:00 to 12:00). Publish uses net remaining need for the selected To calendar date
            (subtracts quantities already found by the Purchase Officer). Open lists are superseded.
            Scheduled auto-publish runs daily at 12:00 and 15:00 IST.
          </Typography>
          <Box display="flex" gap={2} flexWrap="wrap" sx={{ pt: 1 }}>
            <IstDateTimeField
              label="From"
              value={productSummaryDialog.fromDateTime}
              onChange={(fromDateTime) =>
                setProductSummaryDialog((prev) => ({ ...prev, fromDateTime }))
              }
              disabled={isExportingProductSummary || isPublishingPurchaseList}
              sx={{ width: 250 }}
            />
            <IstDateTimeField
              label="To"
              value={productSummaryDialog.toDateTime}
              onChange={(toDateTime) =>
                setProductSummaryDialog((prev) => ({ ...prev, toDateTime }))
              }
              disabled={isExportingProductSummary || isPublishingPurchaseList}
              sx={{ width: 250 }}
            />
          </Box>
          <FormControlLabel
            sx={{ mt: 1, display: 'flex' }}
            control={
              <Checkbox
                checked={productSummaryDialog.markPickedUp}
                onChange={(event) =>
                  setProductSummaryDialog((prev) => ({ ...prev, markPickedUp: event.target.checked }))
                }
                disabled={isExportingProductSummary || isPublishingPurchaseList}
              />
            }
            label="Mark these pending orders as Picked up"
          />
          <FormControlLabel
            sx={{ display: 'flex' }}
            control={
              <Checkbox
                checked={productSummaryDialog.includePickedUp}
                onChange={(event) =>
                  setProductSummaryDialog((prev) => ({
                    ...prev,
                    includePickedUp: event.target.checked,
                  }))
                }
                disabled={isExportingProductSummary || isPublishingPurchaseList}
              />
            }
            label="Include items from orders already picked up"
          />
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            onClick={() => setProductSummaryDialog((prev) => ({ ...prev, open: false }))}
            disabled={isExportingProductSummary || isPublishingPurchaseList}
          >
            Cancel
          </Button>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={() => void handleExportPendingProductSummary()}
            disabled={
              isExportingProductSummary ||
              isPublishingPurchaseList ||
              !productSummaryDialog.fromDateTime ||
              !productSummaryDialog.toDateTime
            }
          >
            {isExportingProductSummary ? 'Exporting...' : 'Download Excel'}
          </Button>
          <Button
            variant="contained"
            startIcon={<Publish />}
            onClick={() => void handlePublishPurchaseList()}
            disabled={
              isExportingProductSummary ||
              isPublishingPurchaseList ||
              !productSummaryDialog.fromDateTime ||
              !productSummaryDialog.toDateTime
            }
          >
            {isPublishingPurchaseList ? 'Publishing...' : 'Publish to Purchase App'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

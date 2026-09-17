import type { OrderStatus } from '../types';
import type { SortDirection } from './tableSort';

const STORAGE_KEY = 'simplipharma.ordersListView';

const PAGE_SIZES = new Set([20, 50, 100]);
const STATUSES = new Set<OrderStatus | 'All'>([
  'All',
  'Pending',
  'Order Fulfillment',
  'In Transit',
  'Delivered',
  'Cancelled',
]);
const SORT_KEYS = new Set([
  'id',
  'orderDate',
  'storeName',
  'townDistrict',
  'retailer',
  'items',
  'amount',
  'status',
]);

export type OrdersListViewState = {
  searchTerm: string;
  statusFilter: OrderStatus | 'All';
  fromDateFilter: string;
  toDateFilter: string;
  page: number;
  rowsPerPage: number;
  sortKey: string;
  sortDirection: SortDirection;
};

export function loadOrdersListView(): Partial<OrdersListViewState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<OrdersListViewState>;
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Partial<OrdersListViewState> = {};
    if (typeof parsed.searchTerm === 'string') out.searchTerm = parsed.searchTerm;
    if (parsed.statusFilter && STATUSES.has(parsed.statusFilter)) {
      out.statusFilter = parsed.statusFilter;
    }
    if (typeof parsed.fromDateFilter === 'string') out.fromDateFilter = parsed.fromDateFilter;
    if (typeof parsed.toDateFilter === 'string') out.toDateFilter = parsed.toDateFilter;
    if (typeof parsed.page === 'number' && Number.isFinite(parsed.page) && parsed.page >= 1) {
      out.page = Math.floor(parsed.page);
    }
    if (typeof parsed.rowsPerPage === 'number' && PAGE_SIZES.has(parsed.rowsPerPage)) {
      out.rowsPerPage = parsed.rowsPerPage;
    }
    if (typeof parsed.sortKey === 'string' && SORT_KEYS.has(parsed.sortKey)) {
      out.sortKey = parsed.sortKey;
    }
    if (parsed.sortDirection === 'asc' || parsed.sortDirection === 'desc') {
      out.sortDirection = parsed.sortDirection;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveOrdersListView(state: OrdersListViewState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

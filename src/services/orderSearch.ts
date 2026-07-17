import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { OrderStatus } from '../types';

/** Lightweight row rendered by the Orders table (fields come straight from the Typesense index). */
export interface OrderSearchRow {
  id: string;
  retailerEmail: string;
  retailerName: string;
  invoiceNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  /** Order date as epoch milliseconds. */
  orderDate: number;
  itemCount: number;
  totalAmount: number;
}

export interface OrderSearchResult {
  orders: OrderSearchRow[];
  found: number;
  page: number;
  perPage: number;
  statusCounts: Record<string, number>;
  source: 'typesense';
}

export interface OrderSearchParams {
  query?: string;
  status?: OrderStatus | 'All';
  /** Filter by payment status (used by the Invoices page). */
  paymentStatus?: 'Paid' | 'Unpaid' | 'Partial' | 'All';
  /** Only orders that have an invoice (excludes Pending + Cancelled). */
  invoicedOnly?: boolean;
  /** Typesense field name to sort by. */
  sortField?:
    | 'docId'
    | 'orderDate'
    | 'retailerEmail'
    | 'retailerName'
    | 'itemCount'
    | 'amountSortable'
    | 'status'
    | 'invoiceNumber'
    | 'paymentStatus';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
  /** yyyy-MM-dd in IST — inclusive lower bound on orderDate */
  fromDate?: string;
  /** yyyy-MM-dd in IST — inclusive upper bound on orderDate */
  toDate?: string;
}

const searchOrdersCallable = httpsCallable(functions, 'searchOrdersTypesense', {
  timeout: 60000,
});

const reindexOrdersCallable = httpsCallable(functions, 'adminReindexOrdersTypesense', {
  timeout: 540000,
});

export async function searchOrdersTypesense(
  params: OrderSearchParams
): Promise<OrderSearchResult> {
  const res = await searchOrdersCallable({
    query: params.query ?? '',
    status: params.status ?? 'All',
    paymentStatus: params.paymentStatus ?? 'All',
    invoicedOnly: params.invoicedOnly ?? false,
    sortField: params.sortField ?? 'orderDate',
    sortOrder: params.sortOrder ?? 'desc',
    page: params.page ?? 1,
    perPage: params.perPage ?? 10,
    fromDate: params.fromDate ?? '',
    toDate: params.toDate ?? '',
  });
  const data = (res.data ?? {}) as Partial<OrderSearchResult>;
  return {
    orders: Array.isArray(data.orders) ? (data.orders as OrderSearchRow[]) : [],
    found: typeof data.found === 'number' ? data.found : 0,
    page: typeof data.page === 'number' ? data.page : params.page ?? 1,
    perPage: typeof data.perPage === 'number' ? data.perPage : params.perPage ?? 10,
    statusCounts: (data.statusCounts as Record<string, number>) ?? {},
    source: 'typesense',
  };
}

export async function reindexOrdersTypesense(): Promise<{
  ok: boolean;
  indexed: number;
  totalDocs: number;
}> {
  const res = await reindexOrdersCallable({});
  return res.data as { ok: boolean; indexed: number; totalDocs: number };
}

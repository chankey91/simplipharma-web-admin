import type { Order } from '../types';

/**
 * Human-readable retail order ids use prefix ORD (mobile `allocateRetailOrderDocumentId`).
 * Must match MedicineSupplyApp `src/utils/orderDisplay.ts`.
 */
export function formatOrderNumberForDisplay(orderId: string | undefined | null): string {
  const s = (orderId ?? '').trim();
  if (!s) return '—';
  if (s.startsWith('ORD')) return s;
  return s.length <= 10 ? s : `${s.slice(0, 10)}…`;
}

/**
 * When there is no `invoiceNumber`: use canonical ORD… doc id as-is,
 * otherwise legacy `ORD-{first 8 of random Firestore id}`.
 */
export function orderReferenceWithoutInvoice(orderId: string | undefined | null): string {
  const s = (orderId ?? '').trim();
  if (!s) return 'ORD-UNKNOWN';
  if (s.startsWith('ORD')) return s;
  return `ORD-${s.slice(0, 8).toUpperCase()}`;
}

/** Invoice / reference label shown to retailers and admins. */
export function formatOrderInvoiceLabel(order: Pick<Order, 'id' | 'invoiceNumber'>): string {
  if (order.invoiceNumber) return order.invoiceNumber;
  return orderReferenceWithoutInvoice(order.id);
}

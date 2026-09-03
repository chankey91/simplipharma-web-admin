import { Order, User } from '../types';
import {
  buildStoreReceivableSummaries,
  formatOrderInvoiceLabel,
  type StoreReceivableSummary,
} from './storeReceivables';

export type SoReceivableSummary = {
  /** Empty string = unassigned retailers */
  salesOfficerId: string;
  salesOfficer: User | null;
  displayName: string;
  phoneNumber: string;
  email: string;
  retailerCount: number;
  orderCount: number;
  totalOutstanding: number;
  oldestOrderDate: Date | null;
  retailers: StoreReceivableSummary[];
};

const formatInr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Group store receivable summaries by the retailer's assigned Sales Officer.
 * Retailers with no SO go under the Unassigned bucket (salesOfficerId === '').
 */
export function buildSoReceivableSummaries(
  orders: Order[],
  stores: User[],
  salesOfficers: User[]
): SoReceivableSummary[] {
  const storeSummaries = buildStoreReceivableSummaries(orders, stores);
  const soById = new Map(salesOfficers.map((so) => [so.id, so]));
  const bySo = new Map<string, StoreReceivableSummary[]>();

  for (const row of storeSummaries) {
    const soId = String(row.store?.salesOfficerId || '').trim();
    const list = bySo.get(soId) ?? [];
    list.push(row);
    bySo.set(soId, list);
  }

  const summaries: SoReceivableSummary[] = [];
  for (const [salesOfficerId, retailers] of bySo) {
    retailers.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    const so = salesOfficerId ? soById.get(salesOfficerId) ?? null : null;
    const dates = retailers
      .map((r) => r.oldestOrderDate)
      .filter((d): d is Date => d != null && !isNaN(d.getTime()));
    summaries.push({
      salesOfficerId,
      salesOfficer: so,
      displayName: salesOfficerId
        ? so?.displayName || so?.email || salesOfficerId
        : 'Unassigned',
      phoneNumber: so?.phoneNumber || '',
      email: so?.email || '',
      retailerCount: retailers.length,
      orderCount: retailers.reduce((s, r) => s + r.orderCount, 0),
      totalOutstanding: retailers.reduce((s, r) => s + r.totalOutstanding, 0),
      oldestOrderDate: dates.length
        ? new Date(Math.min(...dates.map((d) => d.getTime())))
        : null,
      retailers,
    });
  }

  return summaries.sort((a, b) => {
    if (!a.salesOfficerId && b.salesOfficerId) return 1;
    if (a.salesOfficerId && !b.salesOfficerId) return -1;
    return b.totalOutstanding - a.totalOutstanding;
  });
}

/** WhatsApp body for one SO: total + retailer dues + top open bills. */
export function formatSoDuesWhatsAppMessage(summary: SoReceivableSummary): string {
  const lines: string[] = [
    `SimpliPharma — Outstanding dues update`,
    `Sales Officer: ${summary.displayName}`,
    `Total due: ${formatInr(summary.totalOutstanding)}`,
    `Stores with dues: ${summary.retailerCount} | Open bills: ${summary.orderCount}`,
    '',
  ];

  for (const retailer of summary.retailers) {
    lines.push(
      `• ${retailer.displayName} (${retailer.storeCode}) — ${formatInr(retailer.totalOutstanding)}`
    );
    const topBills = retailer.orders.slice(0, 5);
    for (const bill of topBills) {
      const inv = formatOrderInvoiceLabel(bill);
      lines.push(`   - ${inv}: ${formatInr(bill.outstanding)}`);
    }
    if (retailer.orders.length > 5) {
      lines.push(`   - … +${retailer.orders.length - 5} more bill(s)`);
    }
  }

  lines.push('', 'Please follow up with the stores and update collections. Thank you.');
  return lines.join('\n');
}

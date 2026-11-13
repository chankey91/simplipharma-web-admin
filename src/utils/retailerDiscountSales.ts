import { Order, OrderMedicine, User } from '../types';
import { coerceToDate } from './dateTime';
import { formatOrderInvoiceLabel } from './orderDisplay';
import {
  orderLineAmountAfterDiscount,
  orderLineTaxableBeforeDiscount,
} from './orderLineInvoiceEconomics';

const SOLD_STATUSES = new Set<Order['status']>(['Order Fulfillment', 'In Transit', 'Delivered']);

const round2 = (n: number) => Math.round(n * 100) / 100;

function saleDiscountPct(item: OrderMedicine): number {
  const n = Number(item.discountPercentage);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type RetailerDiscountSaleLine = {
  orderId: string;
  invoiceLabel: string;
  orderDate: Date;
  medicineName: string;
  quantity: number;
  discountPct: number;
  discountAmount: number;
  lineAmount: number;
  offerTitle?: string;
};

export type RetailerDiscountSaleGroup = {
  retailerId: string;
  displayName: string;
  storeCode: string;
  lineCount: number;
  discountAmount: number;
  lineAmount: number;
  lines: RetailerDiscountSaleLine[];
};

/**
 * Sales to retailers in the loaded orders.
 * A line counts only when the retailer invoice discount is above zero.
 */
export function buildRetailerDiscountSales(
  orders: Order[],
  stores: User[]
): RetailerDiscountSaleGroup[] {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const linesByRetailer = new Map<string, RetailerDiscountSaleLine[]>();

  for (const order of orders) {
    if (!SOLD_STATUSES.has(order.status)) continue;
    const retailerId = (order.retailerId || '').trim();
    if (!retailerId) continue;
    const orderDate = coerceToDate(order.orderDate);
    if (!orderDate) continue;

    for (const item of order.medicines || []) {
      const discountPct = saleDiscountPct(item);
      if (discountPct <= 0) continue;
      if (item.lineType === 'product_demand' && !item.medicineId && !item.name) continue;

      const before = orderLineTaxableBeforeDiscount(
        item,
        undefined,
        order.taxPercentage,
        undefined,
        { lockPersistedDiscount: true }
      );
      const after = orderLineAmountAfterDiscount(
        item,
        undefined,
        order.taxPercentage,
        undefined,
        { lockPersistedDiscount: true }
      );
      const discountAmount = round2(Math.max(0, before - after));
      if (discountAmount <= 0.009 && before <= 0.009) continue;

      const line: RetailerDiscountSaleLine = {
        orderId: order.id,
        invoiceLabel: formatOrderInvoiceLabel(order),
        orderDate,
        medicineName: item.name || '—',
        quantity: Number(item.quantity) || 0,
        discountPct,
        discountAmount,
        lineAmount: round2(after),
        offerTitle: item.appliedOfferTitle?.trim() || undefined,
      };
      const list = linesByRetailer.get(retailerId);
      if (list) list.push(line);
      else linesByRetailer.set(retailerId, [line]);
    }
  }

  const groups: RetailerDiscountSaleGroup[] = [];
  for (const [retailerId, lines] of linesByRetailer) {
    const store = storeById.get(retailerId) ?? null;
    const sorted = [...lines].sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime());
    groups.push({
      retailerId,
      displayName: store?.shopName || store?.displayName || retailerId,
      storeCode: store?.storeCode || '—',
      lineCount: sorted.length,
      discountAmount: round2(sorted.reduce((s, l) => s + l.discountAmount, 0)),
      lineAmount: round2(sorted.reduce((s, l) => s + l.lineAmount, 0)),
      lines: sorted,
    });
  }

  return groups.sort((a, b) => b.discountAmount - a.discountAmount || a.displayName.localeCompare(b.displayName));
}

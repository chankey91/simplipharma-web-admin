/**
 * Product list for planning a retailer offer.
 * Purchase averages use line discount and scheme only. Invoice additional discount is not split onto products.
 * Sale margin uses the same ex-GST line math as the margin report.
 */
import type { Order, PurchaseInvoice } from '../types';
import { orderLineInvoiceEconomics } from './orderLineInvoiceEconomics';
import { orderLineCogsExGst, orderLineNetSalesExGst } from './orderLineMargin';
import {
  buildPurchaseLandedCostLookup,
  type PurchaseLandedCostLookup,
} from './purchaseInvoiceLandedCost';

const toNum = (v: unknown): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export type OfferMarginRow = {
  key: string;
  medicineId: string;
  name: string;
  purchasePaidQty: number;
  purchaseFreeQty: number;
  purchaseBase: number;
  purchaseDiscountAmt: number;
  purchaseNetAmount: number;
  soldQty: number;
  saleBase: number;
  saleDiscountAmt: number;
  netSalesExGst: number;
  cogsExGst: number;
  grossProfitExGst: number;
};

export type OfferMarginView = OfferMarginRow & {
  avgPurchaseDiscountPct: number | null;
  avgLandedCost: number | null;
  schemePer10: number | null;
  avgSaleDiscountPct: number | null;
  marginPct: number | null;
  roomPct: number | null;
};

function productKey(medicineId: string | undefined, name: string | undefined): string {
  const id = String(medicineId || '').trim();
  if (id) return id;
  const label = String(name || '').trim().toLowerCase();
  return label ? `name:${label}` : '';
}

function blankRow(key: string, name: string, medicineId: string): OfferMarginRow {
  return {
    key,
    medicineId,
    name,
    purchasePaidQty: 0,
    purchaseFreeQty: 0,
    purchaseBase: 0,
    purchaseDiscountAmt: 0,
    purchaseNetAmount: 0,
    soldQty: 0,
    saleBase: 0,
    saleDiscountAmt: 0,
    netSalesExGst: 0,
    cogsExGst: 0,
    grossProfitExGst: 0,
  };
}

export function aggregateOfferMargin(
  invoices: PurchaseInvoice[],
  orders: Order[],
  medicines: Map<string, any>
): OfferMarginRow[] {
  const rows = new Map<string, OfferMarginRow>();
  const touch = (key: string, name: string, medicineId: string) => {
    let row = rows.get(key);
    if (!row) {
      row = blankRow(key, name || 'Product', medicineId);
      rows.set(key, row);
    } else if (name && (row.name === 'Product' || row.name.length < name.length)) {
      row.name = name;
    }
    return row;
  };

  for (const invoice of invoices) {
    for (const item of invoice.items || []) {
      const key = productKey(item.medicineId, item.medicineName);
      if (!key) continue;
      const paid = toNum(item.quantity);
      const free = toNum(item.freeQuantity);
      const price = toNum(item.purchasePrice);
      if (paid <= 0 || price <= 0) continue;
      const base = price * paid;
      const discountAmt = (base * toNum(item.discountPercentage)) / 100;
      const row = touch(key, item.medicineName, item.medicineId || '');
      row.purchasePaidQty += paid;
      row.purchaseFreeQty += free;
      row.purchaseBase += base;
      row.purchaseDiscountAmt += discountAmt;
      row.purchaseNetAmount += base - discountAmt;
    }
  }

  const purchaseLookup: PurchaseLandedCostLookup = buildPurchaseLandedCostLookup(invoices);

  for (const order of orders) {
    if (order.status === 'Cancelled') continue;
    for (const item of order.medicines ?? []) {
      const hasBatch =
        Boolean(item.batchNumber) ||
        (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0);
      if (!hasBatch) continue;
      const key = productKey(item.medicineId, item.name);
      if (!key) continue;
      const med = item.medicineId ? medicines.get(item.medicineId) : undefined;
      const econ = orderLineInvoiceEconomics(item, med, order.taxPercentage);
      const net = orderLineNetSalesExGst(item, med, order.taxPercentage);
      const cogs = orderLineCogsExGst(item, med, purchaseLookup);
      const saleBase = econ.unitPrice * econ.paidQty;
      const row = touch(key, item.name, item.medicineId || '');
      row.soldQty += econ.totalO > 0 ? econ.totalO : econ.paidQty + econ.freeQty;
      row.saleBase += saleBase;
      row.saleDiscountAmt += (saleBase * econ.discountPct) / 100;
      row.netSalesExGst += net;
      row.cogsExGst += cogs;
      row.grossProfitExGst += net - cogs;
    }
  }

  return [...rows.values()];
}

export function toOfferMarginView(row: OfferMarginRow, extraDiscountPct: number): OfferMarginView {
  const physical = row.purchasePaidQty + row.purchaseFreeQty;
  const avgPurchaseDiscountPct =
    row.purchaseBase > 0 ? (row.purchaseDiscountAmt / row.purchaseBase) * 100 : null;
  const avgLandedCost = physical > 0 ? row.purchaseNetAmount / physical : null;
  const schemePer10 = row.purchasePaidQty > 0 ? (row.purchaseFreeQty / row.purchasePaidQty) * 10 : null;
  const avgSaleDiscountPct = row.saleBase > 0 ? (row.saleDiscountAmt / row.saleBase) * 100 : null;
  const marginPct = row.netSalesExGst > 0 ? (row.grossProfitExGst / row.netSalesExGst) * 100 : null;
  const roomPct = marginPct === null ? null : marginPct - extraDiscountPct;
  return {
    ...row,
    avgPurchaseDiscountPct,
    avgLandedCost,
    schemePer10,
    avgSaleDiscountPct,
    marginPct,
    roomPct,
  };
}

export function formatSchemePer10(schemePer10: number | null): string {
  if (schemePer10 === null || schemePer10 <= 0) return '—';
  const rounded = Math.round(schemePer10 * 10) / 10;
  return `10+${rounded}`;
}

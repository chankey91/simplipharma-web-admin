import { Order } from '../types';
import {
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';

export type DemandPeriodPreset =
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'custom';

export type MedicineDemandRow = {
  medicineId: string;
  medicineName: string;
  qtySold: number;
  orderCount: number;
  /** Approximate revenue using order line price × qty (ex-GST rate if stored as such). */
  amount: number;
  /** Average units per day over the selected period. */
  avgPerDay: number;
  /** Projected weekly need from avgPerDay × 7. */
  projectedWeekly: number;
  currentStock: number;
  /** How many units short vs projected weekly need (stock − projectedWeekly, negative = need more). */
  stockGapVsWeekly: number;
};

const COUNTED_STATUSES = new Set([
  'Order Fulfillment',
  'In Transit',
  'Delivered',
]);

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function lineSoldQty(med: {
  lineType?: string;
  medicineId?: string;
  quantity?: number;
  batchAllocations?: Array<{ quantity?: number }>;
}): number {
  if (med.lineType === 'product_demand' && !med.medicineId?.trim()) return 0;
  if (!med.medicineId?.trim()) return 0;
  const allocs = med.batchAllocations?.filter((a) => toNum(a.quantity) > 0);
  if (allocs && allocs.length > 0) {
    return allocs.reduce((s, a) => s + Math.floor(toNum(a.quantity)), 0);
  }
  return Math.max(0, Math.floor(toNum(med.quantity)));
}

export function demandPeriodRange(
  preset: DemandPeriodPreset,
  customFrom?: Date | null,
  customTo?: Date | null
): { startMs: number; endMs: number; label: string; daySpan: number } {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (preset) {
    case 'this_week':
      start = startOfWeek(now, { weekStartsOn: 1 });
      end = endOfDay(now);
      break;
    case 'last_week': {
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      start = lastWeekStart;
      end = endOfDay(subDays(startOfWeek(now, { weekStartsOn: 1 }), 1));
      break;
    }
    case 'this_month':
      start = startOfMonth(now);
      end = endOfDay(now);
      break;
    case 'last_month':
      start = startOfMonth(subMonths(now, 1));
      end = endOfMonth(subMonths(now, 1));
      break;
    case 'last_30_days':
      start = startOfDay(subDays(now, 29));
      end = endOfDay(now);
      break;
    case 'last_90_days':
      start = startOfDay(subDays(now, 89));
      end = endOfDay(now);
      break;
    case 'custom':
    default:
      start = customFrom ? startOfDay(customFrom) : startOfDay(subDays(now, 29));
      end = customTo ? endOfDay(customTo) : endOfDay(now);
      break;
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const daySpan = Math.max(1, Math.ceil((endMs - startMs) / 86_400_000));

  const labelMap: Record<DemandPeriodPreset, string> = {
    this_week: 'This week',
    last_week: 'Last week',
    this_month: 'This month',
    last_month: 'Last month',
    last_30_days: 'Last 30 days',
    last_90_days: 'Last 90 days',
    custom: 'Custom range',
  };

  return { startMs, endMs, label: labelMap[preset], daySpan };
}

/**
 * Aggregate medicine sales from orders in range (fulfilled / dispatched / delivered).
 * Stock fields filled later when inventory is hydrated.
 */
export function aggregateMedicineDemand(
  orders: Order[],
  startMs: number,
  endMs: number,
  daySpan: number
): Omit<MedicineDemandRow, 'currentStock' | 'stockGapVsWeekly' | 'projectedWeekly' | 'avgPerDay'>[] {
  type Acc = {
    medicineId: string;
    medicineName: string;
    qtySold: number;
    amount: number;
    orderIds: Set<string>;
  };
  const byId = new Map<string, Acc>();

  for (const order of orders) {
    if (!COUNTED_STATUSES.has(String(order.status || ''))) continue;
    const od =
      order.orderDate instanceof Date
        ? order.orderDate
        : new Date(order.orderDate as string | number);
    const t = od.getTime();
    if (!Number.isFinite(t) || t < startMs || t > endMs) continue;

    for (const med of order.medicines || []) {
      const qty = lineSoldQty(med);
      if (qty <= 0) continue;
      const medicineId = String(med.medicineId || '').trim();
      if (!medicineId) continue;
      const price = toNum(med.price);
      const prev = byId.get(medicineId);
      if (prev) {
        prev.qtySold += qty;
        prev.amount += price * qty;
        prev.orderIds.add(order.id);
        if (!prev.medicineName && med.name) prev.medicineName = med.name;
      } else {
        byId.set(medicineId, {
          medicineId,
          medicineName: med.name || medicineId,
          qtySold: qty,
          amount: price * qty,
          orderIds: new Set([order.id]),
        });
      }
    }
  }

  return [...byId.values()]
    .map((a) => ({
      medicineId: a.medicineId,
      medicineName: a.medicineName,
      qtySold: a.qtySold,
      orderCount: a.orderIds.size,
      amount: Math.round(a.amount * 100) / 100,
    }))
    .sort((a, b) => b.qtySold - a.qtySold);
}

export function attachStockToDemandRows(
  rows: Omit<MedicineDemandRow, 'currentStock' | 'stockGapVsWeekly' | 'projectedWeekly' | 'avgPerDay'>[],
  stockByMedicineId: Map<string, number>,
  daySpan: number
): MedicineDemandRow[] {
  const days = Math.max(1, daySpan);
  return rows.map((r) => {
    const avgPerDay = r.qtySold / days;
    const projectedWeekly = Math.round(avgPerDay * 7 * 100) / 100;
    const currentStock = stockByMedicineId.get(r.medicineId) ?? 0;
    return {
      ...r,
      avgPerDay: Math.round(avgPerDay * 100) / 100,
      projectedWeekly,
      currentStock,
      stockGapVsWeekly: Math.round((currentStock - projectedWeekly) * 100) / 100,
    };
  });
}

import { startOfMonth, isBefore, endOfMonth, subMonths, isWithinInterval } from 'date-fns';

export type MarginPeriodFilter = 'this_month' | 'last_month' | 'all';

export function coerceToDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export function dateInMarginPeriod(date: Date, period: MarginPeriodFilter): boolean {
  const now = new Date();
  if (period === 'all') return true;
  if (period === 'this_month') {
    const start = startOfMonth(now);
    return !isBefore(date, start);
  }
  const lastStart = startOfMonth(subMonths(now, 1));
  const lastEnd = endOfMonth(subMonths(now, 1));
  return isWithinInterval(date, { start: lastStart, end: lastEnd });
}

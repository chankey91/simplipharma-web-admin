/** Business timezone for SimpliPharma (India). */
export const APP_TIMEZONE = 'Asia/Kolkata';

export function coerceToDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar "today" as yyyy-MM-dd in IST — use for date input defaults. */
export function getTodayDateStringIST(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(date);
}

/** Compact yyyyMMdd in IST — export filenames, stamps. */
export function istDateStampCompact(date: Date = new Date()): string {
  return getTodayDateStringIST(date).replace(/-/g, '');
}

export function getYearIST(date: Date = new Date()): number {
  return parseInt(formatInIST(date, { year: 'numeric' }), 10);
}

export function formatInIST(
  date: Date | unknown,
  options: Intl.DateTimeFormatOptions
): string {
  const d = coerceToDate(date);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIMEZONE, ...options }).format(d);
}

export function formatDateLongIST(date: Date = new Date()): string {
  return formatInIST(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateIST(date: Date | unknown): string {
  return formatInIST(date, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTimeIST(date: Date | unknown): string {
  return formatInIST(date, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Parse yyyy-MM-dd as noon IST (stable calendar date for Firestore). */
export function dateFromISTDateString(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00+05:30`);
}

export function getTodayStartIST(): Date {
  return dateFromISTDateString(getTodayDateStringIST());
}

/** Inclusive IST calendar range; endMsExclusive suits Firestore/Typesense `<` upper bound. */
export function istDateRangeBounds(
  fromDate: string,
  toDate: string
): { startMs: number; endMsExclusive: number } {
  const startMs = new Date(`${fromDate}T00:00:00+05:30`).getTime();
  const endMsExclusive = new Date(`${toDate}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000;
  return { startMs, endMsExclusive };
}

export function istDayStartMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00+05:30`).getTime();
}

export function istDayEndExclusiveMs(dateStr: string): number {
  return istDayStartMs(dateStr) + 24 * 60 * 60 * 1000;
}

/** True when orderDate falls in [fromDate, toDate] inclusive (IST calendar days). */
export function isDateInIstRange(
  orderDate: unknown,
  fromDate?: string,
  toDate?: string
): boolean {
  if (!fromDate && !toDate) return true;
  const d = coerceToDate(orderDate);
  if (!d) return false;
  const t = d.getTime();
  if (fromDate && t < istDayStartMs(fromDate)) return false;
  if (toDate && t >= istDayEndExclusiveMs(toDate)) return false;
  return true;
}

/** `yyyy-MM-ddTHH:mm` in IST for `<input type="datetime-local">`. */
export function formatIstDateTimeLocal(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Parse datetime-local value as IST. Returns epoch ms, or null if invalid. */
export function parseIstDateTimeLocal(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const ms = new Date(`${match[1]}T${match[2]}:${match[3] || '00'}+05:30`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Current 24-hour IST window aligned to noon: last 12:00 through next 12:00.
 * Before noon → yesterday 12:00 to today 12:00; from noon onward → today 12:00 to tomorrow 12:00.
 */
export function getDefaultNoonToNoonRangeIST(now: Date = new Date()): {
  fromDateTime: string;
  toDateTime: string;
} {
  const today = getTodayDateStringIST(now);
  const noonTodayMs = new Date(`${today}T12:00:00+05:30`).getTime();
  const fromMs = now.getTime() >= noonTodayMs ? noonTodayMs : noonTodayMs - 24 * 60 * 60 * 1000;
  const toMs = fromMs + 24 * 60 * 60 * 1000;
  return {
    fromDateTime: formatIstDateTimeLocal(new Date(fromMs)),
    toDateTime: formatIstDateTimeLocal(new Date(toMs)),
  };
}

/** Inclusive last 7 noon-aligned IST days ending at the current 12:00–12:00 window. */
export function getDefaultOrdersFilterRangeIST(now: Date = new Date()): {
  fromDateTime: string;
  toDateTime: string;
} {
  const current = getDefaultNoonToNoonRangeIST(now);
  const fromMs = parseIstDateTimeLocal(current.fromDateTime);
  if (fromMs == null) return current;
  return {
    fromDateTime: formatIstDateTimeLocal(new Date(fromMs - 6 * 24 * 60 * 60 * 1000)),
    toDateTime: current.toDateTime,
  };
}

/** True when orderDate falls in [fromDateTime, toDateTime) IST datetime-local values. */
export function isDateInIstDateTimeRange(
  orderDate: unknown,
  fromDateTime?: string,
  toDateTime?: string
): boolean {
  if (!fromDateTime && !toDateTime) return true;
  const d = coerceToDate(orderDate);
  if (!d) return false;
  const t = d.getTime();
  if (fromDateTime) {
    const start = parseIstDateTimeLocal(fromDateTime);
    if (start != null && t < start) return false;
  }
  if (toDateTime) {
    const end = parseIstDateTimeLocal(toDateTime);
    if (end != null && t >= end) return false;
  }
  return true;
}

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

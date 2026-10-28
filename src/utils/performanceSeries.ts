import { fillIstDateRange } from './dailyBusiness';
import { getTodayDateStringIST, shiftIstDateString } from './dateTime';

export type PerfGrain = 'day' | 'week' | 'month';

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Monday yyyy-MM-dd of the IST week that contains `dateStr`. */
export function istWeekStart(dateStr: string): string {
  const noon = new Date(`${dateStr}T12:00:00+05:30`);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(noon);
  const delta = (WEEKDAYS[weekday] ?? 1) === 0 ? 6 : (WEEKDAYS[weekday] ?? 1) - 1;
  return shiftIstDateString(dateStr, -delta);
}

export function grainBucket(dateStr: string, grain: PerfGrain): string {
  if (grain === 'month') return dateStr.slice(0, 7);
  if (grain === 'week') return istWeekStart(dateStr);
  return dateStr;
}

export function bucketLabel(key: string, grain: PerfGrain): string {
  if (grain === 'month') {
    const [year, month] = key.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  if (grain === 'week') {
    const end = shiftIstDateString(key, 6);
    return `${key.slice(8)} ${monthShort(key)} – ${end.slice(8)} ${monthShort(end)}`;
  }
  return `${key.slice(8)} ${monthShort(key)}`;
}

function monthShort(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });
}

export function defaultFromForGrain(grain: PerfGrain, today = getTodayDateStringIST()): string {
  if (grain === 'week') return shiftIstDateString(today, -55);
  if (grain === 'month') return shiftIstDateString(today, -182);
  return shiftIstDateString(today, -13);
}

export function listBuckets(from: string, to: string, grain: PerfGrain): string[] {
  if (!from || !to || from > to) return [];
  if (grain === 'day') return fillIstDateRange(from, to);
  if (grain === 'month') {
    const keys: string[] = [];
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));
    const endYear = Number(to.slice(0, 4));
    const endMonth = Number(to.slice(5, 7));
    while (year < endYear || (year === endYear && month <= endMonth)) {
      keys.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
    return keys;
  }
  const keys: string[] = [];
  let cursor = istWeekStart(from);
  const end = istWeekStart(to);
  while (cursor <= end) {
    keys.push(cursor);
    cursor = shiftIstDateString(cursor, 7);
  }
  return keys;
}

/** The window of the same length immediately before `from`. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const days = fillIstDateRange(from, to).length || 1;
  const prevTo = shiftIstDateString(from, -1);
  return { from: shiftIstDateString(prevTo, -(days - 1)), to: prevTo };
}

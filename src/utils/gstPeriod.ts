import { getTodayDateStringIST } from './dateTime';

/** Indian financial year helpers (April–March), in IST. */

export function gstYmFromDate(date = new Date()): { year: number; month: number } {
  const iso = getTodayDateStringIST(date);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

export function parseGstPeriodParam(raw?: string | null): { year: number; month: number } | null {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2017 || year > 2100) return null;
  return { year, month };
}

export function gstPeriodParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function dateForGstYm(year: number, month: number): Date {
  return new Date(`${year}-${String(month).padStart(2, '0')}-15T12:00:00+05:30`);
}

export function indianGstPeriod(date = new Date()): {
  fy: string;
  year: number;
  month: number;
  periodId: string;
  param: string;
  label: string;
} {
  const { year, month } = gstYmFromDate(date);
  const fyStart = month >= 4 ? year : year - 1;
  const fy = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
  const monthLabel = dateForGstYm(year, month).toLocaleString('en-IN', {
    month: 'long',
    timeZone: 'Asia/Kolkata',
  });
  return {
    fy,
    year,
    month,
    periodId: `${fy}_${String(month).padStart(2, '0')}`,
    param: gstPeriodParam(year, month),
    label: `${monthLabel} ${year} (${fy})`,
  };
}

export function gstPeriodBounds(date = new Date()): { startMs: number; endMsExclusive: number } {
  const { year, month } = gstYmFromDate(date);
  return gstPeriodBoundsFromYm(year, month);
}

export function gstPeriodBoundsFromYm(year: number, month: number): {
  startMs: number;
  endMsExclusive: number;
} {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return {
    startMs: new Date(`${start}T00:00:00+05:30`).getTime(),
    endMsExclusive: new Date(`${end}T00:00:00+05:30`).getTime(),
  };
}

/** GSTN `fp` / `ret_period` — MMYYYY of the return period. */
export function gstinFilingPeriod(date = new Date()): string {
  const { year, month } = gstYmFromDate(date);
  return `${String(month).padStart(2, '0')}${year}`;
}

export function formatGstinDate(date: Date): string {
  const iso = getTodayDateStringIST(date);
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

export function periodIsLocked(status?: string | null): boolean {
  return Boolean(status && status !== 'open');
}

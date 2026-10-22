import { getTodayDateStringIST } from './dateTime';

/** Indian financial year helpers (April–March), in IST. */

export type GstFilingGrain = 'month' | 'quarter';

export function gstFilingGrain(frequency?: string | null): GstFilingGrain {
  return frequency === 'monthly' ? 'month' : 'quarter';
}

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

/** Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function gstQuarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10) return 3;
  return 4;
}

export function gstQuarterRange(
  year: number,
  month: number
): {
  quarter: 1 | 2 | 3 | 4;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
} {
  const quarter = gstQuarterOfMonth(month);
  if (quarter === 1) return { quarter, startYear: year, startMonth: 4, endYear: year, endMonth: 6 };
  if (quarter === 2) return { quarter, startYear: year, startMonth: 7, endYear: year, endMonth: 9 };
  if (quarter === 3) return { quarter, startYear: year, startMonth: 10, endYear: year, endMonth: 12 };
  return { quarter, startYear: year, startMonth: 1, endYear: year, endMonth: 3 };
}

export function gstQuarterStartForFy(
  fyStartYear: number,
  quarter: 1 | 2 | 3 | 4
): { year: number; month: number } {
  if (quarter === 1) return { year: fyStartYear, month: 4 };
  if (quarter === 2) return { year: fyStartYear, month: 7 };
  if (quarter === 3) return { year: fyStartYear, month: 10 };
  return { year: fyStartYear + 1, month: 1 };
}

export const GST_QUARTER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Apr–Jun',
  2: 'Jul–Sep',
  3: 'Oct–Dec',
  4: 'Jan–Mar',
};

export function snapGstYmToGrain(
  year: number,
  month: number,
  grain: GstFilingGrain = 'quarter'
): { year: number; month: number } {
  if (grain === 'month') return { year, month };
  const range = gstQuarterRange(year, month);
  return { year: range.startYear, month: range.startMonth };
}

export function indianGstPeriod(
  date = new Date(),
  grain: GstFilingGrain = 'quarter'
): {
  fy: string;
  year: number;
  month: number;
  quarter: 1 | 2 | 3 | 4;
  periodId: string;
  param: string;
  label: string;
} {
  const raw = gstYmFromDate(date);
  const { year, month } = snapGstYmToGrain(raw.year, raw.month, grain);
  const fyStart = month >= 4 ? year : year - 1;
  const fy = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
  const quarter = gstQuarterOfMonth(month);
  if (grain === 'month') {
    const monthLabel = dateForGstYm(year, month).toLocaleString('en-IN', {
      month: 'long',
      timeZone: 'Asia/Kolkata',
    });
    return {
      fy,
      year,
      month,
      quarter,
      periodId: `${fy}_${String(month).padStart(2, '0')}`,
      param: gstPeriodParam(year, month),
      label: `${monthLabel} ${year} (${fy})`,
    };
  }
  return {
    fy,
    year,
    month,
    quarter,
    periodId: `${fy}_Q${quarter}`,
    param: gstPeriodParam(year, month),
    label: `Q${quarter} ${fy} (${GST_QUARTER_LABELS[quarter]})`,
  };
}

export function gstPeriodBounds(
  date = new Date(),
  grain: GstFilingGrain = 'quarter'
): { startMs: number; endMsExclusive: number } {
  const { year, month } = gstYmFromDate(date);
  return gstPeriodBoundsFromYm(year, month, grain);
}

export function gstPeriodBoundsFromYm(
  year: number,
  month: number,
  grain: GstFilingGrain = 'quarter'
): {
  startMs: number;
  endMsExclusive: number;
} {
  if (grain === 'month') {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return {
      startMs: new Date(`${start}T00:00:00+05:30`).getTime(),
      endMsExclusive: new Date(`${end}T00:00:00+05:30`).getTime(),
    };
  }
  const range = gstQuarterRange(year, month);
  const start = `${range.startYear}-${String(range.startMonth).padStart(2, '0')}-01`;
  const nextMonth = range.endMonth === 12 ? 1 : range.endMonth + 1;
  const nextYear = range.endMonth === 12 ? range.endYear + 1 : range.endYear;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return {
    startMs: new Date(`${start}T00:00:00+05:30`).getTime(),
    endMsExclusive: new Date(`${end}T00:00:00+05:30`).getTime(),
  };
}

/** GSTN `fp` / `ret_period` — MMYYYY. Quarterly returns use the last month of the quarter. */
export function gstinFilingPeriod(date = new Date(), grain: GstFilingGrain = 'quarter'): string {
  const { year, month } = gstYmFromDate(date);
  if (grain === 'month') {
    return `${String(month).padStart(2, '0')}${year}`;
  }
  const range = gstQuarterRange(year, month);
  return `${String(range.endMonth).padStart(2, '0')}${range.endYear}`;
}

export function formatGstinDate(date: Date): string {
  const iso = getTodayDateStringIST(date);
  const [y, m, day] = iso.split('-');
  return `${day}-${m}-${y}`;
}

export function periodIsLocked(status?: string | null): boolean {
  return Boolean(status && status !== 'open');
}

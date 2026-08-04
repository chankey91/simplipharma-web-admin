import { collection, getDocs, limit, orderBy, query, where } from './firebase';
import { db } from './firebase';

export interface SoVisitLog {
  id: string;
  salesOfficerId: string;
  retailerId: string;
  retailerName?: string;
  note: string;
  visitedAt: Date;
  createdAt?: Date;
  /** GPS captured when the SO logged the visit. */
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}

function parseOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseVisitLogDoc(id: string, data: Record<string, unknown>): SoVisitLog {
  const visitedAtRaw = data.visitedAt as { toDate?: () => Date } | Date | undefined;
  const createdAtRaw = data.createdAt as { toDate?: () => Date } | Date | undefined;
  return {
    id,
    salesOfficerId: String(data.salesOfficerId || ''),
    retailerId: String(data.retailerId || ''),
    retailerName: typeof data.retailerName === 'string' ? data.retailerName : undefined,
    note: typeof data.note === 'string' ? data.note : '',
    visitedAt:
      visitedAtRaw && typeof (visitedAtRaw as { toDate?: () => Date }).toDate === 'function'
        ? (visitedAtRaw as { toDate: () => Date }).toDate()
        : visitedAtRaw instanceof Date
          ? visitedAtRaw
          : new Date(String(visitedAtRaw || Date.now())),
    createdAt:
      createdAtRaw && typeof (createdAtRaw as { toDate?: () => Date }).toDate === 'function'
        ? (createdAtRaw as { toDate: () => Date }).toDate()
        : createdAtRaw instanceof Date
          ? createdAtRaw
          : undefined,
    latitude: parseOptionalNumber(data.latitude),
    longitude: parseOptionalNumber(data.longitude),
    accuracyMeters: parseOptionalNumber(data.accuracyMeters),
  };
}

const toSortedDesc = (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) =>
  snap.docs
    .map((d) => parseVisitLogDoc(d.id, d.data()))
    .sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());

/** Visit logs recorded by sales officers for a retailer store. */
export const getVisitLogsForRetailer = async (
  retailerId: string,
  limitCount = 80
): Promise<SoVisitLog[]> => {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'so_visit_logs'),
        where('retailerId', '==', retailerId),
        orderBy('visitedAt', 'desc'),
        limit(limitCount)
      )
    );
    return toSortedDesc(snap);
  } catch {
    const snap = await getDocs(
      query(collection(db, 'so_visit_logs'), where('retailerId', '==', retailerId), limit(limitCount))
    );
    return toSortedDesc(snap);
  }
};

export type VisitLogsQuery = {
  salesOfficerId?: string;
  fromMs?: number;
  toMsExclusive?: number;
  limitCount?: number;
};

/**
 * Load SO visit logs for admin tracking (optional SO + date filters).
 * Falls back to an unfiltered scan when composite indexes are missing.
 */
export const getVisitLogs = async (opts: VisitLogsQuery = {}): Promise<SoVisitLog[]> => {
  const limitCount = opts.limitCount ?? 500;
  const soId = opts.salesOfficerId?.trim();

  try {
    if (soId) {
      const snap = await getDocs(
        query(
          collection(db, 'so_visit_logs'),
          where('salesOfficerId', '==', soId),
          orderBy('visitedAt', 'desc'),
          limit(limitCount)
        )
      );
      return filterVisitLogsByDate(toSortedDesc(snap), opts.fromMs, opts.toMsExclusive);
    }
    const snap = await getDocs(
      query(collection(db, 'so_visit_logs'), orderBy('visitedAt', 'desc'), limit(limitCount))
    );
    return filterVisitLogsByDate(toSortedDesc(snap), opts.fromMs, opts.toMsExclusive);
  } catch {
    const constraints = soId
      ? [where('salesOfficerId', '==', soId), limit(limitCount)]
      : [limit(Math.max(limitCount, 1000))];
    const snap = await getDocs(query(collection(db, 'so_visit_logs'), ...constraints));
    return filterVisitLogsByDate(toSortedDesc(snap), opts.fromMs, opts.toMsExclusive);
  }
};

function filterVisitLogsByDate(
  rows: SoVisitLog[],
  fromMs?: number,
  toMsExclusive?: number
): SoVisitLog[] {
  return rows.filter((r) => {
    const t = r.visitedAt.getTime();
    if (fromMs != null && t < fromMs) return false;
    if (toMsExclusive != null && t >= toMsExclusive) return false;
    return true;
  });
}

/** Latest visit per retailer id (for Stores list). Scans recent logs. */
export const getLatestVisitByRetailerId = async (
  limitCount = 2000
): Promise<Map<string, SoVisitLog>> => {
  const rows = await getVisitLogs({ limitCount });
  const map = new Map<string, SoVisitLog>();
  for (const row of rows) {
    if (!row.retailerId || map.has(row.retailerId)) continue;
    map.set(row.retailerId, row);
  }
  return map;
};

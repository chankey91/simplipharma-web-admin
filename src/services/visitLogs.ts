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
  };
}

/** Visit logs recorded by sales officers for a retailer store. */
export const getVisitLogsForRetailer = async (
  retailerId: string,
  limitCount = 80
): Promise<SoVisitLog[]> => {
  const toSorted = (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) =>
    snap.docs
      .map((d) => parseVisitLogDoc(d.id, d.data()))
      .sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());

  try {
    const snap = await getDocs(
      query(
        collection(db, 'so_visit_logs'),
        where('retailerId', '==', retailerId),
        orderBy('visitedAt', 'desc'),
        limit(limitCount)
      )
    );
    return toSorted(snap);
  } catch {
    const snap = await getDocs(
      query(collection(db, 'so_visit_logs'), where('retailerId', '==', retailerId), limit(limitCount))
    );
    return toSorted(snap);
  }
};

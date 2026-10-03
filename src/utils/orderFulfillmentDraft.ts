import type { OrderMedicine } from '../types';
import { normalizeFirestoreDate } from '../services/inventory';

export type FulfillmentDraftPayload = {
  medicines: any[];
  taxPercentage?: number;
  updatedAtMs?: number;
};

export type StoredFulfillmentDraft = {
  medicines: any[];
  taxPercentage?: number;
  updatedAt?: { toMillis?: () => number } | Date | number;
};

const sessionKey = (orderId: string) => `sp-fulfillment-draft:${orderId}`;
const localKey = (orderId: string) => `sp-fulfillment-draft-local:${orderId}`;

function readStoredDraft(storage: Storage, key: string): FulfillmentDraftPayload | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as FulfillmentDraftPayload;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

const DATE_FIELDS = ['batchExpiryDate', 'expiryDate'] as const;

/** Rehydrate ISO strings / Firestore-like objects from JSON draft storage. */
export function reviveDraftMedicines(medicines: any[]): any[] {
  return medicines.map((line) => {
    const revived = { ...line };
    for (const key of DATE_FIELDS) {
      if (revived[key] != null) {
        const d = normalizeFirestoreDate(revived[key]);
        if (d) revived[key] = d;
      }
    }
    if (Array.isArray(revived.batchAllocations)) {
      revived.batchAllocations = revived.batchAllocations.map((a: any) => {
        if (!a?.expiryDate) return a;
        const d = normalizeFirestoreDate(a.expiryDate);
        return d ? { ...a, expiryDate: d } : a;
      });
    }
    return revived;
  });
}

function draftTimestampMs(draft: FulfillmentDraftPayload | StoredFulfillmentDraft | null | undefined): number {
  if (!draft) return 0;
  if ('updatedAtMs' in draft && typeof draft.updatedAtMs === 'number') return draft.updatedAtMs;
  const u = (draft as StoredFulfillmentDraft).updatedAt;
  if (!u) return 0;
  if (typeof u === 'number') return u;
  if (u instanceof Date) return u.getTime();
  if (typeof u.toMillis === 'function') return u.toMillis();
  return 0;
}

/** Pick newest draft from Firestore, sessionStorage, or localStorage (offline / tab reopen). */
export function pickFulfillmentDraft(
  orderId: string,
  firestoreDraft?: StoredFulfillmentDraft | null
): FulfillmentDraftPayload | null {
  const sessionDraft = readStoredDraft(sessionStorage, sessionKey(orderId));
  const localDraft = readStoredDraft(localStorage, localKey(orderId));

  const fsMs = draftTimestampMs(firestoreDraft ?? undefined);
  const ssMs = draftTimestampMs(sessionDraft ?? undefined);
  const lsMs = draftTimestampMs(localDraft ?? undefined);
  const newestLocal = lsMs >= ssMs ? localDraft : sessionDraft;
  const newestLocalMs = Math.max(ssMs, lsMs);

  if (firestoreDraft?.medicines?.length && fsMs >= newestLocalMs) {
    return {
      medicines: reviveDraftMedicines(firestoreDraft.medicines),
      taxPercentage: firestoreDraft.taxPercentage,
      updatedAtMs: fsMs,
    };
  }
  if (newestLocal?.medicines?.length) {
    return {
      ...newestLocal,
      medicines: reviveDraftMedicines(newestLocal.medicines),
    };
  }
  return null;
}

export function writeSessionFulfillmentDraft(orderId: string, payload: FulfillmentDraftPayload): void {
  const stored = JSON.stringify({ ...payload, updatedAtMs: Date.now() });
  try {
    sessionStorage.setItem(sessionKey(orderId), stored);
  } catch (err) {
    console.warn('Failed to write fulfillment draft to sessionStorage:', err);
  }
  try {
    localStorage.setItem(localKey(orderId), stored);
  } catch (err) {
    console.warn('Failed to write fulfillment draft to localStorage:', err);
  }
}

export function clearSessionFulfillmentDraft(orderId: string): void {
  try {
    sessionStorage.removeItem(sessionKey(orderId));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(localKey(orderId));
  } catch {
    /* ignore */
  }
}

const WORK_FIELDS = [
  'batchNumber',
  'batchAllocations',
  'batchExpiryDate',
  'verified',
  'scannedQRCode',
  'discountPercentage',
  'discountManuallySet',
  'freeQuantity',
  'originalQuantity',
  'quantity',
  'price',
  'mrp',
  'gstRate',
  'expiryDate',
  'nonReturnable',
  'nrxDrug',
  'orderSchemeApplied',
  'orderSchemePaidQty',
  'orderSchemeFreeQty',
  'orderSchemeManuallySet',
] as const;

function lineIdentityKey(line: OrderMedicine | any): string | null {
  if (line?.productDemandId) return `pd:${line.productDemandId}`;
  if (line?.medicineId) return `med:${line.medicineId}`;
  return null;
}

function findWorkLine(serverLine: OrderMedicine, workLines: any[], serverIndex: number): any | undefined {
  const pdId = (serverLine as any).productDemandId;
  if (pdId) {
    return workLines.find((w) => w?.productDemandId === pdId);
  }
  const medId = serverLine.medicineId;
  if (!medId) return workLines[serverIndex];

  const workMatches = workLines.filter(
    (w) => w?.medicineId === medId && !(w as any).productDemandId && (w as any).lineType !== 'product_demand'
  );
  if (workMatches.length <= 1) {
    return workMatches[0] ?? workLines[serverIndex];
  }

  const serverMatchesBefore = workLines.filter((w, i) => {
    if (i >= serverIndex) return false;
    return w?.medicineId === medId && !(w as any).productDemandId;
  }).length;

  return workMatches[serverMatchesBefore] ?? workMatches[0];
}

function hasBatchWork(line: any): boolean {
  return Boolean(
    line?.batchNumber ||
      (line?.batchAllocations && line.batchAllocations.length > 0) ||
      line?.verified
  );
}

function applyWorkFields(serverLine: any, workLine: any): any {
  if (!workLine || !hasBatchWork(workLine)) return serverLine;
  const merged = { ...serverLine };
  for (const key of WORK_FIELDS) {
    const val = workLine[key];
    // Allow 0 and false (e.g. discountPercentage: 0, discountManuallySet: false)
    if (val !== undefined && val !== null && val !== '') {
      merged[key] = val;
    } else if (val === 0 || val === false) {
      merged[key] = val;
    }
  }
  if (workLine.verified) merged.verified = true;
  return merged;
}

/**
 * Apply in-progress batch assignments from draft/work lines onto fresh server-mapped lines.
 * Product-request rows are left as server state (fulfilled demand repair wins).
 */
export function mergeFulfillmentWorkIntoLines(serverLines: any[], workLines: any[]): any[] {
  if (!workLines?.length) return serverLines;

  const workByKey = new Map<string, any>();
  for (const w of workLines) {
    const key = lineIdentityKey(w);
    if (key && hasBatchWork(w)) workByKey.set(key, w);
  }

  return serverLines.map((serverLine, idx) => {
    if ((serverLine as any).lineType === 'product_demand') {
      return serverLine;
    }
    const key = lineIdentityKey(serverLine);
    const byKey = key ? workByKey.get(key) : undefined;
    const work = byKey ?? findWorkLine(serverLine, workLines, idx);
    return applyWorkFields(serverLine, work);
  });
}

/** Strip non-JSON / Firestore-unsafe values for draft storage. */
export function serializeDraftMedicines(medicines: any[]): any[] {
  return JSON.parse(JSON.stringify(medicines));
}

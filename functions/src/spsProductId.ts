/**
 * Allocate sequential business product IDs: SPS000001, SPS000002, …
 * Counter doc: counters/spsProductId { next: number } — next value to assign.
 * Admin SDK variant for Cloud Functions (bulk import, etc.).
 */
import * as admin from 'firebase-admin';

export const SPS_PRODUCT_ID_PREFIX = 'SPS';

export function formatSpsProductId(seq: number): string {
  if (!Number.isFinite(seq) || seq < 1) {
    throw new Error(`Invalid SPS sequence: ${seq}`);
  }
  return `${SPS_PRODUCT_ID_PREFIX}${String(Math.floor(seq)).padStart(6, '0')}`;
}

/**
 * Atomically reserves `count` sequential SPS ids and returns them in order.
 */
export async function allocateSpsProductIds(
  db: admin.firestore.Firestore,
  count: number
): Promise<string[]> {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`allocateSpsProductIds: count must be >= 1 (got ${count})`);
  }
  if (n > 5000) {
    throw new Error(`allocateSpsProductIds: max 5000 per call (got ${n})`);
  }

  const counterRef = db.collection('counters').doc('spsProductId');
  const start = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.next) : 1;
    const nextStart = Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1;
    tx.set(
      counterRef,
      {
        next: nextStart + n,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return nextStart;
  });

  return Array.from({ length: n }, (_, i) => formatSpsProductId(start + i));
}

export async function allocateSpsProductId(db: admin.firestore.Firestore): Promise<string> {
  const [id] = await allocateSpsProductIds(db, 1);
  return id;
}

import { Timestamp, serverTimestamp } from '../services/firebase';

/** Top-level document audit fields (createdAt, updatedAt, …). */
export { serverTimestamp };

/**
 * Firestore rejects `serverTimestamp()` inside arrays and some nested writes.
 * Use this for timeline events, stockBatches[].purchaseDate, etc.
 */
export function nestedFirestoreTimestamp(): Timestamp {
  return Timestamp.now();
}

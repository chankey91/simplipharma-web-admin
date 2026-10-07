import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';
import { assertAdmin } from './panelAuth';

const BATCH_PAGE = 200;
const MEDICINE_PAGE = 200;
const TIME_BUDGET_MS = 200_000;

type Phase = 'batches' | 'medicines';

function batchQty(data: FirebaseFirestore.DocumentData): number {
  const n = Number(data.quantity);
  return Number.isFinite(n) ? n : 0;
}

function zeroEmbeddedBatches(data: FirebaseFirestore.DocumentData): unknown[] | undefined {
  if (!Array.isArray(data.stockBatches) || data.stockBatches.length === 0) return undefined;
  return data.stockBatches.map((b: Record<string, unknown>) => ({ ...b, quantity: 0 }));
}

/**
 * Set every batch quantity to 0. Does not delete medicineBatches docs.
 * Then zeros medicine stock / currentStock aggregates (and embedded stockBatches qty if present).
 * Resumable: client should call again with { phase, startAfterId } until done.
 */
export const adminZeroAllStock = ff
  .runWith({ minInstances: 0, timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    try {
      await assertAdmin(context.auth.uid);
    } catch {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }

    const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    let phase: Phase = raw.phase === 'medicines' ? 'medicines' : 'batches';
    let startAfterId = typeof raw.startAfterId === 'string' ? raw.startAfterId.trim() : '';

    const db = admin.firestore();
    const started = Date.now();
    let scanned = 0;
    let batchesZeroed = 0;
    let medicinesUpdated = 0;

    const timeLeft = () => Date.now() - started < TIME_BUDGET_MS;

    if (phase === 'batches') {
      while (timeLeft()) {
        let q: FirebaseFirestore.Query = db
          .collection('medicineBatches')
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(BATCH_PAGE);
        if (startAfterId) q = q.startAfter(startAfterId);
        const snap = await q.get();
        if (snap.empty) {
          phase = 'medicines';
          startAfterId = '';
          break;
        }
        scanned += snap.docs.length;
        const writer = db.batch();
        const medicineIds = new Set<string>();
        let writes = 0;
        for (const d of snap.docs) {
          const qty = batchQty(d.data());
          if (qty === 0) continue;
          writer.update(d.ref, { quantity: 0 });
          writes += 1;
          batchesZeroed += 1;
          const medicineId = String(d.data().medicineId || '').trim();
          if (medicineId) medicineIds.add(medicineId);
        }
        for (const medicineId of medicineIds) {
          writer.set(
            db.collection('medicines').doc(medicineId),
            {
              stock: 0,
              currentStock: 0,
              activeBatchCount: 0,
              nearestExpiry: null,
            },
            { merge: true }
          );
          writes += 1;
          medicinesUpdated += 1;
        }
        if (writes > 0) await writer.commit();
        startAfterId = snap.docs[snap.docs.length - 1].id;
        if (snap.size < BATCH_PAGE) {
          phase = 'medicines';
          startAfterId = '';
          break;
        }
      }
    }

    if (phase === 'medicines' && timeLeft()) {
      while (timeLeft()) {
        const [byCurrent, byStock] = await Promise.all([
          db.collection('medicines').where('currentStock', '>', 0).limit(MEDICINE_PAGE).get(),
          db.collection('medicines').where('stock', '>', 0).limit(MEDICINE_PAGE).get(),
        ]);
        const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
        for (const d of [...byCurrent.docs, ...byStock.docs]) {
          byId.set(d.id, d);
        }
        scanned += byId.size;
        if (byId.size === 0) {
          return {
            done: true,
            phase,
            nextStartAfterId: null,
            scanned,
            batchesZeroed,
            medicinesUpdated,
          };
        }
        const writer = db.batch();
        for (const d of byId.values()) {
          const payload: Record<string, unknown> = {
            stock: 0,
            currentStock: 0,
            activeBatchCount: 0,
            nearestExpiry: null,
          };
          const embedded = zeroEmbeddedBatches(d.data());
          if (embedded) payload.stockBatches = embedded;
          writer.set(d.ref, payload, { merge: true });
          medicinesUpdated += 1;
        }
        await writer.commit();
        startAfterId = '';
      }
    }

    return {
      done: false,
      phase,
      nextStartAfterId: startAfterId || null,
      scanned,
      batchesZeroed,
      medicinesUpdated,
    };
  });

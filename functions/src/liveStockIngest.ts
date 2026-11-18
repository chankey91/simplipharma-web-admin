/**
 * Load a vendor live-stock file (CSV, Excel, or PDF) into liveStockOffers.
 * The latest successful file for a vendor replaces that vendor's previous rows.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';
import { getUserRole, isAdminOrOperationsRole } from './panelAuth';
import { extractStockFromFile } from './liveStockExtract';

const UPLOADS = 'liveStockUploads';
const OFFERS = 'liveStockOffers';

function stripUndefined<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = stripUndefined(item);
  }
  return out as T;
}

async function deleteStaleVendorOffers(
  db: admin.firestore.Firestore,
  vendorId: string,
  uploadedAtMs: number
): Promise<number> {
  const snap = await db.collection(OFFERS).where('vendorId', '==', vendorId).get();
  const stale = snap.docs.filter((doc) => Number(doc.data().uploadedAtMs || 0) < uploadedAtMs);
  let removed = 0;
  for (let i = 0; i < stale.length; i += 400) {
    const batch = db.batch();
    for (const doc of stale.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
    removed += Math.min(400, stale.length - i);
  }
  return removed;
}

export const ingestLiveStockUpload = ff
  .runWith({ minInstances: 0, timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await getUserRole(context.auth.uid);
    if (!isAdminOrOperationsRole(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }

    const uploadId = String(data?.uploadId || '').trim();
    if (!uploadId) {
      throw new functions.https.HttpsError('invalid-argument', 'uploadId required');
    }

    const db = admin.firestore();
    const ref = db.collection(UPLOADS).doc(uploadId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Upload not found');
    }
    const upload = snap.data() || {};
    const vendorId = String(upload.vendorId || '').trim();
    const vendorName = String(upload.vendorName || '').trim();
    const storagePath = String(upload.storagePath || '').trim();
    const contentType = String(upload.contentType || 'application/octet-stream');
    const fileName = String(upload.fileName || 'stock');
    if (!vendorId || !storagePath) {
      throw new functions.https.HttpsError('failed-precondition', 'Upload is missing a vendor or file');
    }

    await ref.set(
      { status: 'extracting', updatedAt: admin.firestore.FieldValue.serverTimestamp(), error: null },
      { merge: true }
    );

    try {
      const [fileBuf] = await admin.storage().bucket().file(storagePath).download();
      const extracted = await extractStockFromFile(fileBuf, contentType, fileName);
      if (extracted.rows.length === 0) {
        await ref.set(
          {
            status: 'failed',
            error: extracted.message || 'No stock rows found',
            engine: extracted.engine,
            model: extracted.model || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { ok: false, uploadId, rowCount: 0, message: extracted.message || 'No stock rows found' };
      }

      const uploadedAtMs = Date.now();
      const chunkSize = 400;
      for (let i = 0; i < extracted.rows.length; i += chunkSize) {
        const batch = db.batch();
        for (const row of extracted.rows.slice(i, i + chunkSize)) {
          const docRef = db.collection(OFFERS).doc();
          batch.set(
            docRef,
            stripUndefined({
              uploadId,
              vendorId,
              vendorName,
              productName: row.productName,
              productNameKey: row.productName.toLowerCase(),
              pack: row.pack || null,
              manufacturer: row.manufacturer || null,
              stockQty: row.stockQty,
              rate: row.rate ?? null,
              mrp: row.mrp ?? null,
              scheme: row.scheme || null,
              schemePaidQty: row.schemePaidQty ?? null,
              schemeFreeQty: row.schemeFreeQty ?? null,
              discountPercentage: row.discountPercentage ?? null,
              expiry: row.expiry || null,
              effectiveRate: row.effectiveRate ?? null,
              uploadedAtMs,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          );
        }
        await batch.commit();
      }

      const replaced = await deleteStaleVendorOffers(db, vendorId, uploadedAtMs);

      await ref.set(
        {
          status: 'ready',
          rowCount: extracted.rows.length,
          replacedCount: replaced,
          engine: extracted.engine,
          model: extracted.model || null,
          message: extracted.message || null,
          error: null,
          uploadedAtMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        ok: true,
        uploadId,
        rowCount: extracted.rows.length,
        replacedCount: replaced,
        engine: extracted.engine,
        message: extracted.message || `Loaded ${extracted.rows.length} stock rows for ${vendorName || 'vendor'}.`,
      };
    } catch (error: any) {
      const message = error?.message || String(error);
      await ref.set(
        {
          status: 'failed',
          error: message.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw new functions.https.HttpsError('internal', message);
    }
  });

/**
 * Product names for the purchase-invoice picker.
 * Pending and Picked up orders stay on the server. The browser only receives
 * the fields needed to label a suggestion (no order photos, no stock batches).
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';
import {
  getUserRole,
  isPanelRole,
  isPurchaseOfficerRole,
} from './panelAuth';

const STATUSES = ['Pending', 'Picked up'] as const;

type PickerRow = {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  productId?: string;
  code?: string;
  company?: string;
  unit?: string;
  description?: string;
};

function clip(value: unknown, max: number): string {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function optional(value: unknown, max: number): string | undefined {
  const text = clip(value, max);
  return text || undefined;
}

function absorbMedicineIds(snap: FirebaseFirestore.QuerySnapshot, ids: Set<string>): void {
  for (const docSnap of snap.docs) {
    const medicines = docSnap.get('medicines');
    if (!Array.isArray(medicines)) continue;
    for (const line of medicines) {
      const id = String(line?.medicineId || '').trim();
      if (id) ids.add(id);
    }
  }
}

export const awaitingFulfillmentMedicineIds = ff
  .runWith({ minInstances: 0, timeoutSeconds: 60, memory: '1GB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await getUserRole(context.auth.uid);
    if (!isPanelRole(role) && !isPurchaseOfficerRole(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Not allowed to look up order products');
    }

    const db = admin.firestore();
    const ids = new Set<string>();
    await Promise.all(
      STATUSES.map(async (status) => {
        const snap = await db.collection('orders').where('status', '==', status).select('medicines').get();
        absorbMedicineIds(snap, ids);
      })
    );

    const medicineIds = [...ids];
    const medicines: PickerRow[] = [];
    for (let i = 0; i < medicineIds.length; i += 100) {
      const refs = medicineIds.slice(i, i + 100).map((id) => db.collection('medicines').doc(id));
      const snaps = await db.getAll(...refs, {
        fieldMask: ['name', 'productId', 'code', 'manufacturer', 'company', 'unit', 'description', 'category'],
      });
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const row = snap.data() || {};
        medicines.push({
          id: snap.id,
          name: clip(row.name, 180),
          category: clip(row.category, 80),
          manufacturer: clip(row.manufacturer, 120),
          productId: optional(row.productId, 40),
          code: optional(row.code, 40),
          company: optional(row.company, 120),
          unit: optional(row.unit, 80),
          description: optional(row.description, 240),
        });
      }
    }

    return { medicines };
  });

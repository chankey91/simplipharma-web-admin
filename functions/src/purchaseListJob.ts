import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

type AggregateRow = {
  key: string;
  medicineId: string;
  medicineName: string;
  manufacturer: string;
  totalQty: number;
  orderNumbers: Set<string>;
};

function productAggregateKey(medicine: {
  medicineId?: string;
  productDemandId?: string;
  name?: string;
}): string {
  if (medicine.medicineId?.trim()) return `med:${medicine.medicineId.trim()}`;
  if (medicine.productDemandId?.trim()) return `demand:${medicine.productDemandId.trim()}`;
  return `name:${String(medicine.name || '')
    .trim()
    .toLowerCase()}`;
}

function coverageKey(item: { medicineId?: string; medicineName?: string }): string {
  if (item.medicineId?.trim()) return `med:${item.medicineId.trim()}`;
  return `name:${String(item.medicineName || '')
    .trim()
    .toLowerCase()}`;
}

/** YYYY-MM-DD in Asia/Kolkata */
export function istDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Inclusive IST calendar day → [startMs, endMsExclusive) */
export function istDayRangeMs(dateStr: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${dateStr}T00:00:00+05:30`).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

function orderReference(orderId: string): string {
  return orderId.length > 8 ? orderId.slice(-8).toUpperCase() : orderId.toUpperCase();
}

async function loadPendingOrdersInRange(
  db: FirebaseFirestore.Firestore,
  startMs: number,
  endMs: number
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const start = admin.firestore.Timestamp.fromMillis(startMs);
  const end = admin.firestore.Timestamp.fromMillis(endMs);
  try {
    const snap = await db
      .collection('orders')
      .where('status', '==', 'Pending')
      .where('orderDate', '>=', start)
      .where('orderDate', '<', end)
      .get();
    return snap.docs;
  } catch (err) {
    console.warn('purchaseListJob: compound query failed, scanning Pending orders:', err);
    const snap = await db.collection('orders').where('status', '==', 'Pending').get();
    return snap.docs.filter((doc) => {
      const raw = doc.data().orderDate;
      const ms =
        raw && typeof raw.toMillis === 'function'
          ? raw.toMillis()
          : raw instanceof Date
            ? raw.getTime()
            : 0;
      return ms >= startMs && ms < endMs;
    });
  }
}

async function sumCoveredQtyByKey(db: FirebaseFirestore.Firestore): Promise<Map<string, number>> {
  const covered = new Map<string, number>();
  const lists = await db.collection('purchaseLists').get();
  for (const listDoc of lists.docs) {
    const items = await listDoc.ref.collection('items').get();
    for (const itemDoc of items.docs) {
      const data = itemDoc.data();
      const found =
        typeof data.foundQty === 'number' && Number.isFinite(data.foundQty)
          ? Math.max(0, Math.floor(data.foundQty))
          : 0;
      if (found <= 0) continue;
      const key = coverageKey({
        medicineId: data.medicineId,
        medicineName: data.medicineName,
      });
      covered.set(key, (covered.get(key) || 0) + found);
    }
  }
  return covered;
}

async function aggregateGrossNeed(
  db: FirebaseFirestore.Firestore,
  orderDocs: FirebaseFirestore.QueryDocumentSnapshot[]
): Promise<AggregateRow[]> {
  const medicineCache = new Map<string, string>();
  const aggregate = new Map<string, AggregateRow>();

  for (const orderDoc of orderDocs) {
    const order = orderDoc.data();
    const orderNumber =
      (typeof order.invoiceNumber === 'string' && order.invoiceNumber) ||
      orderReference(orderDoc.id);
    const medicines = Array.isArray(order.medicines) ? order.medicines : [];

    for (const medicine of medicines) {
      const key = productAggregateKey(medicine);
      const medicineId = String(medicine.medicineId || '').trim();
      let manufacturer = String(medicine.manufacturerName || '').trim();
      if (!manufacturer && medicineId) {
        if (!medicineCache.has(medicineId)) {
          try {
            const medSnap = await db.collection('medicines').doc(medicineId).get();
            medicineCache.set(
              medicineId,
              medSnap.exists ? String(medSnap.data()?.manufacturer || 'N/A') : 'N/A'
            );
          } catch {
            medicineCache.set(medicineId, 'N/A');
          }
        }
        manufacturer = medicineCache.get(medicineId) || 'N/A';
      }
      if (!manufacturer) manufacturer = 'N/A';

      const qty = Number(medicine.quantity) || 0;
      const existing = aggregate.get(key);
      if (existing) {
        existing.totalQty += qty;
        existing.orderNumbers.add(orderNumber);
      } else {
        aggregate.set(key, {
          key,
          medicineId,
          medicineName: String(medicine.name || 'Unknown'),
          manufacturer,
          totalQty: qty,
          orderNumbers: new Set([orderNumber]),
        });
      }
    }
  }

  return Array.from(aggregate.values()).sort((a, b) => {
    const m = a.manufacturer.localeCompare(b.manufacturer);
    if (m !== 0) return m;
    return a.medicineName.localeCompare(b.medicineName);
  });
}

async function supersedeOpenLists(db: FirebaseFirestore.Firestore): Promise<number> {
  const open = await db.collection('purchaseLists').where('status', '==', 'open').get();
  if (open.empty) return 0;
  const batch = db.batch();
  for (const doc of open.docs) {
    batch.update(doc.ref, {
      status: 'superseded',
      supersededAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return open.size;
}

async function writePurchaseListItems(
  db: FirebaseFirestore.Firestore,
  listRef: FirebaseFirestore.DocumentReference,
  rows: Array<{
    medicineId: string;
    medicineName: string;
    manufacturer: string;
    totalQty: number;
    orderNumbers: string[];
    grossQty: number;
    coveredQty: number;
  }>
): Promise<void> {
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = db.batch();
    const slice = rows.slice(i, i + chunkSize);
    for (const row of slice) {
      const itemRef = listRef.collection('items').doc();
      batch.set(itemRef, {
        medicineId: row.medicineId,
        medicineName: row.medicineName,
        manufacturer: row.manufacturer,
        totalQty: row.totalQty,
        grossQty: row.grossQty,
        coveredQty: row.coveredQty,
        orderCount: row.orderNumbers.length,
        orderNumbers: row.orderNumbers,
        status: 'pending',
        foundQty: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

export type PublishPurchaseListResult = {
  listId: string | null;
  itemCount: number;
  totalQtyNeeded: number;
  pendingOrderCount: number;
  eliminatedCount: number;
  reducedCount: number;
  supersededOpenLists: number;
  fromDate: string;
  toDate: string;
  message: string;
};

/**
 * Publish net remaining purchase need for an IST calendar day.
 * Subtracts foundQty already recorded on any prior purchase list items.
 */
export async function publishNetPurchaseListForDay(args: {
  dateStr?: string;
  fromDate?: string;
  toDate?: string;
  source: string;
  createdBy?: string;
}): Promise<PublishPurchaseListResult> {
  const db = admin.firestore();
  const today = istDateString();
  const fromDate = args.fromDate || args.dateStr || today;
  const toDate = args.toDate || args.dateStr || today;
  const { startMs } = istDayRangeMs(fromDate);
  const { endMs } = istDayRangeMs(toDate);

  const orderDocs = await loadPendingOrdersInRange(db, startMs, endMs);
  const grossRows = await aggregateGrossNeed(db, orderDocs);
  const covered = await sumCoveredQtyByKey(db);

  let eliminatedCount = 0;
  let reducedCount = 0;
  const netRows: Array<{
    medicineId: string;
    medicineName: string;
    manufacturer: string;
    totalQty: number;
    orderNumbers: string[];
    grossQty: number;
    coveredQty: number;
  }> = [];

  for (const row of grossRows) {
    const coveredQty = covered.get(row.key) || 0;
    const net = Math.max(0, row.totalQty - coveredQty);
    if (net <= 0) {
      eliminatedCount += 1;
      continue;
    }
    if (coveredQty > 0) reducedCount += 1;
    netRows.push({
      medicineId: row.medicineId,
      medicineName: row.medicineName,
      manufacturer: row.manufacturer,
      totalQty: net,
      orderNumbers: Array.from(row.orderNumbers).sort(),
      grossQty: row.totalQty,
      coveredQty,
    });
  }

  if (netRows.length === 0) {
    return {
      listId: null,
      itemCount: 0,
      totalQtyNeeded: 0,
      pendingOrderCount: orderDocs.length,
      eliminatedCount,
      reducedCount,
      supersededOpenLists: 0,
      fromDate,
      toDate,
      message:
        orderDocs.length === 0
          ? 'No pending orders for the selected dates'
          : 'All pending product need is already covered by purchase officer findings',
    };
  }

  const supersededOpenLists = await supersedeOpenLists(db);
  const totalQtyNeeded = netRows.reduce((s, r) => s + r.totalQty, 0);
  const listRef = db.collection('purchaseLists').doc();
  await listRef.set({
    fromDate,
    toDate,
    status: 'open',
    createdBy: args.createdBy || 'system',
    source: args.source,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    itemCount: netRows.length,
    totalQtyNeeded,
    pendingOrderCount: orderDocs.length,
    eliminatedCount,
    reducedCount,
  });

  await writePurchaseListItems(db, listRef, netRows);

  return {
    listId: listRef.id,
    itemCount: netRows.length,
    totalQtyNeeded,
    pendingOrderCount: orderDocs.length,
    eliminatedCount,
    reducedCount,
    supersededOpenLists,
    fromDate,
    toDate,
    message: `Published ${netRows.length} medicines (net remaining after purchase officer findings)`,
  };
}

async function runScheduledPublish(source: string): Promise<void> {
  const result = await publishNetPurchaseListForDay({ source, createdBy: 'system' });
  console.log(`[${source}]`, JSON.stringify(result));
}

/** Daily 12:00 Asia/Kolkata — first purchase run from today's pending orders */
export const scheduledPurchaseListNoon = functions.pubsub
  .schedule('0 12 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    await runScheduledPublish('scheduled-12');
  });

/** Daily 15:00 Asia/Kolkata — refresh remaining need (excludes already found qty) */
export const scheduledPurchaseListAfternoon = functions.pubsub
  .schedule('0 15 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    await runScheduledPublish('scheduled-15');
  });

/**
 * Admin/operations callable: run the same net publish job on demand
 * (optional date YYYY-MM-DD, defaults to today IST).
 */
export const publishPurchaseListNet = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const role = userDoc.exists ? String(userDoc.data()?.role || '') : '';
  if (!['admin', 'Admin', 'operations', 'Operations'].includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
  }

  const dateOk = (s: unknown): s is string =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

  const fromDate = dateOk(data?.fromDate)
    ? data.fromDate.trim()
    : dateOk(data?.dateStr)
      ? data.dateStr.trim()
      : undefined;
  const toDate = dateOk(data?.toDate)
    ? data.toDate.trim()
    : dateOk(data?.dateStr)
      ? data.dateStr.trim()
      : undefined;

  return publishNetPurchaseListForDay({
    fromDate,
    toDate,
    source: 'manual-admin',
    createdBy: context.auth.uid,
  });
});

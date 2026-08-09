import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';

type AggregateRow = {
  key: string;
  medicineId: string;
  medicineName: string;
  manufacturer: string;
  totalQty: number;
  orderNumbers: Set<string>;
  orderIds: Set<string>;
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
  endMs: number,
  maxDocs = 400
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const start = admin.firestore.Timestamp.fromMillis(startMs);
  const end = admin.firestore.Timestamp.fromMillis(endMs);
  try {
    const snap = await db
      .collection('orders')
      .where('status', '==', 'Pending')
      .where('orderDate', '>=', start)
      .where('orderDate', '<', end)
      .limit(maxDocs)
      .get();
    return snap.docs;
  } catch (err) {
    console.warn('purchaseListJob: compound query failed, scanning Pending orders:', err);
    const snap = await db.collection('orders').where('status', '==', 'Pending').limit(maxDocs).get();
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
        existing.orderIds.add(orderDoc.id);
      } else {
        aggregate.set(key, {
          key,
          medicineId,
          medicineName: String(medicine.name || 'Unknown'),
          manufacturer,
          totalQty: qty,
          orderNumbers: new Set([orderNumber]),
          orderIds: new Set([orderDoc.id]),
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
    orderIds: string[];
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
        orderIds: row.orderIds,
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
    orderIds: string[];
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
      orderIds: Array.from(row.orderIds).sort(),
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
export const scheduledPurchaseListNoon = ff.pubsub
  .schedule('0 12 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    await runScheduledPublish('scheduled-12');
  });

/** Daily 15:00 Asia/Kolkata — refresh remaining need (excludes already found qty) */
export const scheduledPurchaseListAfternoon = ff.pubsub
  .schedule('0 15 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    await runScheduledPublish('scheduled-15');
  });

/**
 * Admin/operations callable: run the same net publish job on demand
 * (optional date YYYY-MM-DD, defaults to today IST).
 */
export const publishPurchaseListNet = ff.https.onCall(async (data, context) => {
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

function manufacturerSubmissionKey(manufacturer: string): string {
  return (
    manufacturer
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'unknown'
  );
}

/**
 * After purchase officer submits a manufacturer group, write found/partial/not_found
 * onto matching order medicine lines so retailer apps can show availability badges.
 */
export async function propagateManufacturerAvailability(args: {
  listId: string;
  manufacturer: string;
}): Promise<{ updatedOrders: number; updatedLines: number; scannedOrders: number }> {
  const db = admin.firestore();
  const listSnap = await db.collection('purchaseLists').doc(args.listId).get();
  if (!listSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Purchase list not found');
  }

  const listData = listSnap.data() || {};
  const fromDate = String(listData.fromDate || istDateString());
  const toDate = String(listData.toDate || fromDate);
  const { startMs } = istDayRangeMs(fromDate);
  const { endMs } = istDayRangeMs(toDate);

  const itemsSnap = await listSnap.ref.collection('items').get();
  const mfrKey = manufacturerSubmissionKey(args.manufacturer);
  type PurchaseItemRow = { id: string } & Record<string, unknown>;
  const groupItems: PurchaseItemRow[] = itemsSnap.docs
    .map((d): PurchaseItemRow => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    .filter((item) => {
      const mfr = String(item.manufacturer || '');
      return manufacturerSubmissionKey(mfr) === mfrKey;
    });

  type Avail = { status: string; foundQty: number | null; totalQty: number };
  /** Register under med:/demand:/name: so order lines match either id or name. */
  const availabilityByKey = new Map<string, Avail>();
  const orderIdSet = new Set<string>();

  const registerKeys = (item: PurchaseItemRow, avail: Avail) => {
    const medicineId = String(item.medicineId || '').trim();
    const medicineName = String(item.medicineName || '')
      .trim()
      .toLowerCase();
    if (medicineId) availabilityByKey.set(`med:${medicineId}`, avail);
    if (medicineName) availabilityByKey.set(`name:${medicineName}`, avail);
  };

  for (const item of groupItems) {
    const status = String(item.status || 'pending');
    if (status === 'pending') continue;
    const avail: Avail = {
      status,
      foundQty: typeof item.foundQty === 'number' ? item.foundQty : null,
      totalQty: Number(item.totalQty) || 0,
    };
    registerKeys(item, avail);

    const ids = Array.isArray(item.orderIds) ? item.orderIds : [];
    for (const id of ids) {
      if (typeof id === 'string' && id.trim()) orderIdSet.add(id.trim());
    }
    const nums = Array.isArray(item.orderNumbers) ? item.orderNumbers : [];
    for (const n of nums) {
      if (typeof n === 'string' && n.trim()) {
        const t = n.trim();
        // Full order doc ids (ORD…) — skip short display refs
        if (t.startsWith('ORD')) orderIdSet.add(t);
      }
    }
  }

  if (availabilityByKey.size === 0) {
    console.warn('propagateManufacturerAvailability: no non-pending items', {
      listId: args.listId,
      manufacturer: args.manufacturer,
      groupItemCount: groupItems.length,
    });
    return { updatedOrders: 0, updatedLines: 0, scannedOrders: 0 };
  }

  const lineMatchesAvailability = (m: Record<string, unknown>): Avail | null => {
    const medId = String(m.medicineId || '').trim();
    if (medId) {
      const byId = availabilityByKey.get(`med:${medId}`);
      if (byId) return byId;
    }
    const demandId = String(m.productDemandId || '').trim();
    if (demandId) {
      const byDemand = availabilityByKey.get(`demand:${demandId}`);
      if (byDemand) return byDemand;
    }
    const name = String(m.name || '')
      .trim()
      .toLowerCase();
    if (name) {
      const byName = availabilityByKey.get(`name:${name}`);
      if (byName) return byName;
    }
    return null;
  };

  // Always supplement with a capped same-day Pending scan (fast, bounded)
  {
    const orderDocs = await loadPendingOrdersInRange(db, startMs, endMs, 250);
    for (const snap of orderDocs) {
      const medicines = Array.isArray(snap.data().medicines) ? snap.data().medicines : [];
      const hit = medicines.some((m: Record<string, unknown>) => Boolean(lineMatchesAvailability(m)));
      if (hit) orderIdSet.add(snap.id);
    }
  }

  // Cap work so callable finishes within client timeout
  const MAX_ORDERS = 200;
  let orderIds = Array.from(orderIdSet);
  if (orderIds.length > MAX_ORDERS) {
    console.warn('propagateManufacturerAvailability: capping orders', {
      listId: args.listId,
      total: orderIds.length,
      max: MAX_ORDERS,
    });
    orderIds = orderIds.slice(0, MAX_ORDERS);
  }

  if (orderIds.length === 0) {
    console.warn('propagateManufacturerAvailability: no orders found to update', {
      listId: args.listId,
      manufacturer: args.manufacturer,
      fromDate,
      toDate,
      availabilityKeys: Array.from(availabilityByKey.keys()).slice(0, 20),
    });
    return { updatedOrders: 0, updatedLines: 0, scannedOrders: 0 };
  }

  let updatedOrders = 0;
  let updatedLines = 0;
  const scannedOrders = orderIds.length;

  // Smaller chunks — faster commits, less risk of timeout / OOM
  for (let i = 0; i < orderIds.length; i += 40) {
    const chunk = orderIds.slice(i, i + 40);
    const refs = chunk.map((id) => db.collection('orders').doc(id));
    const snaps = await db.getAll(...refs);

    const batch = db.batch();
    let batchOps = 0;

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const medicines = Array.isArray(data.medicines) ? [...data.medicines] : [];
      let changed = false;
      let lineUpdates = 0;
      const nextMedicines = medicines.map((m: Record<string, unknown>) => {
        const avail = lineMatchesAvailability(m);
        if (!avail) return m;
        const medId = String(m.medicineId || '').trim();
        if (!medId) {
          const lineMfr = String(m.manufacturerName || '').trim();
          if (lineMfr && manufacturerSubmissionKey(lineMfr) !== mfrKey) return m;
        }
        lineUpdates += 1;
        changed = true;
        return {
          ...m,
          purchaseAvailability: avail.status,
          purchaseFoundQty: avail.foundQty,
          purchaseAvailabilityUpdatedAt: new Date().toISOString(),
        };
      });

      if (changed) {
        batch.update(snap.ref, {
          medicines: nextMedicines,
          purchaseAvailabilityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batchOps += 1;
        updatedOrders += 1;
        updatedLines += lineUpdates;
      }
    }

    if (batchOps > 0) await batch.commit();
  }

  console.info('propagateManufacturerAvailability done', {
    listId: args.listId,
    manufacturer: args.manufacturer,
    fromDate,
    toDate,
    scannedOrders,
    updatedOrders,
    updatedLines,
  });

  return { updatedOrders, updatedLines, scannedOrders };
}

/** Callable: purchase officer / admin — sync submitted manufacturer group to retailer orders */
export const syncPurchaseManufacturerToOrders = ff
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
    const role = userDoc.exists ? String(userDoc.data()?.role || '') : '';
    const allowed = [
      'purchaseOfficer',
      'PurchaseOfficer',
      'admin',
      'Admin',
      'operations',
      'Operations',
    ];
    if (!allowed.includes(role)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Purchase officer required (got role="${role || 'none'}")`
      );
    }

    const listId = typeof data?.listId === 'string' ? data.listId.trim() : '';
    const manufacturer = typeof data?.manufacturer === 'string' ? data.manufacturer.trim() : '';
    if (!listId || !manufacturer) {
      throw new functions.https.HttpsError('invalid-argument', 'listId and manufacturer required');
    }

    try {
      const result = await propagateManufacturerAvailability({ listId, manufacturer });
      if (result.updatedLines === 0) {
        console.warn('syncPurchaseManufacturerToOrders wrote 0 lines', { listId, manufacturer, result });
      }
      return result;
    } catch (err) {
      console.error('syncPurchaseManufacturerToOrders failed', { listId, manufacturer, err });
      if (err instanceof functions.https.HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Order sync failed: ${msg.slice(0, 300)}`
      );
    }
  });

/**
 * When a manufacturer group is marked submitted on the purchase list, push
 * found/partial/not_found onto matching retailer order lines automatically.
 * Works even if the purchase web app never called the callable.
 *
 * Re-sync: bump manufacturerSubmissions[key].syncNonce from the purchase app.
 */
export const onPurchaseListManufacturerSubmit = ff
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('purchaseLists/{listId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const prev = (before.manufacturerSubmissions || {}) as Record<
      string,
      { status?: string; manufacturer?: string; syncNonce?: string | number }
    >;
    const next = (after.manufacturerSubmissions || {}) as Record<
      string,
      { status?: string; manufacturer?: string; syncNonce?: string | number }
    >;
    const listId = String(context.params.listId || '');
    const results: Array<{ manufacturer: string; updatedLines: number }> = [];

    for (const [key, val] of Object.entries(next)) {
      if (!val || val.status !== 'submitted') continue;
      const wasSubmitted = prev[key]?.status === 'submitted';
      const nonceChanged =
        String(prev[key]?.syncNonce ?? '') !== String(val.syncNonce ?? '');
      if (wasSubmitted && !nonceChanged) continue;

      const manufacturer = String(val.manufacturer || key).replace(/_/g, ' ').trim() || key;
      // Prefer explicit manufacturer string stored on submission
      const mfrLabel = String(val.manufacturer || '').trim() || manufacturer;
      try {
        const result = await propagateManufacturerAvailability({
          listId,
          manufacturer: mfrLabel,
        });
        results.push({ manufacturer: mfrLabel, updatedLines: result.updatedLines });
        console.info('onPurchaseListManufacturerSubmit', { listId, manufacturer: mfrLabel, ...result });
      } catch (err) {
        console.error('onPurchaseListManufacturerSubmit failed', listId, mfrLabel, err);
      }
    }

    return { listId, results };
  });

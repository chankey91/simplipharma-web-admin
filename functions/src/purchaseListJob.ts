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

type PurchaseItemStatus = 'pending' | 'found' | 'partial' | 'not_found';

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

function deriveItemStatus(
  totalQty: number,
  foundQty: number | null | undefined
): PurchaseItemStatus {
  if (foundQty === null || foundQty === undefined) return 'pending';
  const need = Math.max(0, Math.floor(totalQty));
  const found = Math.max(0, Math.min(need, Math.floor(foundQty)));
  if (found <= 0) return 'not_found';
  if (found >= need) return 'found';
  return 'partial';
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

/**
 * Sum foundQty from lists that are NOT the current same-day open list
 * (other days / superseded / confirmed). Used only when creating a brand-new day list.
 */
async function sumCoveredQtyByKeyExcludingList(
  db: FirebaseFirestore.Firestore,
  excludeListId?: string
): Promise<Map<string, number>> {
  const covered = new Map<string, number>();
  const lists = await db.collection('purchaseLists').get();
  for (const listDoc of lists.docs) {
    if (excludeListId && listDoc.id === excludeListId) continue;
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

async function supersedeOpenListsExcept(
  db: FirebaseFirestore.Firestore,
  keepListId?: string
): Promise<number> {
  const open = await db.collection('purchaseLists').where('status', '==', 'open').get();
  if (open.empty) return 0;
  const batch = db.batch();
  let count = 0;
  for (const doc of open.docs) {
    if (keepListId && doc.id === keepListId) continue;
    batch.update(doc.ref, {
      status: 'superseded',
      supersededAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count += 1;
  }
  if (count > 0) await batch.commit();
  return count;
}

async function findOpenListForDay(
  db: FirebaseFirestore.Firestore,
  fromDate: string,
  toDate: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const open = await db.collection('purchaseLists').where('status', '==', 'open').get();
  const match = open.docs.find((d) => {
    const data = d.data();
    return String(data.fromDate || '') === fromDate && String(data.toDate || '') === toDate;
  });
  return match || null;
}

async function writePurchaseListItems(
  listRef: FirebaseFirestore.DocumentReference,
  rows: Array<{
    medicineId: string;
    medicineName: string;
    manufacturer: string;
    totalQty: number;
    orderNumbers: string[];
    grossQty: number;
    coveredQty: number;
    aggregateKey?: string;
  }>
): Promise<void> {
  const db = admin.firestore();
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
        aggregateKey:
          row.aggregateKey ||
          coverageKey({
            medicineId: row.medicineId,
            medicineName: row.medicineName,
          }),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/**
 * Merge today's gross need into an existing open day list.
 * - Increases totalQty when more orders arrive (keeps foundQty)
 * - Keeps fully-found lines visible
 * - Reopens manufacturer submissions when any line still needs work
 */
async function mergeIntoOpenDayList(args: {
  db: FirebaseFirestore.Firestore;
  listDoc: FirebaseFirestore.QueryDocumentSnapshot;
  grossRows: AggregateRow[];
  orderDocsCount: number;
  source: string;
  fromDate: string;
  toDate: string;
}): Promise<PublishPurchaseListResult> {
  const { db, listDoc, grossRows, orderDocsCount, source, fromDate, toDate } = args;
  const listRef = listDoc.ref;
  const itemsSnap = await listRef.collection('items').get();

  type ExistingItem = {
    id: string;
    ref: FirebaseFirestore.DocumentReference;
    data: FirebaseFirestore.DocumentData;
    key: string;
  };

  const byKey = new Map<string, ExistingItem>();
  for (const itemDoc of itemsSnap.docs) {
    const data = itemDoc.data();
    const key =
      (typeof data.aggregateKey === 'string' && data.aggregateKey) ||
      coverageKey({ medicineId: data.medicineId, medicineName: data.medicineName });
    // Prefer first match; if duplicates, keep the one with higher foundQty
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { id: itemDoc.id, ref: itemDoc.ref, data, key });
    } else {
      const prevFound = typeof prev.data.foundQty === 'number' ? prev.data.foundQty : 0;
      const nextFound = typeof data.foundQty === 'number' ? data.foundQty : 0;
      if (nextFound > prevFound) {
        byKey.set(key, { id: itemDoc.id, ref: itemDoc.ref, data, key });
      }
    }
  }

  const grossByKey = new Map(grossRows.map((r) => [r.key, r]));
  let updatedCount = 0;
  let addedCount = 0;
  let unchangedCovered = 0;
  const manufacturersNeedingWork = new Set<string>();

  // Update existing lines that appear in current gross need (batched)
  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; payload: Record<string, unknown> }> =
    [];

  for (const [key, existing] of byKey) {
    const gross = grossByKey.get(key);
    const foundRaw = existing.data.foundQty;
    const foundQty =
      typeof foundRaw === 'number' && Number.isFinite(foundRaw)
        ? Math.max(0, Math.floor(foundRaw))
        : null;

    if (!gross) {
      const prevTotal = Math.max(0, Math.floor(Number(existing.data.totalQty) || 0));
      const totalQty = Math.max(prevTotal, foundQty ?? 0);
      const status = deriveItemStatus(totalQty, foundQty);
      if (totalQty !== prevTotal || status !== existing.data.status) {
        updates.push({
          ref: existing.ref,
          payload: {
            totalQty,
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
        updatedCount += 1;
      }
      if (foundQty !== null && foundQty >= totalQty && totalQty > 0) {
        unchangedCovered += 1;
      }
      continue;
    }

    const totalQty = Math.max(gross.totalQty, foundQty ?? 0);
    const orderNumbers = Array.from(gross.orderNumbers).sort();
    const status = deriveItemStatus(totalQty, foundQty);
    const manufacturer = gross.manufacturer || String(existing.data.manufacturer || 'N/A');

    updates.push({
      ref: existing.ref,
      payload: {
        medicineId: gross.medicineId || existing.data.medicineId || '',
        medicineName: gross.medicineName || existing.data.medicineName,
        manufacturer,
        totalQty,
        grossQty: gross.totalQty,
        coveredQty: foundQty ?? 0,
        orderCount: orderNumbers.length,
        orderNumbers,
        status,
        aggregateKey: key,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
    updatedCount += 1;

    if (status === 'pending' || status === 'partial' || (foundQty ?? 0) < totalQty) {
      manufacturersNeedingWork.add(manufacturer);
    }
  }

  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 400)) {
      batch.update(u.ref, u.payload);
    }
    await batch.commit();
  }

  // Add brand-new medicines
  const chunkSize = 400;
  const newRows = grossRows.filter((r) => !byKey.has(r.key));
  for (let i = 0; i < newRows.length; i += chunkSize) {
    const batch = db.batch();
    const slice = newRows.slice(i, i + chunkSize);
    for (const row of slice) {
      const itemRef = listRef.collection('items').doc();
      batch.set(itemRef, {
        medicineId: row.medicineId,
        medicineName: row.medicineName,
        manufacturer: row.manufacturer,
        totalQty: row.totalQty,
        grossQty: row.totalQty,
        coveredQty: 0,
        orderCount: row.orderNumbers.size,
        orderNumbers: Array.from(row.orderNumbers).sort(),
        status: 'pending',
        foundQty: null,
        aggregateKey: row.key,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      manufacturersNeedingWork.add(row.manufacturer);
      addedCount += 1;
    }
    await batch.commit();
  }

  // Reopen manufacturer groups that need more work
  const prevSubmissions = (listDoc.data().manufacturerSubmissions || {}) as Record<
    string,
    { status?: string; manufacturer?: string }
  >;
  const nextSubmissions: Record<string, unknown> = { ...prevSubmissions };
  let reopenedGroups = 0;
  for (const manufacturer of manufacturersNeedingWork) {
    const key = manufacturerSubmissionKey(manufacturer);
    if (nextSubmissions[key] && (nextSubmissions[key] as { status?: string }).status === 'submitted') {
      delete nextSubmissions[key];
      reopenedGroups += 1;
    }
  }

  const allItems = await listRef.collection('items').get();
  let totalQtyNeeded = 0;
  let itemCount = 0;
  for (const d of allItems.docs) {
    itemCount += 1;
    totalQtyNeeded += Math.max(0, Math.floor(Number(d.data().totalQty) || 0));
  }

  await listRef.update({
    source,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    itemCount,
    totalQtyNeeded,
    pendingOrderCount: orderDocsCount,
    eliminatedCount: unchangedCovered,
    reducedCount: updatedCount,
    mergedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMergeSource: source,
    manufacturerSubmissions: nextSubmissions,
    reopenedManufacturerCount: reopenedGroups,
  });

  // Supersede any other stray open lists
  const supersededOpenLists = await supersedeOpenListsExcept(db, listRef.id);

  return {
    listId: listRef.id,
    itemCount,
    totalQtyNeeded,
    pendingOrderCount: orderDocsCount,
    eliminatedCount: unchangedCovered,
    reducedCount: updatedCount,
    supersededOpenLists,
    fromDate,
    toDate,
    message: `Merged day list: +${addedCount} new, ${updatedCount} updated, ${reopenedGroups} manufacturer group(s) reopened`,
  };
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
 * Publish / refresh purchase need for an IST calendar day.
 * Same-day: merge into the open list (increase counts, keep found, reopen submitted groups).
 * New day (or no open list): create a new list; supersede other open lists.
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

  const sameDay = fromDate === toDate;
  const existingOpen = sameDay ? await findOpenListForDay(db, fromDate, toDate) : null;

  if (existingOpen) {
    if (grossRows.length === 0 && (await existingOpen.ref.collection('items').limit(1).get()).empty) {
      return {
        listId: existingOpen.id,
        itemCount: 0,
        totalQtyNeeded: 0,
        pendingOrderCount: orderDocs.length,
        eliminatedCount: 0,
        reducedCount: 0,
        supersededOpenLists: 0,
        fromDate,
        toDate,
        message: 'No pending orders; existing day list unchanged',
      };
    }
    return mergeIntoOpenDayList({
      db,
      listDoc: existingOpen,
      grossRows,
      orderDocsCount: orderDocs.length,
      source: args.source,
      fromDate,
      toDate,
    });
  }

  // Brand-new list for this day — use gross pending need (day-wise; no cross-day coverage).
  // Multi-day ranges still net out findings from other lists.
  const covered = sameDay ? new Map<string, number>() : await sumCoveredQtyByKeyExcludingList(db);
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
    aggregateKey: string;
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
      aggregateKey: row.key,
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

  const supersededOpenLists = await supersedeOpenListsExcept(db);
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
    manufacturerSubmissions: {},
  });

  await writePurchaseListItems(listRef, netRows);

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
    message: `Published ${netRows.length} medicines for ${fromDate}${fromDate !== toDate ? ` → ${toDate}` : ''}`,
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

/** Daily 15:00 Asia/Kolkata — merge same-day need (increase counts, reopen groups) */
export const scheduledPurchaseListAfternoon = functions.pubsub
  .schedule('0 15 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    await runScheduledPublish('scheduled-15');
  });

/**
 * Admin/operations callable: run the same publish/merge job on demand
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

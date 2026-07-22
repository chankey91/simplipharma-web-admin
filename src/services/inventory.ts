import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  documentId,
  Timestamp,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  deleteField,
  db,
} from './firebase';
import { nestedFirestoreTimestamp } from '../utils/firestoreTimestamps';
import { Medicine, StockBatch } from '../types';
import { standardDiscountFromStockBatch } from '../utils/orderFulfillmentDiscount';

/** Top-level collection for on-hand lots (transactional). Master stays on `medicines`. */
export const MEDICINE_BATCHES_COLLECTION = 'medicineBatches';

/**
 * While true, stock mutations also keep the legacy embedded `stockBatches` array
 * on the medicine doc in sync (safe cutover / rollback).
 * Off on simplipharma-dev after soak testing — source of truth is medicineBatches only.
 */
export const DUAL_WRITE_EMBEDDED_STOCK_BATCHES = false;

export const MEDICINE_MIGRATION_VERSION = 2;

/**
 * Firestore Timestamp, Date, ISO string, or plain { seconds, nanoseconds } → Date.
 * Missing or invalid → undefined (caller should treat as "no expiry" / not expired for allocation UI).
 */
export function normalizeFirestoreDate(val: any): Date | undefined {
  if (val == null || val === '') return undefined;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? undefined : val;
  }
  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    const d = new Date(
      val.seconds * 1000 + (typeof val.nanoseconds === 'number' ? val.nanoseconds / 1e6 : 0)
    );
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function normalizeBatchQuantity(batch: any): number {
  if (typeof batch.quantity === 'number' && !isNaN(batch.quantity)) {
    return Math.max(0, Math.floor(batch.quantity));
  }
  const n = parseInt(String(batch.quantity ?? '0'), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function parseOptionalPositiveNumber(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function mapBatchLandedCost(batch: any): { landedUnitCostExGst?: number } {
  const landed = parseOptionalPositiveNumber(batch.landedUnitCostExGst);
  return landed !== undefined ? { landedUnitCostExGst: landed } : {};
}

function appendLandedCostToFirestoreBatch(firestoreBatch: Record<string, unknown>, b: any): void {
  const landed = parseOptionalPositiveNumber(b.landedUnitCostExGst);
  if (landed !== undefined) {
    firestoreBatch.landedUnitCostExGst = landed;
  }
}

/** Buy schemePaidQty, get schemeFreeQty free; accepts legacy purchaseSchemeDeal / purchaseSchemeFree on batches. */
function normalizeSchemeFromBatch(batch: any): { schemePaidQty?: number; schemeFreeQty?: number } {
  const paidRaw = batch.schemePaidQty ?? batch.purchaseSchemeDeal;
  const freeRaw = batch.schemeFreeQty ?? batch.purchaseSchemeFree;
  if (paidRaw == null || paidRaw === '' || freeRaw == null || freeRaw === '') return {};
  const p = typeof paidRaw === 'number' ? paidRaw : parseFloat(String(paidRaw));
  const f = typeof freeRaw === 'number' ? freeRaw : parseFloat(String(freeRaw));
  if (isNaN(p) || isNaN(f) || p <= 0 || f <= 0) return {};
  return { schemePaidQty: Math.floor(p), schemeFreeQty: Math.floor(f) };
}

function appendSchemeFieldsToFirestoreBatch(firestoreBatch: any, b: any) {
  const s = normalizeSchemeFromBatch(b);
  if (s.schemePaidQty != null && s.schemeFreeQty != null) {
    firestoreBatch.schemePaidQty = s.schemePaidQty;
    firestoreBatch.schemeFreeQty = s.schemeFreeQty;
  }
}

function batchKey(batchNumber: string | undefined | null): string {
  return String(batchNumber ?? '')
    .trim()
    .toLowerCase();
}

function toFirestoreTimestamp(val: any): Timestamp | undefined {
  if (val == null || val === '') return undefined;
  if (val instanceof Timestamp) return val;
  if (typeof val?.toDate === 'function') {
    try {
      return Timestamp.fromDate(val.toDate());
    } catch {
      return undefined;
    }
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? undefined : Timestamp.fromDate(val);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : Timestamp.fromDate(d);
}

function parseMrp(rawMrp: unknown): number | undefined {
  if (rawMrp === undefined || rawMrp === null) return undefined;
  if (typeof rawMrp === 'number') return isNaN(rawMrp) ? undefined : rawMrp;
  if (typeof rawMrp === 'string') {
    const trimmed = rawMrp.trim();
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return undefined;
    const parsed = parseFloat(trimmed);
    return !isNaN(parsed) ? parsed : undefined;
  }
  if (typeof rawMrp === 'object' && rawMrp !== null && 'value' in (rawMrp as object)) {
    return parseMrp((rawMrp as { value: unknown }).value);
  }
  return undefined;
}

/** Normalize a raw batch (embedded or medicineBatches doc) into StockBatch. */
export function parseStockBatchFromRaw(
  batch: any,
  opts?: { docId?: string; medicineId?: string; gstRate?: number }
): StockBatch {
  const mrpValue = parseMrp(batch.mrp);
  const gstRate = opts?.gstRate ?? 5;
  return {
    id: String(opts?.docId || batch.id || ''),
    ...(opts?.medicineId || batch.medicineId
      ? { medicineId: String(opts?.medicineId || batch.medicineId) }
      : {}),
    batchNumber: String(batch.batchNumber ?? '').trim(),
    quantity: normalizeBatchQuantity(batch),
    expiryDate: normalizeFirestoreDate(batch.expiryDate),
    mfgDate: normalizeFirestoreDate(batch.mfgDate),
    purchaseDate: normalizeFirestoreDate(batch.purchaseDate),
    purchasePrice:
      batch.purchasePrice !== undefined && batch.purchasePrice !== null
        ? typeof batch.purchasePrice === 'number'
          ? batch.purchasePrice
          : parseFloat(String(batch.purchasePrice))
        : undefined,
    mrp: mrpValue,
    discountPercentage:
      batch.discountPercentage !== undefined && batch.discountPercentage !== null
        ? typeof batch.discountPercentage === 'number'
          ? batch.discountPercentage
          : parseFloat(String(batch.discountPercentage))
        : undefined,
    standardDiscount: standardDiscountFromStockBatch(
      { ...batch, mrp: mrpValue, purchasePrice: batch.purchasePrice },
      gstRate
    ),
    ...(batch.nonReturnable === true ? { nonReturnable: true as const } : {}),
    ...mapBatchLandedCost(batch),
    ...normalizeSchemeFromBatch(batch),
  };
}

/** Serialize a StockBatch for Firestore (medicineBatches doc or embedded array element). */
export function serializeBatchForFirestore(
  b: StockBatch | Record<string, any>,
  medicineId?: string
): Record<string, any> {
  const firestoreBatch: Record<string, any> = {
    id: b.id || Date.now().toString(),
    batchNumber: String(b.batchNumber ?? '').trim(),
    quantity: normalizeBatchQuantity(b),
  };

  if (medicineId || (b as StockBatch).medicineId) {
    firestoreBatch.medicineId = medicineId || (b as StockBatch).medicineId;
  }

  const expiry = toFirestoreTimestamp(b.expiryDate);
  if (expiry) firestoreBatch.expiryDate = expiry;
  const mfg = toFirestoreTimestamp(b.mfgDate);
  if (mfg) firestoreBatch.mfgDate = mfg;
  const purchase = toFirestoreTimestamp(b.purchaseDate);
  if (purchase) firestoreBatch.purchaseDate = purchase;
  else if (!(b as any).purchaseDate) {
    firestoreBatch.purchaseDate = nestedFirestoreTimestamp();
  }

  if (b.purchasePrice !== undefined && b.purchasePrice !== null) {
    firestoreBatch.purchasePrice =
      typeof b.purchasePrice === 'number' ? b.purchasePrice : parseFloat(String(b.purchasePrice));
  }
  if (b.mrp !== undefined && b.mrp !== null) {
    const mrpValue = typeof b.mrp === 'number' ? b.mrp : parseFloat(String(b.mrp));
    if (!isNaN(mrpValue)) firestoreBatch.mrp = mrpValue;
  }
  if (b.discountPercentage !== undefined && b.discountPercentage !== null) {
    const discountValue =
      typeof b.discountPercentage === 'number'
        ? b.discountPercentage
        : parseFloat(String(b.discountPercentage));
    if (!isNaN(discountValue)) firestoreBatch.discountPercentage = discountValue;
  }
  if (b.standardDiscount !== undefined && b.standardDiscount !== null) {
    const stdValue =
      typeof b.standardDiscount === 'number'
        ? b.standardDiscount
        : parseFloat(String(b.standardDiscount));
    if (!isNaN(stdValue)) firestoreBatch.standardDiscount = stdValue;
  }

  appendLandedCostToFirestoreBatch(firestoreBatch, b);
  appendSchemeFieldsToFirestoreBatch(firestoreBatch, b);
  if ((b as any).nonReturnable === true) {
    firestoreBatch.nonReturnable = true;
  }

  return firestoreBatch;
}

export function computeBatchAggregates(batches: StockBatch[]): {
  stock: number;
  nearestExpiry: Date | null;
  activeBatchCount: number;
} {
  let stock = 0;
  let nearestExpiry: Date | null = null;
  let activeBatchCount = 0;

  for (const b of batches) {
    const qty = normalizeBatchQuantity(b);
    stock += qty;
    if (qty <= 0) continue;
    activeBatchCount += 1;
    const exp = normalizeFirestoreDate(b.expiryDate);
    if (exp && (!nearestExpiry || exp.getTime() < nearestExpiry.getTime())) {
      nearestExpiry = exp;
    }
  }

  return { stock, nearestExpiry, activeBatchCount };
}

function parseGstRate(data: any): number {
  if (data?.gstRate !== undefined && data?.gstRate !== null) {
    return typeof data.gstRate === 'number' ? data.gstRate : parseFloat(String(data.gstRate)) || 5;
  }
  return 5;
}

function masterFromDoc(
  docSnapshot: { id: string; data: () => any },
  stockBatches?: StockBatch[]
): Medicine {
  const data = docSnapshot.data();
  const gstRate = parseGstRate(data);
  const batches = stockBatches;
  const fromBatches = batches && batches.length > 0 ? computeBatchAggregates(batches) : null;

  const stock =
    fromBatches?.stock ??
    (typeof data.stock === 'number'
      ? data.stock
      : typeof data.currentStock === 'number'
        ? data.currentStock
        : 0);

  const { stockBatches: _ignored, ...dataWithoutBatches } = data;

  return {
    id: docSnapshot.id,
    ...dataWithoutBatches,
    name: String(data.name || ''),
    manufacturer: String(data.manufacturer || ''),
    category: String(data.category || ''),
    code: data.code ? String(data.code) : undefined,
    unit: data.unit ? String(data.unit) : undefined,
    stock,
    currentStock: stock,
    nearestExpiry:
      fromBatches?.nearestExpiry ??
      normalizeFirestoreDate(data.nearestExpiry) ??
      normalizeFirestoreDate(data.expiryDate),
    activeBatchCount: fromBatches?.activeBatchCount ?? data.activeBatchCount ?? batches?.length,
    price: data.price || data.mrp || 0,
    stockBatches: batches,
    gstRate,
    description: data.description != null ? String(data.description) : undefined,
  };
}

/** Load batches for one medicine from medicineBatches (preferred). */
export const getMedicineBatches = async (medicineId: string): Promise<StockBatch[]> => {
  const q = query(
    collection(db, MEDICINE_BATCHES_COLLECTION),
    where('medicineId', '==', medicineId)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return [];

  // gstRate needed for standardDiscount — load once if any docs
  const medicineDoc = await getDoc(doc(db, 'medicines', medicineId));
  const gstRate = medicineDoc.exists() ? parseGstRate(medicineDoc.data()) : 5;

  return snapshot.docs.map((d) =>
    parseStockBatchFromRaw(d.data(), { docId: d.id, medicineId, gstRate })
  );
};

/**
 * Prefer medicineBatches; fall back to embedded stockBatches when collection has
 * no rows for this medicine (pre-migration / dual-write window).
 */
export const loadBatchesForMedicine = async (
  medicineId: string,
  embeddedFallback?: any[],
  gstRate: number = 5
): Promise<StockBatch[]> => {
  const fromCollection = await getMedicineBatches(medicineId);
  if (fromCollection.length > 0) return fromCollection;

  if (Array.isArray(embeddedFallback) && embeddedFallback.length > 0) {
    return embeddedFallback.map((b) =>
      parseStockBatchFromRaw(b, { docId: b.id, medicineId, gstRate })
    );
  }
  return [];
};

/** One full collection read of medicineBatches, grouped by medicineId. */
export const getAllMedicineBatchesGrouped = async (): Promise<Map<string, StockBatch[]>> => {
  const snapshot = await getDocs(collection(db, MEDICINE_BATCHES_COLLECTION));
  const map = new Map<string, StockBatch[]>();
  for (const d of snapshot.docs) {
    const data = d.data();
    const medicineId = String(data.medicineId || '');
    if (!medicineId) continue;
    const list = map.get(medicineId) || [];
    list.push(parseStockBatchFromRaw(data, { docId: d.id, medicineId }));
    map.set(medicineId, list);
  }
  return map;
};

async function persistMedicineStockState(
  medicineId: string,
  batches: StockBatch[]
): Promise<void> {
  const medicineRef = doc(db, 'medicines', medicineId);
  const aggregates = computeBatchAggregates(batches);
  const embedded = batches.map((b) => serializeBatchForFirestore(b, medicineId));

  // Remove medicineId from embedded array elements (legacy shape had no medicineId)
  const embeddedLegacy = embedded.map(({ medicineId: _m, ...rest }) => rest);

  const updateData: Record<string, any> = {
    stock: aggregates.stock,
    currentStock: aggregates.stock,
    activeBatchCount: aggregates.activeBatchCount,
    nearestExpiry: aggregates.nearestExpiry
      ? Timestamp.fromDate(aggregates.nearestExpiry)
      : null,
  };

  if (DUAL_WRITE_EMBEDDED_STOCK_BATCHES) {
    updateData.stockBatches = embeddedLegacy;
  } else {
    // Strip legacy embedded array if still present on the master doc
    updateData.stockBatches = deleteField();
  }

  await updateDoc(medicineRef, updateData);
}

/**
 * Replace all medicineBatches docs for a medicine with the given in-memory list,
 * then update master aggregates (+ dual-write embedded if enabled).
 */
async function replaceMedicineBatchesDocs(
  medicineId: string,
  batches: StockBatch[]
): Promise<void> {
  const existingSnap = await getDocs(
    query(collection(db, MEDICINE_BATCHES_COLLECTION), where('medicineId', '==', medicineId))
  );

  // Prefer updating in place by batchNumber to keep stable doc ids across merges.
  const existingByKey = new Map<string, { id: string }>();
  for (const d of existingSnap.docs) {
    existingByKey.set(batchKey(d.data().batchNumber), { id: d.id });
  }

  const desiredKeys = new Set(batches.map((b) => batchKey(b.batchNumber)));
  const finalized: StockBatch[] = [];

  let batchWriter = writeBatch(db);
  let opCount = 0;
  const flush = async (force = false) => {
    if (opCount === 0) return;
    if (!force && opCount < 450) return;
    await batchWriter.commit();
    batchWriter = writeBatch(db);
    opCount = 0;
  };

  // Delete docs whose batchNumber is no longer present
  for (const d of existingSnap.docs) {
    if (!desiredKeys.has(batchKey(d.data().batchNumber))) {
      batchWriter.delete(d.ref);
      opCount += 1;
      await flush();
    }
  }

  for (const b of batches) {
    const key = batchKey(b.batchNumber);
    const existing = existingByKey.get(key);
    const ref = existing
      ? doc(db, MEDICINE_BATCHES_COLLECTION, existing.id)
      : b.id
        ? doc(db, MEDICINE_BATCHES_COLLECTION, b.id)
        : doc(collection(db, MEDICINE_BATCHES_COLLECTION));
    const payload = serializeBatchForFirestore({ ...b, id: ref.id }, medicineId);
    payload.id = ref.id;
    batchWriter.set(ref, payload);
    opCount += 1;
    finalized.push({ ...b, id: ref.id, medicineId });
    await flush();
  }
  await flush(true);

  await persistMedicineStockState(medicineId, finalized);
}

/** Upsert a single batch doc by batchNumber (merge qty / fields), update aggregates. */
async function upsertMedicineBatchDoc(
  medicineId: string,
  batchInput: Omit<StockBatch, 'id'> & { id?: string },
  mode: 'addQty' | 'set'
): Promise<StockBatch[]> {
  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  if (!medicineDoc.exists()) {
    throw new Error('Medicine not found');
  }

  const gstRate = parseGstRate(medicineDoc.data());
  let batches = await loadBatchesForMedicine(
    medicineId,
    medicineDoc.data()?.stockBatches,
    gstRate
  );

  const key = batchKey(batchInput.batchNumber);
  const idx = batches.findIndex((b) => batchKey(b.batchNumber) === key);
  const incoming = serializeBatchForFirestore(
    {
      id: batchInput.id || Date.now().toString(),
      ...batchInput,
    } as StockBatch,
    medicineId
  );

  if (idx >= 0) {
    const existing = batches[idx];
    const nextQty =
      mode === 'addQty'
        ? normalizeBatchQuantity(existing) + normalizeBatchQuantity(batchInput)
        : normalizeBatchQuantity(batchInput);

    const merged: StockBatch = parseStockBatchFromRaw(
      {
        ...serializeBatchForFirestore(existing, medicineId),
        ...incoming,
        quantity: nextQty,
        id: existing.id,
        medicineId,
        // Preserve nonReturnable if either set
        nonReturnable:
          batchInput.nonReturnable === true || existing.nonReturnable === true ? true : undefined,
      },
      { docId: existing.id, medicineId, gstRate }
    );
    batches[idx] = merged;
  } else {
    const newId = batchInput.id || doc(collection(db, MEDICINE_BATCHES_COLLECTION)).id;
    batches.push(
      parseStockBatchFromRaw(
        { ...incoming, id: newId, quantity: normalizeBatchQuantity(batchInput) },
        { docId: newId, medicineId, gstRate }
      )
    );
  }

  await replaceMedicineBatchesDocs(medicineId, batches);
  return batches;
}

export const getAllMedicines = async (): Promise<Medicine[]> => {
  const medicinesCol = collection(db, 'medicines');
  const snapshot = await getDocs(medicinesCol);

  // Prefer one collection read of medicineBatches over N per-medicine queries
  const grouped = await getAllMedicineBatchesGrouped();

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data();
    const gstRate = parseGstRate(data);
    let batches: StockBatch[] | undefined;

    const fromCollection = grouped.get(docSnapshot.id);
    if (fromCollection && fromCollection.length > 0) {
      batches = fromCollection.map((b) =>
        parseStockBatchFromRaw(
          { ...b, expiryDate: b.expiryDate, mfgDate: b.mfgDate, purchaseDate: b.purchaseDate },
          { docId: b.id, medicineId: docSnapshot.id, gstRate }
        )
      );
    } else if (Array.isArray(data.stockBatches) && data.stockBatches.length > 0) {
      // Fallback for pre-migration / dual-write window
      batches = data.stockBatches.map((b: any) =>
        parseStockBatchFromRaw(b, { docId: b.id, medicineId: docSnapshot.id, gstRate })
      );
    } else {
      batches = [];
    }

    return masterFromDoc(docSnapshot, batches);
  });
};

/** Master fields only — no batch hydration (lighter list reads). */
export const getAllMedicinesMasterOnly = async (): Promise<Medicine[]> => {
  const snapshot = await getDocs(collection(db, 'medicines'));
  return snapshot.docs.map((docSnapshot) => masterFromDoc(docSnapshot, undefined));
};

export const getMedicineById = async (medicineId: string): Promise<Medicine | null> => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  if (!medicineDoc.exists()) return null;

  const data = medicineDoc.data();
  const gstRate = parseGstRate(data);
  const batches = await loadBatchesForMedicine(medicineId, data.stockBatches, gstRate);
  return masterFromDoc(medicineDoc, batches);
};

/** Hydrate specific medicines with batches (order fulfillment). Batched Firestore reads. */
export const getMedicinesByIdsWithBatches = async (
  medicineIds: string[]
): Promise<Medicine[]> => {
  const unique = [...new Set(medicineIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const IN_LIMIT = 30;
  const medicineById = new Map<string, { id: string; data: () => any }>();
  const batchesByMedicine = new Map<string, StockBatch[]>();

  // Masters: documentId() in […] (≤30 per query)
  for (let i = 0; i < unique.length; i += IN_LIMIT) {
    const chunk = unique.slice(i, i + IN_LIMIT);
    const snap = await getDocs(
      query(collection(db, 'medicines'), where(documentId(), 'in', chunk))
    );
    for (const d of snap.docs) {
      medicineById.set(d.id, d);
    }
  }

  // Batches: medicineId in […] (≤30 per query)
  for (let i = 0; i < unique.length; i += IN_LIMIT) {
    const chunk = unique.slice(i, i + IN_LIMIT);
    const snap = await getDocs(
      query(
        collection(db, MEDICINE_BATCHES_COLLECTION),
        where('medicineId', 'in', chunk)
      )
    );
    for (const d of snap.docs) {
      const data = d.data();
      const mid = String(data.medicineId || '');
      if (!mid) continue;
      const gstRate = medicineById.has(mid)
        ? parseGstRate(medicineById.get(mid)!.data())
        : 5;
      const list = batchesByMedicine.get(mid) || [];
      list.push(parseStockBatchFromRaw(data, { docId: d.id, medicineId: mid, gstRate }));
      batchesByMedicine.set(mid, list);
    }
  }

  const results: Medicine[] = [];
  for (const id of unique) {
    const snap = medicineById.get(id);
    if (!snap) continue;
    const data = snap.data();
    const gstRate = parseGstRate(data);
    let batches = batchesByMedicine.get(id) || [];
    // Legacy fallback if collection empty but embedded array still present
    if (
      batches.length === 0 &&
      Array.isArray(data.stockBatches) &&
      data.stockBatches.length > 0
    ) {
      batches = data.stockBatches.map((b: any) =>
        parseStockBatchFromRaw(b, { docId: b.id, medicineId: id, gstRate })
      );
    }
    results.push(masterFromDoc(snap, batches));
  }
  return results;
};

export const updateMedicineStock = async (
  medicineId: string,
  updates: {
    stock?: number;
    currentStock?: number;
    expiryDate?: Date;
    batchNumber?: string;
    barcode?: string;
    mrp?: number;
  }
) => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const updateData: any = { ...updates };

  if (updates.expiryDate) {
    updateData.expiryDate = Timestamp.fromDate(updates.expiryDate);
    updateData.nearestExpiry = Timestamp.fromDate(updates.expiryDate);
  }

  await updateDoc(medicineRef, updateData);
};

export const addStockBatch = async (medicineId: string, batch: Omit<StockBatch, 'id'>) => {
  console.log(
    `Adding/merging batch ${batch.batchNumber} qty=${batch.quantity} for medicine ${medicineId}`
  );
  await upsertMedicineBatchDoc(medicineId, batch, 'addQty');
  console.log(`✓ Medicine ${medicineId} stock batch upserted`);
};

export const reduceStockFromBatch = async (
  medicineId: string,
  batchNumber: string,
  quantityToReduce: number
) => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  if (!medicineDoc.exists()) {
    throw new Error('Medicine not found');
  }

  const gstRate = parseGstRate(medicineDoc.data());
  const batches = await loadBatchesForMedicine(
    medicineId,
    medicineDoc.data()?.stockBatches,
    gstRate
  );

  const key = batchKey(batchNumber);
  const batchIndex = batches.findIndex((b) => batchKey(b.batchNumber) === key);
  if (batchIndex < 0) {
    throw new Error(`Batch ${batchNumber} not found for medicine ${medicineId}`);
  }

  const currentQuantity = batches[batchIndex].quantity || 0;
  if (currentQuantity < quantityToReduce) {
    throw new Error(
      `Insufficient stock in batch ${batchNumber}. Available: ${currentQuantity}, Required: ${quantityToReduce}`
    );
  }

  batches[batchIndex] = {
    ...batches[batchIndex],
    quantity: currentQuantity - quantityToReduce,
  };

  console.log(
    `Reducing stock for medicine ${medicineId}, batch ${batchNumber}: ${currentQuantity} - ${quantityToReduce} = ${batches[batchIndex].quantity}`
  );
  await replaceMedicineBatchesDocs(medicineId, batches);
  console.log(`✓ Stock reduced successfully`);
};

export const restoreStockToBatch = async (
  medicineId: string,
  batchNumber: string,
  quantityToRestore: number
) => {
  await restoreStockBatchesToMedicine(medicineId, [{ batchNumber, quantity: quantityToRestore }]);
};

/** Restore multiple batch quantities on one medicine in a single read/write. */
export const restoreStockBatchesToMedicine = async (
  medicineId: string,
  restores: Array<{ batchNumber: string; quantity: number }>
) => {
  if (!restores.length) return;

  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  if (!medicineDoc.exists()) {
    throw new Error(`Medicine ${medicineId} not found`);
  }

  const gstRate = parseGstRate(medicineDoc.data());
  const batches = await loadBatchesForMedicine(
    medicineId,
    medicineDoc.data()?.stockBatches,
    gstRate
  );

  for (const restore of restores) {
    if (!restore.batchNumber || restore.quantity <= 0) continue;
    const key = batchKey(restore.batchNumber);
    const batchIndex = batches.findIndex((b) => batchKey(b.batchNumber) === key);
    if (batchIndex === -1) {
      throw new Error(`Batch ${restore.batchNumber} not found for medicine ${medicineId}`);
    }
    const currentQuantity = batches[batchIndex].quantity || 0;
    batches[batchIndex] = {
      ...batches[batchIndex],
      quantity: currentQuantity + restore.quantity,
    };
    console.log(
      `Restoring stock for medicine ${medicineId}, batch ${restore.batchNumber}: ${currentQuantity} + ${restore.quantity} = ${batches[batchIndex].quantity}`
    );
  }

  await replaceMedicineBatchesDocs(medicineId, batches);
  console.log(`✓ Stock restored successfully`);
};

export const findMedicineByBarcode = async (barcode: string): Promise<Medicine | null> => {
  const medicinesCol = collection(db, 'medicines');

  try {
    const q = query(medicinesCol, where('barcode', '==', barcode));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return getMedicineById(snapshot.docs[0].id);
    }
  } catch (error) {
    console.warn('Barcode query failed:', error);
  }

  try {
    const codeQuery = query(medicinesCol, where('code', '==', barcode));
    const codeSnapshot = await getDocs(codeQuery);
    if (!codeSnapshot.empty) {
      return getMedicineById(codeSnapshot.docs[0].id);
    }
  } catch (error) {
    console.warn('Code query failed:', error);
  }

  return null;
};

/**
 * Pure filters that operate on an already-loaded medicines array. Prefer these
 * (fed from the cached `useMedicines()` result) over the async variants below to
 * avoid re-reading the whole medicines collection just to compute expiry counts.
 */
export const filterExpiringMedicines = (
  medicines: Medicine[],
  days: number = 30
): Medicine[] => {
  const today = new Date();
  const expiryThreshold = new Date();
  expiryThreshold.setDate(today.getDate() + days);

  return medicines.filter((medicine) => {
    // Prefer nearestExpiry (master aggregate) or soonest batch expiry
    let expiry: Date | undefined = normalizeFirestoreDate(medicine.nearestExpiry);
    if (!expiry && medicine.stockBatches?.length) {
      for (const b of medicine.stockBatches) {
        if (normalizeBatchQuantity(b) <= 0) continue;
        const e = normalizeFirestoreDate(b.expiryDate);
        if (e && (!expiry || e.getTime() < expiry.getTime())) expiry = e;
      }
    }
    if (!expiry) expiry = normalizeFirestoreDate(medicine.expiryDate);
    if (!expiry) return false;
    return expiry <= expiryThreshold && expiry >= today;
  });
};

export const filterExpiredMedicines = (medicines: Medicine[]): Medicine[] => {
  const today = new Date();

  return medicines.filter((medicine) => {
    let expiry: Date | undefined = normalizeFirestoreDate(medicine.nearestExpiry);
    if (!expiry && medicine.stockBatches?.length) {
      for (const b of medicine.stockBatches) {
        if (normalizeBatchQuantity(b) <= 0) continue;
        const e = normalizeFirestoreDate(b.expiryDate);
        if (e && (!expiry || e.getTime() < expiry.getTime())) expiry = e;
      }
    }
    if (!expiry) expiry = normalizeFirestoreDate(medicine.expiryDate);
    if (!expiry) return false;
    return expiry < today;
  });
};

export const getExpiringMedicines = async (days: number = 30): Promise<Medicine[]> => {
  const medicines = await getAllMedicinesMasterOnly();
  return filterExpiringMedicines(medicines, days);
};

export const getExpiredMedicines = async (): Promise<Medicine[]> => {
  const medicines = await getAllMedicinesMasterOnly();
  return filterExpiredMedicines(medicines);
};

export const updateMedicine = async (
  medicineId: string,
  updates: Partial<Medicine>
): Promise<void> => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const cleanUpdates: any = {};

  if (updates.name !== undefined) cleanUpdates.name = updates.name;
  if (updates.code !== undefined) cleanUpdates.code = updates.code;
  if (updates.category !== undefined) cleanUpdates.category = updates.category;
  if (updates.unit !== undefined) cleanUpdates.unit = updates.unit;
  if (updates.manufacturer !== undefined) cleanUpdates.manufacturer = updates.manufacturer;
  if (updates.gstRate !== undefined) cleanUpdates.gstRate = updates.gstRate;
  if (updates.description !== undefined) cleanUpdates.description = updates.description;
  if (updates.composition !== undefined) cleanUpdates.composition = updates.composition;
  if (updates.dosage !== undefined) cleanUpdates.dosage = updates.dosage;
  if (updates.sideEffects !== undefined) cleanUpdates.sideEffects = updates.sideEffects;

  await updateDoc(medicineRef, cleanUpdates);
};

/** Toggle non-returnable on an existing inventory batch (used when editing PI lines). */
export const setStockBatchNonReturnable = async (
  medicineId: string,
  batchNumber: string,
  nonReturnable: boolean
): Promise<void> => {
  if (!medicineId || !batchNumber) return;

  const medicineDoc = await getDoc(doc(db, 'medicines', medicineId));
  if (!medicineDoc.exists()) return;

  const gstRate = parseGstRate(medicineDoc.data());
  const batches = await loadBatchesForMedicine(
    medicineId,
    medicineDoc.data()?.stockBatches,
    gstRate
  );

  const key = batchKey(batchNumber);
  const batchIndex = batches.findIndex((b) => batchKey(b.batchNumber) === key);
  if (batchIndex < 0) return;

  if (nonReturnable) {
    batches[batchIndex] = { ...batches[batchIndex], nonReturnable: true };
  } else {
    const { nonReturnable: _n, ...rest } = batches[batchIndex] as StockBatch & {
      nonReturnable?: boolean;
    };
    batches[batchIndex] = rest as StockBatch;
  }

  await replaceMedicineBatchesDocs(medicineId, batches);
};

export const createMedicine = async (medicineData: Omit<Medicine, 'id'>): Promise<string> => {
  const medicineRef = doc(collection(db, 'medicines'));
  const newMedicine: any = {
    name: medicineData.name,
    category: medicineData.category,
    manufacturer: medicineData.manufacturer,
    stock: medicineData.stock || 0,
    currentStock: medicineData.currentStock || medicineData.stock || 0,
    activeBatchCount: 0,
    nearestExpiry: null,
    gstRate:
      medicineData.gstRate !== undefined && medicineData.gstRate !== null
        ? medicineData.gstRate
        : 5,
    price: 0,
    migrationVersion: MEDICINE_MIGRATION_VERSION,
  };

  if (medicineData.code) newMedicine.code = medicineData.code;
  if (medicineData.unit) newMedicine.unit = medicineData.unit;
  if (medicineData.description) newMedicine.description = medicineData.description;
  if (medicineData.imageUrl) newMedicine.imageUrl = medicineData.imageUrl;

  await setDoc(medicineRef, newMedicine);
  return medicineRef.id;
};

/**
 * Delete a medicineBatches doc by id (admin/maintenance). Prefer quantity=0 over delete
 * for normal stock flows.
 */
export const deleteMedicineBatchDoc = async (batchDocId: string): Promise<void> => {
  await deleteDoc(doc(db, MEDICINE_BATCHES_COLLECTION, batchDocId));
};

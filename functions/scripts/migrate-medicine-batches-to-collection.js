/**
 * Migrate embedded medicines.stockBatches[] → top-level medicineBatches collection.
 *
 * Auth: Firebase CLI login refresh token (same as clone-prod-to-dev.js).
 * Default project: simplipharma-dev
 *
 * Usage (from functions/):
 *   node scripts/migrate-medicine-batches-to-collection.js
 *   node scripts/migrate-medicine-batches-to-collection.js simplipharma-dev --dry-run
 *   node scripts/migrate-medicine-batches-to-collection.js simplipharma-dev --force
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { OAuth2Client } = require('google-auth-library');
const { Firestore, FieldValue, Timestamp } = require('@google-cloud/firestore');

const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const projectId =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'simplipharma-dev';
const dryRun = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const MIGRATION_VERSION = 2;
const MEDICINE_BATCHES = 'medicineBatches';
const WRITE_BATCH_SIZE = 400;

function loadFirebaseTokens() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('firebase-tools.json not found. Run `firebase login` first.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config?.tokens;
  if (!tokens?.refresh_token) {
    throw new Error('No Firebase refresh token found. Run `firebase login` again.');
  }
  return tokens;
}

async function getFirestore(pid) {
  const tokens = loadFirebaseTokens();
  const client = new OAuth2Client(FIREBASE_CLIENT_ID, FIREBASE_CLIENT_SECRET);
  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expires_at,
  });
  await client.getAccessToken();
  return new Firestore({ projectId: pid, authClient: client });
}

function batchKey(batchNumber) {
  return String(batchNumber ?? '')
    .trim()
    .toLowerCase();
}

function qty(batch) {
  if (typeof batch.quantity === 'number' && !isNaN(batch.quantity)) {
    return Math.max(0, Math.floor(batch.quantity));
  }
  const n = parseInt(String(batch.quantity ?? '0'), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function serializeBatch(medicineId, batch, docId) {
  return stripUndefined({
    id: docId,
    medicineId,
    batchNumber: String(batch.batchNumber ?? '').trim(),
    quantity: qty(batch),
    expiryDate: batch.expiryDate || undefined,
    mfgDate: batch.mfgDate || undefined,
    purchaseDate: batch.purchaseDate || undefined,
    purchasePrice:
      batch.purchasePrice !== undefined && batch.purchasePrice !== null
        ? Number(batch.purchasePrice)
        : undefined,
    mrp: batch.mrp !== undefined && batch.mrp !== null ? Number(batch.mrp) : undefined,
    discountPercentage:
      batch.discountPercentage !== undefined && batch.discountPercentage !== null
        ? Number(batch.discountPercentage)
        : undefined,
    standardDiscount:
      batch.standardDiscount !== undefined && batch.standardDiscount !== null
        ? Number(batch.standardDiscount)
        : undefined,
    landedUnitCostExGst:
      batch.landedUnitCostExGst !== undefined && batch.landedUnitCostExGst !== null
        ? Number(batch.landedUnitCostExGst)
        : undefined,
    schemePaidQty:
      batch.schemePaidQty != null
        ? Number(batch.schemePaidQty)
        : batch.purchaseSchemeDeal != null
          ? Number(batch.purchaseSchemeDeal)
          : undefined,
    schemeFreeQty:
      batch.schemeFreeQty != null
        ? Number(batch.schemeFreeQty)
        : batch.purchaseSchemeFree != null
          ? Number(batch.purchaseSchemeFree)
          : undefined,
    nonReturnable: batch.nonReturnable === true ? true : undefined,
  });
}

function computeAggregates(batches) {
  let stock = 0;
  let nearestExpiry = null;
  let activeBatchCount = 0;
  for (const b of batches) {
    const q = qty(b);
    stock += q;
    if (q <= 0) continue;
    activeBatchCount += 1;
    const exp = b.expiryDate?.toDate?.()
      ? b.expiryDate.toDate()
      : b.expiryDate
        ? new Date(b.expiryDate)
        : null;
    if (exp && !isNaN(exp.getTime())) {
      if (!nearestExpiry || exp.getTime() < nearestExpiry.getTime()) nearestExpiry = exp;
    }
  }
  return { stock, nearestExpiry, activeBatchCount };
}

function hasTransactionalData(data) {
  const embedded = Array.isArray(data.stockBatches) ? data.stockBatches : [];
  return (
    embedded.length > 0 ||
    (typeof data.stock === 'number' && data.stock > 0) ||
    (typeof data.currentStock === 'number' && data.currentStock > 0)
  );
}

async function migrateTransactionalMedicine(db, medDoc) {
  const medicineId = medDoc.id;
  const data = medDoc.data() || {};
  const embedded = Array.isArray(data.stockBatches) ? data.stockBatches : [];

  if (!FORCE && data.migrationVersion >= MIGRATION_VERSION) {
    const existing = await db
      .collection(MEDICINE_BATCHES)
      .where('medicineId', '==', medicineId)
      .get();
    if (existing.size >= embedded.length || (embedded.length === 0 && existing.size === 0)) {
      return { status: 'skipped', medicineId };
    }
  }

  const existingSnap = await db
    .collection(MEDICINE_BATCHES)
    .where('medicineId', '==', medicineId)
    .get();
  const existingByKey = new Map();
  for (const d of existingSnap.docs) {
    existingByKey.set(batchKey(d.data().batchNumber), d);
  }

  const written = [];
  let writer = db.batch();
  let ops = 0;
  const flush = async (force = false) => {
    if (ops === 0) return;
    if (!force && ops < WRITE_BATCH_SIZE) return;
    if (!dryRun) await writer.commit();
    writer = db.batch();
    ops = 0;
  };

  for (const b of embedded) {
    const key = batchKey(b.batchNumber);
    if (!key) continue;
    const existing = existingByKey.get(key);
    const ref = existing
      ? existing.ref
      : b.id
        ? db.collection(MEDICINE_BATCHES).doc(String(b.id))
        : db.collection(MEDICINE_BATCHES).doc();
    const payload = serializeBatch(medicineId, b, ref.id);
    if (!dryRun) writer.set(ref, payload, { merge: true });
    ops += 1;
    written.push(payload);
    await flush();
  }
  await flush(true);

  const aggregates = computeAggregates(embedded.length ? embedded : written);
  if (!dryRun) {
    await medDoc.ref.update({
      stock: aggregates.stock,
      currentStock: aggregates.stock,
      activeBatchCount: aggregates.activeBatchCount,
      nearestExpiry: aggregates.nearestExpiry
        ? Timestamp.fromDate(aggregates.nearestExpiry)
        : null,
      migrationVersion: MIGRATION_VERSION,
      batchesMigratedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    status: 'migrated',
    medicineId,
    batches: written.length,
    stock: aggregates.stock,
  };
}

async function stampMasterOnlyBatched(db, docs) {
  let writer = db.batch();
  let ops = 0;
  let stamped = 0;

  for (const medDoc of docs) {
    if (!FORCE && (medDoc.data() || {}).migrationVersion >= MIGRATION_VERSION) {
      continue;
    }
    if (!dryRun) {
      writer.update(medDoc.ref, {
        migrationVersion: MIGRATION_VERSION,
        activeBatchCount: 0,
        nearestExpiry: null,
        batchesMigratedAt: FieldValue.serverTimestamp(),
      });
    }
    ops += 1;
    stamped += 1;
    if (ops >= WRITE_BATCH_SIZE) {
      if (!dryRun) await writer.commit();
      writer = db.batch();
      ops = 0;
      process.stdout.write(`  stamped ${stamped} master-only...\n`);
    }
  }
  if (ops > 0 && !dryRun) await writer.commit();
  return stamped;
}

async function main() {
  console.log('Project:', projectId);
  console.log('Dry run:', dryRun);
  console.log('Force:', FORCE);
  console.log('---');

  const db = await getFirestore(projectId);
  const snap = await db.collection('medicines').get();
  console.log('Medicines:', snap.size);

  const transactional = [];
  const masterOnly = [];
  for (const medDoc of snap.docs) {
    const data = medDoc.data() || {};
    if (hasTransactionalData(data) || FORCE) {
      if (hasTransactionalData(data)) transactional.push(medDoc);
      else masterOnly.push(medDoc);
    } else {
      masterOnly.push(medDoc);
    }
  }

  console.log('Transactional (have stock/batches):', transactional.length);
  console.log('Master-only to stamp:', masterOnly.length);

  const stats = {
    migrated: 0,
    masterOnly: 0,
    skipped: 0,
    batches: 0,
    errors: [],
  };

  for (const medDoc of transactional) {
    try {
      const result = await migrateTransactionalMedicine(db, medDoc);
      if (result.status === 'migrated') {
        stats.migrated += 1;
        stats.batches += result.batches || 0;
        console.log(
          `✓ ${result.medicineId} batches=${result.batches} stock=${result.stock}`
        );
      } else {
        stats.skipped += 1;
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      stats.errors.push({ medicineId: medDoc.id, error: msg });
      console.error(`✗ ${medDoc.id}`, msg);
    }
  }

  console.log('Stamping master-only medicines in batches...');
  try {
    stats.masterOnly = await stampMasterOnlyBatched(db, masterOnly);
    console.log(`✓ master-only stamped: ${stats.masterOnly}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    stats.errors.push({ medicineId: '(master-only-batch)', error: msg });
    console.error('✗ master-only stamp failed', msg);
  }

  // Verify
  const batchCount = (await db.collection(MEDICINE_BATCHES).get()).size;
  console.log('---');
  console.log('medicineBatches docs now:', batchCount);
  console.log(JSON.stringify(stats, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

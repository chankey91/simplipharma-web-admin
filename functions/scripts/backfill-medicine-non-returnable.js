/**
 * Set medicines.nonReturnable from the latest batch plus the product rule.
 *
 * - Injection, protein powder, soap, and lotion (name or category) apply to every medicine.
 * - MRP over 1000 uses the latest batch, and only when the medicine has at least one batch.
 * - A latest batch already marked non-returnable also sets the master true.
 * - Medicines that already have true or false are left unchanged.
 * - Only writes true. Medicines that do not match stay unset until the next time they are opened.
 *
 * Auth: Firebase CLI login (same as the other scripts in this folder).
 *
 * Usage (from functions/):
 *   node scripts/backfill-medicine-non-returnable.js simplipharma --dry-run
 *   node scripts/backfill-medicine-non-returnable.js simplipharma
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { OAuth2Client } = require('google-auth-library');
const { Firestore, FieldPath } = require('@google-cloud/firestore');

const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const projectId =
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'simplipharma';
const dryRun = process.argv.includes('--dry-run');

const PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 200;
const INJECTION_CATEGORY_KEYS = new Set(['inj', 'injeciton', 'injaction']);

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

function normalizeCategoryKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function timeMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value.toMillis === 'function') {
    const t = value.toMillis();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value.toDate === 'function') {
    const t = value.toDate()?.getTime?.();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return undefined;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

function isProteinPowder(name, categoryKey) {
  if (
    categoryKey === 'protin powder' ||
    categoryKey === 'protein powder' ||
    categoryKey === 'protein power'
  ) {
    return true;
  }
  return (
    /protein\s+powders?/i.test(name) ||
    /protein\s+powers?/i.test(name) ||
    /protin\s+powders?/i.test(name) ||
    /whey\s+proteins?/i.test(name)
  );
}

function matchesNameOrCategory(name, category) {
  const categoryKey = normalizeCategoryKey(category);
  const haystack = `${name} ${category}`;
  if (
    categoryKey.includes('injection') ||
    INJECTION_CATEGORY_KEYS.has(categoryKey) ||
    /\binjections?\b/i.test(name) ||
    /\binj\b/i.test(name)
  ) {
    return true;
  }
  if (/\bsoaps?\b/i.test(haystack)) return true;
  if (/\blotions?\b/i.test(haystack)) return true;
  if (isProteinPowder(name, categoryKey)) return true;
  return false;
}

function considerBatch(current, batch, extraMs) {
  if (!batch || typeof batch !== 'object') return current;
  const ms = timeMs(batch.purchaseDate) || extraMs || 0;
  if (!current || ms >= current.ms) {
    return {
      ms,
      mrp: asNumber(batch.mrp),
      nonReturnable: batch.nonReturnable === true,
    };
  }
  return current;
}

async function eachPage(db, collectionName, selectFields, onDoc) {
  let last = null;
  let pages = 0;
  for (;;) {
    let query = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .select(...selectFields)
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    pages += 1;
    for (const doc of snap.docs) await onDoc(doc);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
    if (pages % 20 === 0) {
      console.log(`  read ${pages * PAGE_SIZE} ${collectionName}…`);
    }
  }
}

async function main() {
  console.log(`Project: ${projectId}${dryRun ? ' (dry run)' : ''}`);
  const db = await getFirestore(projectId);
  const latestByMedicine = new Map();

  console.log('Reading medicineBatches…');
  await eachPage(
    db,
    'medicineBatches',
    ['medicineId', 'mrp', 'nonReturnable', 'purchaseDate'],
    async (doc) => {
      const data = doc.data() || {};
      const medicineId = String(data.medicineId || '').trim();
      if (!medicineId) return;
      const createMs = doc.createTime?.toMillis?.() || 0;
      latestByMedicine.set(
        medicineId,
        considerBatch(latestByMedicine.get(medicineId), data, createMs)
      );
    }
  );
  console.log(`Medicines with collection batches: ${latestByMedicine.size}`);

  const stats = {
    scanned: 0,
    deleted: 0,
    alreadySet: 0,
    withBatch: 0,
    byNameOrCategory: 0,
    byMrp: 0,
    byExistingBatchFlag: 0,
    setTrue: 0,
    unchangedFalse: 0,
  };
  let batch = db.batch();
  let pending = 0;

  const flush = async () => {
    if (pending === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  console.log('Reading medicines…');
  await eachPage(db, 'medicines', ['name', 'category', 'nonReturnable', 'stockBatches', 'deleted'], async (doc) => {
    const data = doc.data() || {};
    stats.scanned += 1;
    if (data.deleted === true) {
      stats.deleted += 1;
      return;
    }
    if (data.nonReturnable === true || data.nonReturnable === false) {
      stats.alreadySet += 1;
      return;
    }

    let latest = latestByMedicine.get(doc.id) || null;
    const embedded = Array.isArray(data.stockBatches) ? data.stockBatches : [];
    for (const row of embedded) {
      latest = considerBatch(latest, row, 0);
    }
    if (latest) stats.withBatch += 1;

    const name = String(data.name || '');
    const category = String(data.category || '');
    const byName = matchesNameOrCategory(name, category);
    const byMrp = Boolean(latest) && typeof latest.mrp === 'number' && latest.mrp > 1000;
    const byFlag = Boolean(latest?.nonReturnable);
    if (byName) stats.byNameOrCategory += 1;
    if (byMrp) stats.byMrp += 1;
    if (byFlag) stats.byExistingBatchFlag += 1;

    const nonReturnable = byName || byMrp || byFlag;
    if (!nonReturnable) {
      stats.unchangedFalse += 1;
      return;
    }

    stats.setTrue += 1;
    if (!dryRun) {
      batch.update(doc.ref, { nonReturnable: true });
      pending += 1;
      if (pending >= WRITE_BATCH_SIZE) await flush();
    }
  });

  await flush();
  console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

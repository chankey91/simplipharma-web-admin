/**
 * Remove legacy embedded medicines.stockBatches after dual-write is off.
 * Default project: simplipharma-dev
 *
 * Usage (from functions/):
 *   node scripts/cleanup-embedded-stock-batches.js
 *   node scripts/cleanup-embedded-stock-batches.js simplipharma-dev --dry-run
 *
 * Safety: refuses to delete embedded batches for a medicine that has no
 * medicineBatches rows when the embedded array is non-empty (unless --force).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { OAuth2Client } = require('google-auth-library');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const projectId =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'simplipharma-dev';
const dryRun = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

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

async function main() {
  console.log('Project:', projectId);
  console.log('Dry run:', dryRun);
  console.log('Force:', FORCE);
  console.log('---');

  const db = await getFirestore(projectId);

  const [medsSnap, batchesSnap] = await Promise.all([
    db.collection('medicines').get(),
    db.collection(MEDICINE_BATCHES).get(),
  ]);

  const batchCountByMedicine = new Map();
  for (const d of batchesSnap.docs) {
    const mid = String(d.data().medicineId || '');
    if (!mid) continue;
    batchCountByMedicine.set(mid, (batchCountByMedicine.get(mid) || 0) + 1);
  }

  console.log('Medicines:', medsSnap.size);
  console.log('medicineBatches docs:', batchesSnap.size);

  let writer = db.batch();
  let ops = 0;
  const stats = {
    cleared: 0,
    skippedNoField: 0,
    skippedUnsafe: 0,
    errors: [],
  };

  const flush = async (force = false) => {
    if (ops === 0) return;
    if (!force && ops < WRITE_BATCH_SIZE) return;
    if (!dryRun) await writer.commit();
    writer = db.batch();
    ops = 0;
  };

  for (const medDoc of medsSnap.docs) {
    const data = medDoc.data() || {};
    if (!Object.prototype.hasOwnProperty.call(data, 'stockBatches')) {
      stats.skippedNoField += 1;
      continue;
    }

    const embedded = Array.isArray(data.stockBatches) ? data.stockBatches : [];
    const collectionCount = batchCountByMedicine.get(medDoc.id) || 0;

    if (!FORCE && embedded.length > 0 && collectionCount === 0) {
      stats.skippedUnsafe += 1;
      console.warn(
        `⚠ skip ${medDoc.id}: embedded=${embedded.length} but medicineBatches=0 (use --force to override)`
      );
      continue;
    }

    try {
      if (!dryRun) {
        writer.update(medDoc.ref, { stockBatches: FieldValue.delete() });
      }
      ops += 1;
      stats.cleared += 1;
      await flush();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      stats.errors.push({ medicineId: medDoc.id, error: msg });
      console.error(`✗ ${medDoc.id}`, msg);
    }
  }

  await flush(true);

  console.log('---');
  console.log(JSON.stringify(stats, null, 2));
  if (stats.errors.length || stats.skippedUnsafe) process.exitCode = stats.errors.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

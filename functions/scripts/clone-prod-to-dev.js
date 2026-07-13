/**
 * Clone Firebase Auth (with passwords) and Firestore from prod → dev.
 *
 * Uses the Firebase CLI login refresh token (same account as `firebase login`).
 * Run from functions/: node scripts/clone-prod-to-dev.js
 *
 * Optional flags:
 *   --auth-only       Only re-import Auth users with password hashes
 *   --firestore-only  Only clone Firestore data
 *   --skip-collections=comma,separated,ids   Skip these root collections
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { OAuth2Client } = require('google-auth-library');
const { Firestore } = require('@google-cloud/firestore');

const PROD_PROJECT = 'simplipharma';
const DEV_PROJECT = 'simplipharma-dev';
const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const AUTH_EXPORT_FILE = path.resolve(
  __dirname,
  '../../scripts/migrations/prod-users.json'
);
const BATCH_SIZE = 400;

const authOnly = process.argv.includes('--auth-only');
const firestoreOnly = process.argv.includes('--firestore-only');
const skipCollectionsArg = process.argv.find((arg) => arg.startsWith('--skip-collections='));
const skipCollections = new Set(
  skipCollectionsArg
    ? skipCollectionsArg
        .slice('--skip-collections='.length)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : []
);

function loadFirebaseTokens() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'firebase-tools.json not found. Run `firebase login` first.'
    );
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config?.tokens;
  if (!tokens?.refresh_token) {
    throw new Error('No Firebase refresh token found. Run `firebase login` again.');
  }
  return tokens;
}

async function getOAuthClient() {
  const tokens = loadFirebaseTokens();
  const client = new OAuth2Client(FIREBASE_CLIENT_ID, FIREBASE_CLIENT_SECRET);
  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expires_at,
  });
  await client.getAccessToken();
  return client;
}

async function getFirestore(projectId) {
  const authClient = await getOAuthClient();
  return new Firestore({ projectId, authClient });
}

async function fetchProdHashConfig() {
  const client = await getOAuthClient();
  const token = (await client.getAccessToken()).token;
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROD_PROJECT}/config`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch Auth hash config (${res.status}): ${body}`);
  }
  const data = await res.json();
  const hashConfig = data?.signIn?.hashConfig;
  if (!hashConfig?.signerKey) {
    throw new Error('Prod Auth hash config not found in Identity Toolkit response.');
  }
  return hashConfig;
}

function importAuthUsers(hashConfig) {
  if (!fs.existsSync(AUTH_EXPORT_FILE)) {
    throw new Error(`Auth export not found: ${AUTH_EXPORT_FILE}`);
  }

  const firebaseBin = path.join(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
  );
  const firebaseCmd = fs.existsSync(firebaseBin) ? firebaseBin : 'firebase';

  const args = [
    'auth:import',
    AUTH_EXPORT_FILE,
    '--project',
    DEV_PROJECT,
    '--hash-algo',
    hashConfig.algorithm || 'SCRYPT',
    '--hash-key',
    hashConfig.signerKey,
    '--salt-separator',
    hashConfig.saltSeparator || '',
    '--rounds',
    String(hashConfig.rounds ?? 8),
    '--mem-cost',
    String(hashConfig.memoryCost ?? 14),
  ];

  console.log('Importing Auth users into dev with prod password hashes...');
  const result = spawnSync(firebaseCmd, args, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../..'),
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('firebase auth:import failed');
  }
}

async function copyDocumentRecursive(sourceDb, destDb, sourceRef, stats) {
  const snap = await sourceRef.get();
  if (!snap.exists) return;

  const destRef = destDb.doc(sourceRef.path);
  await destRef.set(snap.data(), { merge: false });
  stats.documents += 1;

  const subcollections = await sourceRef.listCollections();
  for (const subcol of subcollections) {
    const docs = await subcol.get();
    for (const doc of docs.docs) {
      await copyDocumentRecursive(sourceDb, destDb, doc.ref, stats);
    }
  }
}

async function copyCollection(sourceDb, destDb, collectionId, stats) {
  console.log(`  Copying collection: ${collectionId}`);
  let lastDoc = null;
  let hasMore = true;

  while (hasMore) {
    let query = sourceDb.collection(collectionId).orderBy('__name__').limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      await copyDocumentRecursive(sourceDb, destDb, doc.ref, stats);
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.size === BATCH_SIZE;
    console.log(`    ${collectionId}: ${stats.documents} documents copied so far`);
  }
}

async function cloneFirestore() {
  console.log(`Cloning Firestore ${PROD_PROJECT} → ${DEV_PROJECT}...`);
  const sourceDb = await getFirestore(PROD_PROJECT);
  const destDb = await getFirestore(DEV_PROJECT);
  const collections = await sourceDb.listCollections();
  const stats = { documents: 0, collections: 0, skipped: 0 };

  for (const col of collections) {
    if (skipCollections.has(col.id)) {
      stats.skipped += 1;
      console.log(`  Skipping collection: ${col.id}`);
      continue;
    }
    stats.collections += 1;
    await copyCollection(sourceDb, destDb, col.id, stats);
  }

  console.log(
    `Firestore clone complete: ${stats.collections} collections copied, ${stats.skipped} skipped, ${stats.documents} documents (including subcollections).`
  );
}

async function main() {
  if (!firestoreOnly) {
    const hashConfig = await fetchProdHashConfig();
    importAuthUsers(hashConfig);
  }

  if (!authOnly) {
    await cloneFirestore();
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Clone failed:', err.message || err);
  process.exit(1);
});

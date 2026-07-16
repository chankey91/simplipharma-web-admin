/**
 * One-off: rebuild Typesense `orders` index from Firestore (prod or dev).
 * Usage: node scripts/reindex-orders-typesense.js [simplipharma|simplipharma-dev]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const projectId = process.argv[2] || 'simplipharma';

function getAccessToken() {
  const cfg = JSON.parse(
    fs.readFileSync(
      path.join(process.env.USERPROFILE || process.env.HOME, '.config/configstore/firebase-tools.json'),
      'utf8'
    )
  );
  const access = cfg?.tokens?.access_token;
  if (!access) throw new Error('No firebase-tools access token. Run firebase login.');
  return access;
}

function getTypesenseConfig(project) {
  const raw = execSync(`firebase functions:config:get --project ${project}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cfg = JSON.parse(raw);
  const ts = cfg.typesense || {};
  if (!ts.host || !ts.api_key) throw new Error('Typesense config missing for ' + project);
  return {
    host: ts.host,
    port: String(ts.port || '80'),
    protocol: ts.protocol || 'http',
    apiKey: ts.api_key,
  };
}

function request(method, url, headers, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...headers,
          ...(payload != null
            ? {
                'Content-Type': contentType || 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let parsed = b;
          try {
            parsed = b ? JSON.parse(b) : null;
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode, body: parsed, raw: b });
        });
      }
    );
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function firestoreValue(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(firestoreValue);
  if ('mapValue' in v) {
    const out = {};
    const fields = v.mapValue.fields || {};
    for (const k of Object.keys(fields)) out[k] = firestoreValue(fields[k]);
    return out;
  }
  return undefined;
}

function docToData(doc) {
  const fields = doc.fields || {};
  const data = {};
  for (const k of Object.keys(fields)) data[k] = firestoreValue(fields[k]);
  const id = doc.name.split('/').pop();
  return { id, data };
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function buildDoc(orderId, data) {
  if (!data) return null;
  const medicines = Array.isArray(data.medicines) ? data.medicines : [];
  const medicineNames = medicines
    .map((m) => String(m?.name || '').trim())
    .filter(Boolean)
    .join(' ');
  const status = String(data.status || '');
  const totalAmount =
    typeof data.totalAmount === 'number'
      ? data.totalAmount
      : parseFloat(String(data.totalAmount ?? 0)) || 0;
  const parts = [orderId, data.retailerEmail, data.retailerName, data.invoiceNumber, medicineNames]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());
  return {
    id: orderId,
    docId: orderId,
    retailerId: String(data.retailerId || ''),
    salesOfficerId: String(data.salesOfficerId || ''),
    retailerEmail: String(data.retailerEmail || ''),
    retailerName: String(data.retailerName || ''),
    medicineNames,
    invoiceNumber: String(data.invoiceNumber || ''),
    search_blob: parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase(),
    status,
    paymentStatus: String(data.paymentStatus || 'Unpaid'),
    orderDate: toMillis(data.orderDate),
    itemCount: medicines.length,
    amountSortable: status === 'Pending' ? 0 : totalAmount,
    totalAmount,
  };
}

async function main() {
  const access = getAccessToken();
  const ts = getTypesenseConfig(projectId);
  console.log('Project:', projectId);
  console.log('Typesense:', ts.protocol + '://' + ts.host + ':' + ts.port);

  const orders = [];
  let pageToken = '';
  do {
    let url =
      'https://firestore.googleapis.com/v1/projects/' +
      projectId +
      '/databases/(default)/documents/orders?pageSize=300';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const res = await request('GET', url, { Authorization: 'Bearer ' + access });
    if (res.status !== 200) {
      throw new Error('Firestore list failed ' + res.status + ': ' + String(res.raw).slice(0, 400));
    }
    for (const doc of res.body.documents || []) orders.push(doc);
    pageToken = res.body.nextPageToken || '';
  } while (pageToken);

  console.log('Fetched orders:', orders.length);

  const built = [];
  for (const doc of orders) {
    const { id, data } = docToData(doc);
    const d = buildDoc(id, data);
    if (d) built.push(d);
  }

  const base = ts.protocol + '://' + ts.host + ':' + ts.port;
  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < built.length; i += 40) {
    const chunk = built.slice(i, i + 40);
    // Import one-by-one if batch fails — some docs can break JSONL
    for (const doc of chunk) {
      const payload = JSON.stringify(doc) + '\n';
      const url = base + '/collections/orders/documents/import?action=upsert';
      const res = await request(
        'POST',
        url,
        { 'X-TYPESENSE-API-KEY': ts.apiKey },
        payload,
        'text/plain'
      );
      if (res.status >= 400) {
        failed++;
        console.warn('Fail', doc.id, res.status, String(res.raw).slice(0, 200));
        continue;
      }
      const line = String(res.raw || '').trim().split('\n')[0];
      try {
        const parsed = JSON.parse(line);
        if (!parsed.success) {
          failed++;
          console.warn('Fail', doc.id, line.slice(0, 200));
          continue;
        }
      } catch {
        failed++;
        console.warn('Fail parse', doc.id, String(res.raw).slice(0, 200));
        continue;
      }
      indexed++;
    }
    console.log('Progress', indexed + failed + '/' + built.length, '(ok', indexed, 'fail', failed + ')');
  }

  const check = built.find((b) => b.id === 'ORD202607146');
  if (check) {
    console.log('ORD202607146 indexed totalAmount=', check.totalAmount);
  }

  console.log('Done. indexed=', indexed, 'failed=', failed, 'totalDocs=', orders.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

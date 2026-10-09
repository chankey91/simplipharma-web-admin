import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import * as XLSX from 'xlsx';
import { ff } from './functionRegion';
import { assertAdminOrOperations } from './panelAuth';
import { getSmtpConfig } from './runtimeConfig';
import { istDateString } from './purchaseListJob';

const SETTINGS_PATH = 'app_settings/pendingOrderEmail';
const DEFAULT_TO = ['satishyadav4446@gmail.com'];

type Holiday = { date: string; name: string };

type EmailSettings = {
  enabled: boolean;
  toEmails: string[];
  skipSunday: boolean;
  holidays: Holiday[];
};

type SummaryRow = {
  medicineId: string;
  medicineName: string;
  manufacturer: string;
  packaging: string;
  totalQty: number;
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

function resolvePackaging(med?: { unit?: string; description?: string } | null): string {
  let packaging = String(med?.unit || '').trim();
  if (!packaging && med?.description) {
    const match = String(med.description).match(/Packaging:\s*(.+)/i);
    if (match?.[1]) packaging = match[1].trim();
  }
  return packaging || '—';
}

function istWeekdaySunday(dateStr: string): boolean {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d) ===
    'Sun'
  );
}

function parseSettings(data: FirebaseFirestore.DocumentData | undefined): EmailSettings {
  const holidays = Array.isArray(data?.holidays)
    ? (data!.holidays as unknown[])
        .map((h) => {
          if (!h || typeof h !== 'object') return null;
          const row = h as { date?: unknown; name?: unknown };
          const date = String(row.date || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
          return { date, name: String(row.name || '').trim() || date };
        })
        .filter((h): h is Holiday => h != null)
    : [];
  const emails = Array.isArray(data?.toEmails)
    ? (data!.toEmails as unknown[])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e.includes('@'))
    : DEFAULT_TO;
  return {
    enabled: data?.enabled === false ? false : true,
    toEmails: emails.length ? [...new Set(emails)] : DEFAULT_TO,
    skipSunday: data?.skipSunday === false ? false : true,
    holidays,
  };
}

async function loadSettings(): Promise<EmailSettings> {
  const snap = await admin.firestore().doc(SETTINGS_PATH).get();
  return parseSettings(snap.exists ? snap.data() : undefined);
}

async function loadAllPendingOrders(): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const db = admin.firestore();
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (let i = 0; i < 40; i += 1) {
      let q = db
        .collection('orders')
        .where('status', '==', 'Pending')
        .orderBy('orderDate', 'desc')
        .limit(250);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      out.push(...snap.docs);
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 250) break;
    }
    return out;
  } catch (err) {
    console.warn('pendingOrderSummaryEmail: paged query failed, scanning Pending:', err);
    const snap = await db.collection('orders').where('status', '==', 'Pending').limit(2000).get();
    return snap.docs;
  }
}

async function loadMedicines(
  ids: string[]
): Promise<Map<string, { manufacturer: string; packaging: string }>> {
  const map = new Map<string, { manufacturer: string; packaging: string }>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const db = admin.firestore();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const snaps = await Promise.all(chunk.map((id) => db.collection('medicines').doc(id).get()));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      map.set(snap.id, {
        manufacturer: String(data.manufacturer || 'N/A'),
        packaging: resolvePackaging({
          unit: data.unit as string | undefined,
          description: data.description as string | undefined,
        }),
      });
    }
  }
  return map;
}

async function loadBestDiscountByMedicineId(): Promise<Map<string, string>> {
  const map = new Map<string, { vendor: string; pct: number; ms: number }>();
  const db = admin.firestore();
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  try {
    for (let i = 0; i < 30; i += 1) {
      let q = db.collection('purchaseInvoices').orderBy('invoiceDate', 'desc').limit(200);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const data = doc.data();
        const vendor = String(data.vendorName || '').trim() || 'Unknown vendor';
        const rawDate = data.invoiceDate;
        const ms =
          rawDate && typeof rawDate.toMillis === 'function'
            ? rawDate.toMillis()
            : rawDate instanceof Date
              ? rawDate.getTime()
              : 0;
        for (const item of (data.items || []) as Array<Record<string, unknown>>) {
          const medicineId = String(item.medicineId || '').trim();
          if (!medicineId) continue;
          const pct = Number(item.discountPercentage);
          if (!Number.isFinite(pct) || pct <= 0) continue;
          const existing = map.get(medicineId);
          if (
            !existing ||
            pct > existing.pct ||
            (pct === existing.pct && ms > existing.ms)
          ) {
            map.set(medicineId, { vendor, pct, ms });
          }
        }
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 200) break;
    }
  } catch (err) {
    console.warn('pendingOrderSummaryEmail: purchase invoice scan failed', err);
  }
  const labels = new Map<string, string>();
  for (const [id, row] of map) {
    const pct = Number.isInteger(row.pct)
      ? String(row.pct)
      : row.pct.toFixed(2).replace(/\.?0+$/, '');
    labels.set(id, `${row.vendor} — ${pct}%`);
  }
  return labels;
}

function buildWorkbook(rows: SummaryRow[], vendorByMedicineId: Map<string, string>): Buffer {
  const excelData: (string | number)[][] = [
    ['SR', 'Medicine Name', 'Packaging', 'Total Quantity', 'Best Discount Vendor', 'Manufacturer'],
  ];
  rows.forEach((row, index) => {
    excelData.push([
      index + 1,
      row.medicineName,
      row.packaging,
      row.totalQty,
      row.medicineId ? vendorByMedicineId.get(row.medicineId) || '—' : '—',
      row.manufacturer,
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 40 },
    { wch: 18 },
    { wch: 14 },
    { wch: 36 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Product Summary');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export async function sendPendingOrderSummaryEmail(opts?: {
  force?: boolean;
}): Promise<{ skipped?: string; sent?: boolean; to?: string[]; rows?: number; orders?: number }> {
  const settings = await loadSettings();
  const today = istDateString();
  if (!opts?.force) {
    if (!settings.enabled) return { skipped: 'disabled' };
    if (settings.skipSunday && istWeekdaySunday(today)) return { skipped: 'sunday' };
    const holiday = settings.holidays.find((h) => h.date === today);
    if (holiday) return { skipped: `holiday:${holiday.name}` };
  }

  const smtp = getSmtpConfig();
  if (!smtp) throw new Error('SMTP is not configured');

  const pendingDocs = await loadAllPendingOrders();
  const productAggregate = new Map<string, SummaryRow>();
  const medicineIds: string[] = [];

  for (const doc of pendingDocs) {
    const medicines = (doc.data().medicines || []) as Array<Record<string, unknown>>;
    for (const medicine of medicines) {
      const key = productAggregateKey({
        medicineId: medicine.medicineId as string | undefined,
        productDemandId: medicine.productDemandId as string | undefined,
        name: medicine.name as string | undefined,
      });
      const medicineId = String(medicine.medicineId || '').trim();
      if (medicineId) medicineIds.push(medicineId);
      const existing = productAggregate.get(key);
      const qty = Number(medicine.quantity) || 0;
      if (existing) {
        existing.totalQty += qty;
      } else {
        productAggregate.set(key, {
          medicineId,
          medicineName: String(medicine.name || 'Unknown'),
          manufacturer: String(medicine.manufacturerName || 'N/A'),
          packaging: String(medicine.requestedUnit || '').trim() || '—',
          totalQty: qty,
        });
      }
    }
  }

  const medicineMap = await loadMedicines(medicineIds);
  for (const row of productAggregate.values()) {
    const info = row.medicineId ? medicineMap.get(row.medicineId) : undefined;
    if (info) {
      row.manufacturer = info.manufacturer || row.manufacturer;
      row.packaging = info.packaging || row.packaging;
    }
  }

  const rows = [...productAggregate.values()].sort((a, b) =>
    a.medicineName.localeCompare(b.medicineName)
  );
  const vendorByMedicineId = await loadBestDiscountByMedicineId();
  const xlsx = buildWorkbook(rows, vendorByMedicineId);
  const filename = `pending-orders-product-summary-${today.replace(/-/g, '')}.xlsx`;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: false,
    auth: { user: smtp.user, pass: smtp.password },
  });

  const subject = `Pending orders product summary — ${today}`;
  const body =
    rows.length === 0
      ? `No pending orders as of 3:33 PM IST on ${today}.`
      : `Attached is the pending-order product summary (${rows.length} product row(s) from ${pendingDocs.length} pending order(s)) as of 3:33 PM IST on ${today}.`;

  await transporter.sendMail({
    from: smtp.user,
    to: settings.toEmails.join(', '),
    subject,
    text: body,
    html: `<p>${body}</p>`,
    attachments: [
      {
        filename,
        content: xlsx,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });

  return {
    sent: true,
    to: settings.toEmails,
    rows: rows.length,
    orders: pendingDocs.length,
  };
}

/** Daily 15:33 Asia/Kolkata */
export const scheduledPendingOrderSummaryEmail = ff
  .runWith({ minInstances: 0, memory: '1GB', timeoutSeconds: 540 })
  .pubsub.schedule('33 15 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const result = await sendPendingOrderSummaryEmail();
    console.log('scheduledPendingOrderSummaryEmail', JSON.stringify(result));
  });

export const sendPendingOrderSummaryNow = ff
  .runWith({ minInstances: 0, memory: '1GB', timeoutSeconds: 540 })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    try {
      await assertAdminOrOperations(context.auth.uid);
    } catch {
      throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }
    return sendPendingOrderSummaryEmail({ force: true });
  });

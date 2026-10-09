"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPendingOrderSummaryNow = exports.scheduledPendingOrderSummaryEmail = void 0;
exports.sendPendingOrderSummaryEmail = sendPendingOrderSummaryEmail;
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const runtimeConfig_1 = require("./runtimeConfig");
const purchaseListJob_1 = require("./purchaseListJob");
const SETTINGS_PATH = 'app_settings/pendingOrderEmail';
const DEFAULT_TO = ['satishyadav4446@gmail.com'];
function productAggregateKey(medicine) {
    var _a, _b;
    if ((_a = medicine.medicineId) === null || _a === void 0 ? void 0 : _a.trim())
        return `med:${medicine.medicineId.trim()}`;
    if ((_b = medicine.productDemandId) === null || _b === void 0 ? void 0 : _b.trim())
        return `demand:${medicine.productDemandId.trim()}`;
    return `name:${String(medicine.name || '')
        .trim()
        .toLowerCase()}`;
}
function resolvePackaging(med) {
    let packaging = String((med === null || med === void 0 ? void 0 : med.unit) || '').trim();
    if (!packaging && (med === null || med === void 0 ? void 0 : med.description)) {
        const match = String(med.description).match(/Packaging:\s*(.+)/i);
        if (match === null || match === void 0 ? void 0 : match[1])
            packaging = match[1].trim();
    }
    return packaging || '—';
}
function istWeekdaySunday(dateStr) {
    const d = new Date(`${dateStr}T12:00:00+05:30`);
    return (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(d) ===
        'Sun');
}
function parseSettings(data) {
    const holidays = Array.isArray(data === null || data === void 0 ? void 0 : data.holidays)
        ? data.holidays
            .map((h) => {
            if (!h || typeof h !== 'object')
                return null;
            const row = h;
            const date = String(row.date || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                return null;
            return { date, name: String(row.name || '').trim() || date };
        })
            .filter((h) => h != null)
        : [];
    const emails = Array.isArray(data === null || data === void 0 ? void 0 : data.toEmails)
        ? data.toEmails
            .map((e) => String(e || '').trim().toLowerCase())
            .filter((e) => e.includes('@'))
        : DEFAULT_TO;
    return {
        enabled: (data === null || data === void 0 ? void 0 : data.enabled) === false ? false : true,
        toEmails: emails.length ? [...new Set(emails)] : DEFAULT_TO,
        skipSunday: (data === null || data === void 0 ? void 0 : data.skipSunday) === false ? false : true,
        holidays,
    };
}
async function loadSettings() {
    const snap = await admin.firestore().doc(SETTINGS_PATH).get();
    return parseSettings(snap.exists ? snap.data() : undefined);
}
async function loadAllPendingOrders() {
    const db = admin.firestore();
    const out = [];
    try {
        let last;
        for (let i = 0; i < 40; i += 1) {
            let q = db
                .collection('orders')
                .where('status', '==', 'Pending')
                .orderBy('orderDate', 'desc')
                .limit(250);
            if (last)
                q = q.startAfter(last);
            const snap = await q.get();
            if (snap.empty)
                break;
            out.push(...snap.docs);
            last = snap.docs[snap.docs.length - 1];
            if (snap.size < 250)
                break;
        }
        return out;
    }
    catch (err) {
        console.warn('pendingOrderSummaryEmail: paged query failed, scanning Pending:', err);
        const snap = await db.collection('orders').where('status', '==', 'Pending').limit(2000).get();
        return snap.docs;
    }
}
async function loadMedicines(ids) {
    const map = new Map();
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const db = admin.firestore();
    for (let i = 0; i < unique.length; i += 100) {
        const chunk = unique.slice(i, i + 100);
        const snaps = await Promise.all(chunk.map((id) => db.collection('medicines').doc(id).get()));
        for (const snap of snaps) {
            if (!snap.exists)
                continue;
            const data = snap.data() || {};
            map.set(snap.id, {
                manufacturer: String(data.manufacturer || 'N/A'),
                packaging: resolvePackaging({
                    unit: data.unit,
                    description: data.description,
                }),
            });
        }
    }
    return map;
}
async function loadBestDiscountByMedicineId() {
    const map = new Map();
    const db = admin.firestore();
    let last;
    try {
        for (let i = 0; i < 30; i += 1) {
            let q = db.collection('purchaseInvoices').orderBy('invoiceDate', 'desc').limit(200);
            if (last)
                q = q.startAfter(last);
            const snap = await q.get();
            if (snap.empty)
                break;
            for (const doc of snap.docs) {
                const data = doc.data();
                const vendor = String(data.vendorName || '').trim() || 'Unknown vendor';
                const rawDate = data.invoiceDate;
                const ms = rawDate && typeof rawDate.toMillis === 'function'
                    ? rawDate.toMillis()
                    : rawDate instanceof Date
                        ? rawDate.getTime()
                        : 0;
                for (const item of (data.items || [])) {
                    const medicineId = String(item.medicineId || '').trim();
                    if (!medicineId)
                        continue;
                    const pct = Number(item.discountPercentage);
                    if (!Number.isFinite(pct) || pct <= 0)
                        continue;
                    const existing = map.get(medicineId);
                    if (!existing ||
                        pct > existing.pct ||
                        (pct === existing.pct && ms > existing.ms)) {
                        map.set(medicineId, { vendor, pct, ms });
                    }
                }
            }
            last = snap.docs[snap.docs.length - 1];
            if (snap.size < 200)
                break;
        }
    }
    catch (err) {
        console.warn('pendingOrderSummaryEmail: purchase invoice scan failed', err);
    }
    const labels = new Map();
    for (const [id, row] of map) {
        const pct = Number.isInteger(row.pct)
            ? String(row.pct)
            : row.pct.toFixed(2).replace(/\.?0+$/, '');
        labels.set(id, `${row.vendor} — ${pct}%`);
    }
    return labels;
}
function buildWorkbook(rows, vendorByMedicineId) {
    const excelData = [
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
async function sendPendingOrderSummaryEmail(opts) {
    const settings = await loadSettings();
    const today = (0, purchaseListJob_1.istDateString)();
    if (!(opts === null || opts === void 0 ? void 0 : opts.force)) {
        if (!settings.enabled)
            return { skipped: 'disabled' };
        if (settings.skipSunday && istWeekdaySunday(today))
            return { skipped: 'sunday' };
        const holiday = settings.holidays.find((h) => h.date === today);
        if (holiday)
            return { skipped: `holiday:${holiday.name}` };
    }
    const smtp = (0, runtimeConfig_1.getSmtpConfig)();
    if (!smtp)
        throw new Error('SMTP is not configured');
    const pendingDocs = await loadAllPendingOrders();
    const productAggregate = new Map();
    const medicineIds = [];
    for (const doc of pendingDocs) {
        const medicines = (doc.data().medicines || []);
        for (const medicine of medicines) {
            const key = productAggregateKey({
                medicineId: medicine.medicineId,
                productDemandId: medicine.productDemandId,
                name: medicine.name,
            });
            const medicineId = String(medicine.medicineId || '').trim();
            if (medicineId)
                medicineIds.push(medicineId);
            const existing = productAggregate.get(key);
            const qty = Number(medicine.quantity) || 0;
            if (existing) {
                existing.totalQty += qty;
            }
            else {
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
    const rows = [...productAggregate.values()].sort((a, b) => a.medicineName.localeCompare(b.medicineName));
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
    const body = rows.length === 0
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
exports.scheduledPendingOrderSummaryEmail = functionRegion_1.ff
    .runWith({ minInstances: 0, memory: '1GB', timeoutSeconds: 540 })
    .pubsub.schedule('33 15 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
    const result = await sendPendingOrderSummaryEmail();
    console.log('scheduledPendingOrderSummaryEmail', JSON.stringify(result));
});
exports.sendPendingOrderSummaryNow = functionRegion_1.ff
    .runWith({ minInstances: 0, memory: '1GB', timeoutSeconds: 540 })
    .https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    try {
        await (0, panelAuth_1.assertAdminOrOperations)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations required');
    }
    return sendPendingOrderSummaryEmail({ force: true });
});
//# sourceMappingURL=pendingOrderSummaryEmail.js.map
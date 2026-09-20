"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastRetailerApkUpdate = exports.RETAILER_APK_RELEASE_DOC = void 0;
exports.getRetailerApkRelease = getRetailerApkRelease;
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const runtimeConfig_1 = require("./runtimeConfig");
const retailerApkUpdateEmail_1 = require("./emailTemplates/retailerApkUpdateEmail");
exports.RETAILER_APK_RELEASE_DOC = 'app_releases/retailer_android';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function getRetailerApkRelease() {
    const snap = await admin.firestore().doc(exports.RETAILER_APK_RELEASE_DOC).get();
    if (!snap.exists)
        return null;
    const data = snap.data() || {};
    const downloadUrl = String(data.downloadUrl || '').trim();
    if (!downloadUrl)
        return null;
    const notes = String(data.notes || '').trim();
    return {
        downloadUrl,
        versionName: String(data.versionName || '').trim() || 'latest',
        notes: notes || undefined,
        fileName: String(data.fileName || '').trim() || undefined,
    };
}
async function sendApkMail(options) {
    try {
        const smtpConfig = (0, runtimeConfig_1.getSmtpConfig)();
        if (!smtpConfig)
            return { ok: false, error: 'SMTP not configured' };
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: false,
            auth: { user: smtpConfig.user, pass: smtpConfig.password },
        });
        await transporter.sendMail({
            from: smtpConfig.user,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
        });
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
    }
}
function isActiveRetailerDoc(data) {
    if (!data)
        return false;
    if (data.isActive === false)
        return false;
    return (0, panelAuth_1.isRetailerRole)(String(data.role || '')) || data.alsoRetailer === true;
}
async function listActiveRetailerRecipients() {
    const col = admin.firestore().collection('users');
    const [retailersSnap, dualSnap] = await Promise.all([
        col.where('role', '==', 'retailer').get(),
        col.where('alsoRetailer', '==', true).get(),
    ]);
    const byId = new Map();
    for (const docSnap of [...retailersSnap.docs, ...dualSnap.docs]) {
        const data = docSnap.data();
        if (!isActiveRetailerDoc(data))
            continue;
        const email = String(data.email || '').trim().toLowerCase();
        if (!email || !email.includes('@'))
            continue;
        if (byId.has(docSnap.id))
            continue;
        byId.set(docSnap.id, {
            uid: docSnap.id,
            email,
            shopName: String(data.shopName || data.displayName || '').trim(),
        });
    }
    return [...byId.values()];
}
/**
 * Email every active retailer the current Android APK download link.
 */
exports.broadcastRetailerApkUpdate = functionRegion_1.ff
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    try {
        await (0, panelAuth_1.assertAdminOrOperations)(context.auth.uid);
    }
    catch (_b) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }
    const release = await getRetailerApkRelease();
    if (!release) {
        throw new functions.https.HttpsError('failed-precondition', 'Upload a retailer Android APK first.');
    }
    const notesOverride = String((_a = data === null || data === void 0 ? void 0 : data.notes) !== null && _a !== void 0 ? _a : '').trim();
    const notes = notesOverride || release.notes || '';
    const recipients = await listActiveRetailerRecipients();
    if (recipients.length === 0) {
        throw new functions.https.HttpsError('failed-precondition', 'No active retailers with email.');
    }
    const broadcastRef = admin.firestore().collection('apk_broadcasts').doc();
    await broadcastRef.set({
        versionName: release.versionName,
        downloadUrl: release.downloadUrl,
        notes,
        status: 'running',
        recipientCount: recipients.length,
        sentCount: 0,
        failCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: context.auth.uid,
    });
    let sentCount = 0;
    let failCount = 0;
    const sampleErrors = [];
    for (const r of recipients) {
        const mail = (0, retailerApkUpdateEmail_1.buildRetailerApkUpdateEmail)({
            shopName: r.shopName,
            versionName: release.versionName,
            downloadUrl: release.downloadUrl,
            notes,
        });
        const result = await sendApkMail({
            to: r.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        });
        if (result.ok)
            sentCount += 1;
        else {
            failCount += 1;
            if (sampleErrors.length < 8 && result.error) {
                sampleErrors.push(`${r.email}: ${result.error}`);
            }
        }
        await sleep(80);
    }
    await broadcastRef.update({
        status: 'done',
        sentCount,
        failCount,
        sampleErrors,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
        ok: true,
        recipientCount: recipients.length,
        sentCount,
        failCount,
        versionName: release.versionName,
        broadcastId: broadcastRef.id,
    };
});
//# sourceMappingURL=retailerApk.js.map
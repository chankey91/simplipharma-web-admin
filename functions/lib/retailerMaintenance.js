"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disableRetailerMaintenance = exports.enableRetailerMaintenance = exports.requestRetailerMaintenanceOtp = exports.RETAILER_MAINTENANCE_DOC = void 0;
const crypto = require("crypto");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const functionRegion_1 = require("./functionRegion");
const panelAuth_1 = require("./panelAuth");
const runtimeConfig_1 = require("./runtimeConfig");
/** Public flag the retailer app reads. Writes go through these callables only. */
exports.RETAILER_MAINTENANCE_DOC = 'app_config/retailer_maintenance';
const OTP_COLLECTION = 'maintenance_otps';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_MESSAGE = 400;
function requireAdminUid(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    return context.auth.uid;
}
async function assertCallerIsAdmin(uid) {
    try {
        await (0, panelAuth_1.assertAdmin)(uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
}
async function resolveAdminEmail(uid, tokenEmail) {
    var _a;
    const fromToken = String(tokenEmail || '').trim().toLowerCase();
    if (fromToken.includes('@'))
        return fromToken;
    const snap = await admin.firestore().collection('users').doc(uid).get();
    const fromDoc = String(((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.email) || '').trim().toLowerCase();
    if (fromDoc.includes('@'))
        return fromDoc;
    throw new functions.https.HttpsError('failed-precondition', 'No email is saved on this admin account.');
}
function maskEmail(email) {
    const [local, domain] = email.split('@');
    if (!local || !domain)
        return 'your email';
    return `${local.slice(0, 1)}***@${domain}`;
}
function hashOtp(code, salt) {
    return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
function otpMatches(code, salt, expectedHash) {
    const actual = Buffer.from(hashOtp(code, salt));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function sendOtpMail(to, code) {
    try {
        const smtpConfig = (0, runtimeConfig_1.getSmtpConfig)();
        if (!smtpConfig)
            return { ok: false, error: 'SMTP is not configured' };
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: false,
            auth: { user: smtpConfig.user, pass: smtpConfig.password },
        });
        const text = `Your SimpliPharma maintenance code is ${code}.\n\n` +
            'It expires in 10 minutes. If you did not request this, ignore the email.';
        const html = `<p>Your SimpliPharma maintenance code is <strong style="font-size:20px;letter-spacing:4px">${code}</strong>.</p>` +
            '<p>It expires in 10 minutes. Enter it in the admin app to put the retailer app into maintenance.</p>' +
            '<p>If you did not request this, you can ignore this email.</p>';
        await transporter.sendMail({
            from: smtpConfig.user,
            to,
            subject: 'SimpliPharma admin — maintenance code',
            text,
            html,
        });
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('retailer maintenance OTP mail failed', msg);
        return { ok: false, error: msg };
    }
}
/** Email a one-time code to the signed-in admin before maintenance can be turned on. */
exports.requestRetailerMaintenanceOtp = functionRegion_1.ff.https.onCall(async (_data, context) => {
    var _a;
    const uid = requireAdminUid(context);
    await assertCallerIsAdmin(uid);
    const email = await resolveAdminEmail(uid, (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token.email);
    const ref = admin.firestore().collection(OTP_COLLECTION).doc(uid);
    const existing = await ref.get();
    if (existing.exists) {
        const sentAt = existing.get('sentAt');
        const sentMs = typeof (sentAt === null || sentAt === void 0 ? void 0 : sentAt.toMillis) === 'function' ? sentAt.toMillis() : 0;
        if (sentMs && Date.now() - sentMs < OTP_COOLDOWN_MS) {
            throw new functions.https.HttpsError('resource-exhausted', 'A code was just sent. Wait a minute before requesting another.');
        }
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    await ref.set({
        hash: hashOtp(code, salt),
        salt,
        attempts: 0,
        email,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
    });
    const mail = await sendOtpMail(email, code);
    if (!mail.ok) {
        await ref.delete().catch(() => undefined);
        throw new functions.https.HttpsError('internal', mail.error || 'Could not send the email.');
    }
    return { ok: true, sentTo: maskEmail(email), expiresInMinutes: 10 };
});
/** Turn retailer maintenance on after the emailed code matches. */
exports.enableRetailerMaintenance = functionRegion_1.ff.https.onCall(async (data, context) => {
    var _a, _b;
    const uid = requireAdminUid(context);
    await assertCallerIsAdmin(uid);
    const code = String((_a = data === null || data === void 0 ? void 0 : data.otp) !== null && _a !== void 0 ? _a : '').replace(/\D/g, '');
    if (code.length !== 6) {
        throw new functions.https.HttpsError('invalid-argument', 'Enter the 6-digit code from your email.');
    }
    const message = String((_b = data === null || data === void 0 ? void 0 : data.message) !== null && _b !== void 0 ? _b : '').trim().slice(0, MAX_MESSAGE);
    const ref = admin.firestore().collection(OTP_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Request a code first.');
    }
    const expiresAt = snap.get('expiresAt');
    const expiresMs = typeof (expiresAt === null || expiresAt === void 0 ? void 0 : expiresAt.toMillis) === 'function' ? expiresAt.toMillis() : 0;
    if (!expiresMs || Date.now() > expiresMs) {
        await ref.delete();
        throw new functions.https.HttpsError('deadline-exceeded', 'That code has expired. Request a new one.');
    }
    const attempts = Number(snap.get('attempts') || 0);
    if (attempts >= MAX_ATTEMPTS) {
        await ref.delete();
        throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Request a new code.');
    }
    const salt = String(snap.get('salt') || '');
    const expected = String(snap.get('hash') || '');
    if (!otpMatches(code, salt, expected)) {
        const next = attempts + 1;
        if (next >= MAX_ATTEMPTS) {
            await ref.delete();
            throw new functions.https.HttpsError('permission-denied', 'Too many incorrect codes. Request a new one.');
        }
        await ref.update({ attempts: next });
        const left = MAX_ATTEMPTS - next;
        throw new functions.https.HttpsError('permission-denied', `That code does not match. ${left} attempt${left === 1 ? '' : 's'} left.`);
    }
    await admin.firestore().doc(exports.RETAILER_MAINTENANCE_DOC).set({
        enabled: true,
        message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    await ref.delete();
    return { ok: true, enabled: true };
});
/** Turn retailer maintenance off. No code — so the app can be restored immediately. */
exports.disableRetailerMaintenance = functionRegion_1.ff.https.onCall(async (_data, context) => {
    const uid = requireAdminUid(context);
    await assertCallerIsAdmin(uid);
    await admin.firestore().doc(exports.RETAILER_MAINTENANCE_DOC).set({
        enabled: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    return { ok: true, enabled: false };
});
//# sourceMappingURL=retailerMaintenance.js.map
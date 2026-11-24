import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import { ff } from './functionRegion';
import { assertAdmin } from './panelAuth';
import { getSmtpConfig } from './runtimeConfig';

/** Public flag the retailer app reads. Writes go through these callables only. */
export const RETAILER_MAINTENANCE_DOC = 'app_config/retailer_maintenance';

const OTP_COLLECTION = 'maintenance_otps';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_MESSAGE = 400;

function requireAdminUid(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  return context.auth.uid;
}

async function assertCallerIsAdmin(uid: string): Promise<void> {
  try {
    await assertAdmin(uid);
  } catch {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
}

async function resolveAdminEmail(uid: string, tokenEmail?: string): Promise<string> {
  const fromToken = String(tokenEmail || '').trim().toLowerCase();
  if (fromToken.includes('@')) return fromToken;
  const snap = await admin.firestore().collection('users').doc(uid).get();
  const fromDoc = String(snap.data()?.email || '').trim().toLowerCase();
  if (fromDoc.includes('@')) return fromDoc;
  throw new functions.https.HttpsError(
    'failed-precondition',
    'No email is saved on this admin account.'
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'your email';
  return `${local.slice(0, 1)}***@${domain}`;
}

function hashOtp(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function otpMatches(code: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(code, salt));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function sendOtpMail(to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const smtpConfig = getSmtpConfig();
    if (!smtpConfig) return { ok: false, error: 'SMTP is not configured' };
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: false,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });
    const text =
      `Your SimpliPharma maintenance code is ${code}.\n\n` +
      'It expires in 10 minutes. If you did not request this, ignore the email.';
    const html =
      `<p>Your SimpliPharma maintenance code is <strong style="font-size:20px;letter-spacing:4px">${code}</strong>.</p>` +
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('retailer maintenance OTP mail failed', msg);
    return { ok: false, error: msg };
  }
}

/** Email a one-time code to the signed-in admin before maintenance can be turned on. */
export const requestRetailerMaintenanceOtp = ff.https.onCall(async (_data, context) => {
  const uid = requireAdminUid(context);
  await assertCallerIsAdmin(uid);
  const email = await resolveAdminEmail(uid, context.auth?.token.email);

  const ref = admin.firestore().collection(OTP_COLLECTION).doc(uid);
  const existing = await ref.get();
  if (existing.exists) {
    const sentAt = existing.get('sentAt');
    const sentMs = typeof sentAt?.toMillis === 'function' ? sentAt.toMillis() : 0;
    if (sentMs && Date.now() - sentMs < OTP_COOLDOWN_MS) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'A code was just sent. Wait a minute before requesting another.'
      );
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
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
export const enableRetailerMaintenance = ff.https.onCall(async (data, context) => {
  const uid = requireAdminUid(context);
  await assertCallerIsAdmin(uid);

  const code = String(data?.otp ?? '').replace(/\D/g, '');
  if (code.length !== 6) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter the 6-digit code from your email.');
  }
  const message = String(data?.message ?? '').trim().slice(0, MAX_MESSAGE);

  const ref = admin.firestore().collection(OTP_COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Request a code first.');
  }

  const expiresAt = snap.get('expiresAt');
  const expiresMs = typeof expiresAt?.toMillis === 'function' ? expiresAt.toMillis() : 0;
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
      throw new functions.https.HttpsError(
        'permission-denied',
        'Too many incorrect codes. Request a new one.'
      );
    }
    await ref.update({ attempts: next });
    const left = MAX_ATTEMPTS - next;
    throw new functions.https.HttpsError(
      'permission-denied',
      `That code does not match. ${left} attempt${left === 1 ? '' : 's'} left.`
    );
  }

  await admin.firestore().doc(RETAILER_MAINTENANCE_DOC).set(
    {
      enabled: true,
      message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true }
  );
  await ref.delete();
  return { ok: true, enabled: true };
});

/** Turn retailer maintenance off. No code — so the app can be restored immediately. */
export const disableRetailerMaintenance = ff.https.onCall(async (_data, context) => {
  const uid = requireAdminUid(context);
  await assertCallerIsAdmin(uid);
  await admin.firestore().doc(RETAILER_MAINTENANCE_DOC).set(
    {
      enabled: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true }
  );
  return { ok: true, enabled: false };
});

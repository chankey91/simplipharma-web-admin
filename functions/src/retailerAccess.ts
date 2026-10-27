import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { assertCanWriteModule, isRetailerRole, isSalesOfficerRole } from './panelAuth';
import { ff } from './functionRegion';

/**
 * Mark a retailer active or inactive.
 * Inactive retailers are signed out and cannot sign in until an admin activates them.
 */
export const setRetailerAccess = ff.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  try {
    await assertCanWriteModule(context.auth.uid, 'stores');
  } catch {
    throw new functions.https.HttpsError('permission-denied', 'You cannot change retailer access');
  }

  const storeId = String(data?.storeId || '').trim();
  const isActive = data?.isActive === true;
  if (!storeId) {
    throw new functions.https.HttpsError('invalid-argument', 'Store is required');
  }

  const ref = admin.firestore().collection('users').doc(storeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Retailer not found');
  }

  const profile = snap.data() || {};
  const role = String(profile.role || '');
  const roles = Array.isArray(profile.roles) ? profile.roles.map((r) => String(r)) : [];
  const isRetailer = isRetailerRole(role) || roles.some((r) => isRetailerRole(r));
  if (!isRetailer) {
    throw new functions.https.HttpsError('failed-precondition', 'This account is not a retailer');
  }

  await ref.update({
    isActive,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(isActive
      ? { sessionRevokedAt: admin.firestore.FieldValue.delete() }
      : { sessionRevokedAt: admin.firestore.FieldValue.serverTimestamp() }),
  });

  // A sales officer who also runs a shop shares this login. Do not disable that Auth user.
  const sharedStaffLogin = isSalesOfficerRole(role) || role === 'areaManager' || role === 'admin';
  if (sharedStaffLogin) {
    return {
      ok: true,
      isActive,
      authUpdated: false,
      sharedLogin: true,
      message: isActive
        ? 'Retailer flag is active. This login is also a staff account, so app access was left as it is.'
        : 'Retailer flag is inactive. This login is also a staff account, so the app password was left enabled.',
    };
  }

  try {
    await admin.auth().updateUser(storeId, { disabled: !isActive });
    if (!isActive) {
      await admin.auth().revokeRefreshTokens(storeId);
    }
  } catch (err: unknown) {
    const code = String((err as { code?: string })?.code || '');
    if (code === 'auth/user-not-found') {
      return {
        ok: true,
        isActive,
        authUpdated: false,
        message: 'Retailer is marked inactive, but no login account was found to sign out.',
      };
    }
    console.error('setRetailerAccess auth update failed', err);
    throw new functions.https.HttpsError(
      'internal',
      'Retailer status was saved, but the login could not be updated. Try again.'
    );
  }

  return { ok: true, isActive, authUpdated: true };
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRetailerAccess = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const panelAuth_1 = require("./panelAuth");
const functionRegion_1 = require("./functionRegion");
/**
 * Mark a retailer active or inactive.
 * Inactive retailers are signed out and cannot sign in until an admin activates them.
 */
exports.setRetailerAccess = functionRegion_1.ff.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    try {
        await (0, panelAuth_1.assertCanWriteModule)(context.auth.uid, 'stores');
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'You cannot change retailer access');
    }
    const storeId = String((data === null || data === void 0 ? void 0 : data.storeId) || '').trim();
    const isActive = (data === null || data === void 0 ? void 0 : data.isActive) === true;
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
    const isRetailer = (0, panelAuth_1.isRetailerRole)(role) || roles.some((r) => (0, panelAuth_1.isRetailerRole)(r));
    if (!isRetailer) {
        throw new functions.https.HttpsError('failed-precondition', 'This account is not a retailer');
    }
    await ref.update(Object.assign({ isActive, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, (isActive
        ? { sessionRevokedAt: admin.firestore.FieldValue.delete() }
        : { sessionRevokedAt: admin.firestore.FieldValue.serverTimestamp() })));
    // A sales officer who also runs a shop shares this login. Do not disable that Auth user.
    const sharedStaffLogin = (0, panelAuth_1.isSalesOfficerRole)(role) || role === 'areaManager' || role === 'admin';
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
    }
    catch (err) {
        const code = String((err === null || err === void 0 ? void 0 : err.code) || '');
        if (code === 'auth/user-not-found') {
            return {
                ok: true,
                isActive,
                authUpdated: false,
                message: 'Retailer is marked inactive, but no login account was found to sign out.',
            };
        }
        console.error('setRetailerAccess auth update failed', err);
        throw new functions.https.HttpsError('internal', 'Retailer status was saved, but the login could not be updated. Try again.');
    }
    return { ok: true, isActive, authUpdated: true };
});
//# sourceMappingURL=retailerAccess.js.map
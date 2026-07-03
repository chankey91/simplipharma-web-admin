"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserRole = getUserRole;
exports.isAdminRole = isAdminRole;
exports.isOperationsRole = isOperationsRole;
exports.isAdminOrOperationsRole = isAdminOrOperationsRole;
exports.isPanelRole = isPanelRole;
exports.isSalesOfficerRole = isSalesOfficerRole;
exports.isRetailerRole = isRetailerRole;
exports.assertAdminOrOperations = assertAdminOrOperations;
exports.assertAdmin = assertAdmin;
const admin = require("firebase-admin");
async function getUserRole(uid) {
    var _a;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    return userDoc.exists ? (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role : undefined;
}
function isAdminRole(role) {
    return role === 'admin' || role === 'Admin';
}
function isOperationsRole(role) {
    return role === 'operations' || role === 'Operations';
}
function isAdminOrOperationsRole(role) {
    return isAdminRole(role) || isOperationsRole(role);
}
function isPanelRole(role) {
    return isAdminOrOperationsRole(role);
}
function isSalesOfficerRole(role) {
    return role === 'salesOfficer' || role === 'SalesOfficer';
}
function isRetailerRole(role) {
    return role === 'retailer' || role === 'Retailer';
}
async function assertAdminOrOperations(uid) {
    const role = await getUserRole(uid);
    if (!isAdminOrOperationsRole(role)) {
        throw new Error('PERMISSION_DENIED');
    }
}
async function assertAdmin(uid) {
    const role = await getUserRole(uid);
    if (!isAdminRole(role)) {
        throw new Error('PERMISSION_DENIED');
    }
}
//# sourceMappingURL=panelAuth.js.map
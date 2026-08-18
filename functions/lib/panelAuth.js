"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserRole = getUserRole;
exports.isAdminRole = isAdminRole;
exports.isOperationsRole = isOperationsRole;
exports.isOfficeRole = isOfficeRole;
exports.isAdminOrOperationsRole = isAdminOrOperationsRole;
exports.isPanelRole = isPanelRole;
exports.isSalesOfficerRole = isSalesOfficerRole;
exports.isPurchaseOfficerRole = isPurchaseOfficerRole;
exports.isRetailerRole = isRetailerRole;
exports.assertAdminOrOperations = assertAdminOrOperations;
exports.assertAdmin = assertAdmin;
exports.assertCanWriteModule = assertCanWriteModule;
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
function isOfficeRole(role) {
    return role === 'office' || role === 'Office';
}
function isAdminOrOperationsRole(role) {
    return isAdminRole(role) || isOperationsRole(role);
}
function isPanelRole(role) {
    return isAdminOrOperationsRole(role) || isOfficeRole(role);
}
function isSalesOfficerRole(role) {
    return role === 'salesOfficer' || role === 'SalesOfficer';
}
function isPurchaseOfficerRole(role) {
    return role === 'purchaseOfficer' || role === 'PurchaseOfficer';
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
/** Admin/operations always pass. Office passes only when writeAccess[module] is true. */
async function assertCanWriteModule(uid, module) {
    var _a, _b, _c;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const role = userDoc.exists ? String(((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || '') : undefined;
    if (isAdminOrOperationsRole(role))
        return;
    if (!isOfficeRole(role) || ((_c = (_b = userDoc.data()) === null || _b === void 0 ? void 0 : _b.writeAccess) === null || _c === void 0 ? void 0 : _c[module]) !== true) {
        throw new Error('PERMISSION_DENIED');
    }
}
//# sourceMappingURL=panelAuth.js.map
"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminReindexProductDemandsTypesense = exports.searchProductDemandsTypesense = exports.onProductDemandWriteTypesense = exports.adminReindexDebitNotesTypesense = exports.searchDebitNotesTypesense = exports.onDebitNoteWriteTypesense = exports.adminReindexCreditNotesTypesense = exports.searchCreditNotesTypesense = exports.onCreditNoteWriteTypesense = exports.adminReindexPurchaseInvoicesTypesense = exports.searchPurchaseInvoicesTypesense = exports.onPurchaseInvoiceWriteTypesense = exports.adminReindexOrdersTypesense = exports.searchOrdersTypesense = exports.onOrderWriteTypesense = exports.adminReindexMedicinesTypesense = exports.searchMedicinesTypesense = exports.onMedicineWriteTypesense = exports.sendCreditNotePdfEmail = exports.sendOrderInvoicePdfEmail = exports.onBulkMedicineJobCreated = exports.onSupportThreadAdminMessageCreated = exports.onSupportTicketCreated = exports.sendRetailerPasswordResetEmail = exports.sendSalesOfficerPasswordResetEmail = exports.sendPanelPasswordResetEmail = exports.onRetailerRegistrationRequestCreated = exports.rejectRetailerRequest = exports.approveRetailerRequest = exports.updateRetailerEmail = exports.createStoreUser = exports.sendVendorPasswordEmail = exports.sendVendorPasswordEmailHttp = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const panelAuth_1 = require("./panelAuth");
const retailerWelcomeEmail_1 = require("./emailTemplates/retailerWelcomeEmail");
admin.initializeApp();
// Helper function to set CORS headers
const setCorsHeaders = (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Max-Age', '3600');
};
// SMTP Configuration
const getTransporter = () => {
    const config = functions.config().smtp;
    if (!config || !config.user || !config.password) {
        throw new Error('SMTP configuration not found. Please set smtp.user and smtp.password using firebase functions:config:set');
    }
    const host = config.host || 'smtp.zoho.in';
    const port = Number(config.port) || 587;
    console.log('Creating SMTP transporter with config:', {
        host,
        port,
        user: config.user,
        hasPassword: !!config.password
    });
    return nodemailer.createTransport({
        host,
        port,
        secure: false, // true for 465, false for other ports
        auth: {
            user: config.user,
            pass: config.password,
        },
        debug: true, // Enable debug output
        logger: true, // Log to console
    });
};
/** Email/password on retailer_registration_requests may use different keys from mobile vs admin. */
function resolveRetailerRequestCredentials(req) {
    var _a, _b, _c, _d, _e, _f, _g;
    const emailRaw = (_c = (_b = (_a = req.email) !== null && _a !== void 0 ? _a : req.retailerEmail) !== null && _b !== void 0 ? _b : req.contactEmail) !== null && _c !== void 0 ? _c : '';
    const email = String(emailRaw).trim();
    const passwordRaw = (_g = (_f = (_e = (_d = req.password) !== null && _d !== void 0 ? _d : req.initialPassword) !== null && _e !== void 0 ? _e : req.plainPassword) !== null && _f !== void 0 ? _f : req.tempPassword) !== null && _g !== void 0 ? _g : '';
    const password = String(passwordRaw);
    if (!email || !password) {
        return null;
    }
    return { email, password };
}
function getRetailerRegistrationEmail(req) {
    var _a, _b, _c;
    const email = String((_c = (_b = (_a = req.email) !== null && _a !== void 0 ? _a : req.retailerEmail) !== null && _b !== void 0 ? _b : req.contactEmail) !== null && _c !== void 0 ? _c : '').trim();
    return email || null;
}
function escapeHtmlText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Single path for transactional mail (logs failures; optional PDF attachment). */
async function sendSmtpMail(options) {
    var _a;
    try {
        const smtpConfig = functions.config().smtp;
        if (!(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) || !(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password)) {
            console.warn('sendSmtpMail: smtp.user or smtp.password missing in Functions config');
            return { ok: false, error: 'SMTP not configured' };
        }
        const transporter = getTransporter();
        await transporter.sendMail(Object.assign(Object.assign({ from: smtpConfig.user, to: options.to, subject: options.subject, html: options.html }, (options.text ? { text: options.text } : {})), (((_a = options.attachments) === null || _a === void 0 ? void 0 : _a.length)
            ? { attachments: options.attachments.map((a) => (Object.assign({}, a))) }
            : {})));
        return { ok: true };
    }
    catch (err) {
        const msg = (err === null || err === void 0 ? void 0 : err.message) || String(err);
        const code = (err === null || err === void 0 ? void 0 : err.responseCode) || (err === null || err === void 0 ? void 0 : err.code);
        console.error('sendSmtpMail failed:', { msg, code, to: options.to });
        return { ok: false, error: msg };
    }
}
/**
 * Send password email to vendor (HTTP version with CORS)
 * Alternative to callable function with explicit CORS handling
 */
exports.sendVendorPasswordEmailHttp = functions.https.onRequest(async (req, res) => {
    // Handle CORS preflight (OPTIONS request) FIRST - before anything else
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.status(204).send('');
        return;
    }
    // Set CORS headers for all other requests
    setCorsHeaders(res);
    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const { email, password, vendorName, authToken } = req.body;
        // Verify authentication token
        if (!authToken) {
            res.status(401).json({ error: 'Authentication token required' });
            return;
        }
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(authToken);
        }
        catch (error) {
            console.error('Token verification failed:', error);
            res.status(401).json({ error: 'Invalid authentication token' });
            return;
        }
        const role = await (0, panelAuth_1.getUserRole)(decodedToken.uid);
        if (!(0, panelAuth_1.isAdminOrOperationsRole)(role)) {
            res.status(403).json({ error: 'Admin or operations access required' });
            return;
        }
        if (!email || !password || !vendorName) {
            res.status(400).json({ error: 'Email, password, and vendorName are required' });
            return;
        }
        // Check SMTP configuration
        const smtpConfig = functions.config().smtp;
        if (!smtpConfig || !smtpConfig.user || !smtpConfig.password) {
            res.status(500).json({ error: 'SMTP configuration not found' });
            return;
        }
        const transporter = getTransporter();
        await transporter.verify();
        const mailOptions = {
            from: smtpConfig.user,
            to: email,
            subject: 'Your SimpliPharma Vendor Account',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
          <p>Your vendor account has been created successfully.</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Vendor Name:</strong> ${vendorName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
          </div>
          <p><strong>Important:</strong> Please keep this password secure and change it after your first login.</p>
          <p>If you have any questions, please contact support.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This is an automated message. Please do not reply.</p>
        </div>
      `,
        };
        const result = await transporter.sendMail(mailOptions);
        res.status(200).json({
            success: true,
            message: 'Password email sent successfully',
            messageId: result.messageId
        });
    }
    catch (error) {
        console.error('Error sending vendor password email:', error);
        res.status(500).json({
            error: error.message || 'Failed to send email'
        });
    }
});
/**
 * Send password email to vendor
 * Called when a new vendor is created (Callable function - preferred)
 */
exports.sendVendorPasswordEmail = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    try {
        console.log('sendVendorPasswordEmail called with data:', {
            email: data === null || data === void 0 ? void 0 : data.email,
            hasPassword: !!(data === null || data === void 0 ? void 0 : data.password),
            vendorName: data === null || data === void 0 ? void 0 : data.vendorName,
            hasAuth: !!context.auth,
            authUid: (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid
        });
        // Verify admin access
        if (!context.auth) {
            console.error('No authentication context');
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
        }
        // Check if user is admin
        let userDoc;
        try {
            userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
            console.log('User document fetched:', {
                exists: userDoc.exists,
                role: (_b = userDoc.data()) === null || _b === void 0 ? void 0 : _b.role
            });
        }
        catch (error) {
            console.error('Error fetching user document:', error);
            throw new functions.https.HttpsError('internal', 'Failed to verify user permissions');
        }
        const callerRole = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.role;
        if (!userDoc.exists || !(0, panelAuth_1.isAdminOrOperationsRole)(callerRole)) {
            console.error('User lacks panel access:', {
                exists: userDoc.exists,
                role: callerRole
            });
            throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
        }
        const { email, password, vendorName } = data || {};
        if (!email || !password || !vendorName) {
            console.error('Missing required parameters:', { email: !!email, password: !!password, vendorName: !!vendorName });
            throw new functions.https.HttpsError('invalid-argument', 'Email, password, and vendorName are required');
        }
        // Check SMTP configuration
        const smtpConfig = functions.config().smtp;
        console.log('SMTP Config check:', {
            hasConfig: !!smtpConfig,
            hasUser: !!(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user),
            hasPassword: !!(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password),
            user: (smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) || 'NOT SET'
        });
        if (!smtpConfig || !smtpConfig.user || !smtpConfig.password) {
            const errorMsg = 'SMTP configuration not found. Please set smtp.user and smtp.password using: firebase functions:config:set smtp.user="your-email" smtp.password="your-password"';
            console.error(errorMsg);
            throw new functions.https.HttpsError('failed-precondition', errorMsg);
        }
        const transporter = getTransporter();
        console.log('Transporter created, attempting to send email to:', email);
        // Verify SMTP connection first
        try {
            await transporter.verify();
            console.log('SMTP connection verified successfully');
        }
        catch (verifyError) {
            console.error('SMTP verification failed:', verifyError);
            throw new functions.https.HttpsError('internal', `SMTP connection failed: ${verifyError.message || 'Unknown error'}`);
        }
        const mailOptions = {
            from: smtpConfig.user,
            to: email,
            subject: 'Your SimpliPharma Vendor Account',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
          <p>Your vendor account has been created successfully.</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Vendor Name:</strong> ${vendorName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
          </div>
          <p><strong>Important:</strong> Please keep this password secure and change it after your first login.</p>
          <p>If you have any questions, please contact support.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This is an automated message. Please do not reply.</p>
        </div>
      `,
        };
        console.log('Sending email with options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });
        const result = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', {
            messageId: result.messageId,
            response: result.response
        });
        return {
            success: true,
            message: 'Password email sent successfully',
            messageId: result.messageId
        };
    }
    catch (error) {
        console.error('Error sending vendor password email:', {
            error: error,
            message: error.message,
            code: error.code,
            response: error.response,
            responseCode: error.responseCode,
            command: error.command,
            stack: error.stack
        });
        // Provide more specific error messages
        let errorMessage = 'Failed to send email';
        if (error.code === 'EAUTH') {
            errorMessage = 'SMTP authentication failed. Please check your email and password in Firebase Functions config.';
        }
        else if (error.code === 'ECONNECTION') {
            errorMessage = 'Could not connect to SMTP server. Please check your network connection.';
        }
        else if (error.message) {
            errorMessage = error.message;
        }
        throw new functions.https.HttpsError('internal', errorMessage);
    }
});
/**
 * Create store/retailer or sales officer user (Firebase Auth + Firestore)
 */
exports.createStoreUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdmin)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const { email, password, storeData } = data || {};
    if (!email || !password) {
        throw new functions.https.HttpsError('invalid-argument', 'Email and password are required');
    }
    const role = (storeData === null || storeData === void 0 ? void 0 : storeData.role) || 'retailer';
    const displayName = (storeData === null || storeData === void 0 ? void 0 : storeData.displayName) || (storeData === null || storeData === void 0 ? void 0 : storeData.shopName) || email;
    const allowedRoles = ['retailer', 'salesOfficer', 'operations'];
    if (!allowedRoles.includes(role)) {
        throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`);
    }
    const accountLabel = role === 'salesOfficer'
        ? 'Sales Officer'
        : role === 'operations'
            ? 'Operations'
            : 'store';
    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: displayName,
            emailVerified: false,
            disabled: false,
        });
        const _b = storeData || {}, { role: _r } = _b, restStoreData = __rest(_b, ["role"]);
        // Firestore rejects undefined - strip them
        const cleanData = {};
        for (const [k, v] of Object.entries(restStoreData)) {
            if (v !== undefined)
                cleanData[k] = v;
        }
        cleanData.uid = userRecord.uid;
        cleanData.email = email;
        cleanData.role = role;
        cleanData.mustResetPassword = true;
        cleanData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        cleanData.isActive = (storeData === null || storeData === void 0 ? void 0 : storeData.isActive) !== false;
        await admin.firestore().collection('users').doc(userRecord.uid).set(cleanData);
        // Send password email if SMTP configured
        let emailSent = false;
        try {
            if (role === 'retailer') {
                const welcomeMail = (0, retailerWelcomeEmail_1.buildRetailerWelcomeEmail)({
                    email,
                    password,
                    shopName: (storeData === null || storeData === void 0 ? void 0 : storeData.shopName) || (storeData === null || storeData === void 0 ? void 0 : storeData.displayName),
                    storeCode: storeData === null || storeData === void 0 ? void 0 : storeData.storeCode,
                    intro: 'Your SimpliPharma retailer account has been created. Use the credentials below to sign in.',
                    subject: 'Welcome to SimpliPharma — Your retailer account is ready',
                });
                const mailResult = await sendSmtpMail({
                    to: email,
                    subject: welcomeMail.subject,
                    html: welcomeMail.html,
                    text: welcomeMail.text,
                });
                emailSent = mailResult.ok;
                if (!mailResult.ok) {
                    console.error('createStoreUser: retailer welcome email not sent:', mailResult.error);
                }
            }
            else {
                const smtpConfig = functions.config().smtp;
                if ((smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) && (smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password)) {
                    const transporter = getTransporter();
                    await transporter.sendMail({
                        from: smtpConfig.user,
                        to: email,
                        subject: `Your SimpliPharma ${accountLabel} Account`,
                        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
              <p>Your ${accountLabel} account has been created.</p>
              ${role === 'operations' ? '<p>Sign in to the SimpliPharma Operations panel to manage orders, inventory, purchases, and warehouse tasks.</p>' : ''}
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
              </div>
              <p><strong>Important:</strong> Please change your password on first login.</p>
            </div>
          `,
                    });
                    emailSent = true;
                }
            }
        }
        catch (emailErr) {
            console.error('Email send failed:', emailErr === null || emailErr === void 0 ? void 0 : emailErr.message);
            // Return success with emailSent: false so admin knows to share password manually
        }
        return { success: true, uid: userRecord.uid, id: userRecord.uid, emailSent };
    }
    catch (error) {
        console.error('createStoreUser error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to create user');
    }
});
/**
 * Admin only: update a retailer's login email in Firebase Auth and Firestore.
 */
exports.updateRetailerEmail = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdmin)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const retailerUserId = String((data === null || data === void 0 ? void 0 : data.retailerUserId) || '').trim();
    const newEmail = String((data === null || data === void 0 ? void 0 : data.newEmail) || '').trim();
    if (!retailerUserId) {
        throw new functions.https.HttpsError('invalid-argument', 'retailerUserId is required');
    }
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid new email is required');
    }
    const userDoc = await admin.firestore().collection('users').doc(retailerUserId).get();
    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Retailer not found');
    }
    const userData = userDoc.data();
    if (!(0, panelAuth_1.isRetailerRole)(String(userData.role || ''))) {
        throw new functions.https.HttpsError('failed-precondition', 'User is not a retailer account');
    }
    const currentEmail = String(userData.email || '').trim().toLowerCase();
    if (currentEmail === newEmail.toLowerCase()) {
        return { success: true, email: newEmail, unchanged: true };
    }
    try {
        await admin.auth().updateUser(retailerUserId, { email: newEmail });
    }
    catch (error) {
        const code = String((error === null || error === void 0 ? void 0 : error.code) || '');
        if (code === 'auth/email-already-exists') {
            throw new functions.https.HttpsError('already-exists', 'This email is already in use');
        }
        if (code === 'auth/invalid-email') {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid email address');
        }
        console.error('updateRetailerEmail auth error:', error);
        throw new functions.https.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Failed to update login email');
    }
    await admin.firestore().collection('users').doc(retailerUserId).update({
        email: newEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, email: newEmail };
});
/**
 * Approve retailer registration request: create user account from pending request
 */
exports.approveRetailerRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdmin)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const { requestId } = data || {};
    if (!requestId) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    const reqRef = admin.firestore().collection('retailer_registration_requests').doc(requestId);
    const reqDoc = await reqRef.get();
    if (!reqDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Request not found');
    }
    const req = reqDoc.data();
    if (req.status !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition', 'Request already processed');
    }
    const cred = resolveRetailerRequestCredentials(req);
    if (!cred) {
        throw new functions.https.HttpsError('invalid-argument', 'Request missing email or password (expected email/retailerEmail and password/initialPassword on the registration document)');
    }
    try {
        const userRecord = await admin.auth().createUser({
            email: cred.email,
            password: cred.password,
            displayName: req.displayName || req.shopName || cred.email,
            emailVerified: false,
            disabled: false,
        });
        const userData = {
            uid: userRecord.uid,
            email: cred.email,
            role: 'retailer',
            displayName: req.displayName,
            shopName: req.shopName,
            phoneNumber: req.phoneNumber,
            address: req.address,
            licenceNumber: req.licenceNumber,
            aadharNumber: req.aadharNumber,
            ownerName: req.ownerName,
            licenceHolderName: req.licenceHolderName,
            pan: req.pan,
            gst: req.gst,
            storeCode: req.storeCode,
            salesOfficerId: req.salesOfficerId,
            isActive: true,
            shopImage: req.shopImageUrl || req.shopImage || req.shopPhotoUrl,
            licenceImageUrl: req.licenceImageUrl || req.licenceImage || req.licenseImageUrl,
            aadharImageUrl: req.aadharImageUrl || req.aadharImage || req.aadharCardUrl,
            location: req.location,
            mustResetPassword: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        for (const [k, v] of Object.entries(userData)) {
            if (v === undefined)
                delete userData[k];
        }
        await admin.firestore().collection('users').doc(userRecord.uid).set(userData);
        await reqRef.update({
            status: 'approved',
            reviewedBy: context.auth.uid,
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const welcomeMail = (0, retailerWelcomeEmail_1.buildRetailerWelcomeEmail)({
            email: cred.email,
            password: cred.password,
            shopName: req.shopName || req.displayName,
            storeCode: req.storeCode,
            intro: 'Your retailer registration has been approved. Your SimpliPharma account is now active.',
            subject: 'Welcome to SimpliPharma — Your store account is approved',
        });
        const approvalMail = await sendSmtpMail({
            to: cred.email,
            subject: welcomeMail.subject,
            html: welcomeMail.html,
            text: welcomeMail.text,
        });
        const emailSent = approvalMail.ok;
        if (!approvalMail.ok) {
            console.error('approveRetailerRequest: approval email not sent:', approvalMail.error);
        }
        return {
            success: true,
            uid: userRecord.uid,
            emailSent,
            emailError: approvalMail.ok ? undefined : approvalMail.error,
        };
    }
    catch (error) {
        console.error('approveRetailerRequest error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to approve request');
    }
});
/**
 * Reject retailer registration: update Firestore and notify retailer + Sales Officer by email.
 */
exports.rejectRetailerRequest = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdmin)(context.auth.uid);
    }
    catch (_b) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const { requestId, reason } = data || {};
    if (!requestId) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    const reqRef = admin.firestore().collection('retailer_registration_requests').doc(requestId);
    const reqDoc = await reqRef.get();
    if (!reqDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Request not found');
    }
    const req = reqDoc.data();
    if (req.status !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition', 'Request already processed');
    }
    const rejectionReason = typeof reason === 'string' ? reason.trim() : '';
    await reqRef.update({
        status: 'rejected',
        rejectionReason,
        reviewedBy: context.auth.uid,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const shopLabel = req.shopName || req.displayName || 'your registration';
    const retailerEmail = getRetailerRegistrationEmail(req);
    const reasonHtml = rejectionReason
        ? `<p><strong>Reason:</strong> ${escapeHtmlText(rejectionReason)}</p>`
        : '';
    let retailerEmailSent = null;
    let salesOfficerEmailSent = null;
    const emailErrors = [];
    if (retailerEmail) {
        const mail = await sendSmtpMail({
            to: retailerEmail,
            subject: 'SimpliPharma — Retailer registration not approved',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c62828;">Registration update</h2>
          <p>We are unable to approve your retailer registration for <strong>${escapeHtmlText(String(shopLabel))}</strong> at this time.</p>
          ${reasonHtml}
          <p>If you have questions, please contact your Sales Officer or SimpliPharma support.</p>
          <p style="color:#666;font-size:12px;">Reference: ${escapeHtmlText(requestId)}</p>
        </div>`,
        });
        retailerEmailSent = mail.ok;
        if (!mail.ok && mail.error)
            emailErrors.push(`Retailer email: ${mail.error}`);
    }
    else {
        console.warn('rejectRetailerRequest: no retailer email on request', requestId);
    }
    const soId = req.salesOfficerId;
    if (soId) {
        try {
            const soDoc = await admin.firestore().collection('users').doc(String(soId)).get();
            const soEmail = soDoc.exists ? String(((_a = soDoc.data()) === null || _a === void 0 ? void 0 : _a.email) || '').trim() : '';
            if (soEmail) {
                const mail = await sendSmtpMail({
                    to: soEmail,
                    subject: 'SimpliPharma — Retailer registration rejected',
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #c62828;">Registration rejected</h2>
              <p>A retailer registration you submitted has been <strong>rejected</strong> by admin.</p>
              <ul>
                <li><strong>Shop / name:</strong> ${escapeHtmlText(String(shopLabel))}</li>
                <li><strong>Retailer email:</strong> ${escapeHtmlText(retailerEmail || 'not on file')}</li>
                <li><strong>Request ID:</strong> ${escapeHtmlText(requestId)}</li>
              </ul>
              ${reasonHtml}
            </div>`,
                });
                salesOfficerEmailSent = mail.ok;
                if (!mail.ok && mail.error)
                    emailErrors.push(`Sales Officer email: ${mail.error}`);
            }
            else {
                console.warn('rejectRetailerRequest: Sales Officer has no email', soId);
            }
        }
        catch (e) {
            console.error('rejectRetailerRequest: SO lookup failed', e === null || e === void 0 ? void 0 : e.message);
            emailErrors.push(`SO lookup: ${(e === null || e === void 0 ? void 0 : e.message) || String(e)}`);
        }
    }
    return {
        success: true,
        retailerEmailSent,
        salesOfficerEmailSent,
        emailErrors: emailErrors.length ? emailErrors.join(' | ') : undefined,
    };
});
/**
 * When a retailer registration request is created, notify the retailer and the Sales Officer.
 * (Sales Officer registration uses createStoreUser directly; this covers the pending-retailer pipeline.)
 */
exports.onRetailerRegistrationRequestCreated = functions.firestore
    .document('retailer_registration_requests/{requestId}')
    .onCreate(async (snap, context) => {
    var _a;
    const data = snap.data();
    if (!data || data.status === 'rejected') {
        return null;
    }
    const requestId = context.params.requestId;
    const retailerEmail = String(data.email || data.retailerEmail || data.contactEmail || '').trim();
    const shopLabel = data.shopName || data.displayName || 'your pharmacy';
    const smtpConfig = functions.config().smtp;
    if (!(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) || !(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password)) {
        console.warn('onRetailerRegistrationRequestCreated: SMTP not configured, skipping notification emails');
        return null;
    }
    if (retailerEmail) {
        const ack = await sendSmtpMail({
            to: retailerEmail,
            subject: 'SimpliPharma — Registration received',
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2196F3;">Thank you for registering</h2>
            <p>We have received your retailer registration (${String(shopLabel)}).</p>
            <p>Your request is pending admin review. You will receive another email once your account is approved.</p>
            <p style="color:#666;font-size:12px;">Reference: ${requestId}</p>
          </div>`,
        });
        if (!ack.ok)
            console.error('Retailer ack email failed:', ack.error);
    }
    else {
        console.warn('onRetailerRegistrationRequestCreated: no retailer email on document, skipping retailer ack');
    }
    const soId = data.salesOfficerId;
    if (soId) {
        try {
            const soDoc = await admin.firestore().collection('users').doc(String(soId)).get();
            const soEmail = soDoc.exists ? String(((_a = soDoc.data()) === null || _a === void 0 ? void 0 : _a.email) || '').trim() : '';
            if (soEmail) {
                const soMail = await sendSmtpMail({
                    to: soEmail,
                    subject: 'SimpliPharma — Retailer registration submitted',
                    html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2196F3;">Registration pending admin approval</h2>
                <p>A retailer registration you submitted is now in the queue:</p>
                <ul>
                  <li><strong>Shop / name:</strong> ${String(shopLabel)}</li>
                  <li><strong>Email:</strong> ${retailerEmail || 'not provided'}</li>
                  <li><strong>Request ID:</strong> ${requestId}</li>
                </ul>
                <p>An admin will review and approve the request in the admin portal.</p>
              </div>`,
                });
                if (!soMail.ok)
                    console.error('Sales Officer notify email failed:', soMail.error);
            }
            else {
                console.warn('onRetailerRegistrationRequestCreated: Sales Officer has no email on users/', soId);
            }
        }
        catch (e) {
            console.error('onRetailerRegistrationRequestCreated: failed to load Sales Officer', e === null || e === void 0 ? void 0 : e.message);
        }
    }
    const adminNotify = smtpConfig.admin_notify ? String(smtpConfig.admin_notify).trim() : '';
    if (adminNotify) {
        const adminMail = await sendSmtpMail({
            to: adminNotify,
            subject: 'SimpliPharma — New retailer registration pending',
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2196F3;">New retailer registration</h2>
            <p>Review pending requests in Admin → Pending Retailers.</p>
            <ul>
              <li><strong>Shop / name:</strong> ${String(shopLabel)}</li>
              <li><strong>Email:</strong> ${retailerEmail || 'not provided'}</li>
              <li><strong>Request ID:</strong> ${requestId}</li>
            </ul>
          </div>`,
        });
        if (!adminMail.ok)
            console.error('Admin notify email failed:', adminMail.error);
    }
    return null;
});
function getPanelLoginUrl() {
    const cfg = functions.config().app;
    const base = ((cfg === null || cfg === void 0 ? void 0 : cfg.panel_url) || 'http://localhost:3001').replace(/\/$/, '');
    return base.endsWith('/login') ? base : `${base}/login`;
}
/** Continue URL after Firebase password reset for Sales Officer (mobile); configurable via `app.so_password_reset_continue_url`. */
function getSalesOfficerPasswordResetContinueUrl() {
    var _a;
    const cfg = functions.config().app;
    const custom = (_a = cfg === null || cfg === void 0 ? void 0 : cfg.so_password_reset_continue_url) === null || _a === void 0 ? void 0 : _a.trim();
    if (custom)
        return custom.replace(/\/$/, '');
    return getPanelLoginUrl();
}
async function generatePasswordResetLinkWithFallback(email, continueUrl, logLabel) {
    try {
        return await admin.auth().generatePasswordResetLink(email, {
            url: continueUrl,
            handleCodeInApp: false,
        });
    }
    catch (err) {
        const message = String((err === null || err === void 0 ? void 0 : err.message) || '');
        if (/allowlist|allow-list|authoriz|domain/i.test(message)) {
            console.warn(`${logLabel}: continue URL "${continueUrl}" not allowlisted; falling back to default action handler.`);
            return admin.auth().generatePasswordResetLink(email);
        }
        throw err;
    }
}
/** Continue URL after Firebase password reset for a retailer (mobile app); configurable via `app.retailer_password_reset_continue_url`. */
function getRetailerPasswordResetContinueUrl() {
    var _a;
    const cfg = functions.config().app;
    const custom = (_a = cfg === null || cfg === void 0 ? void 0 : cfg.retailer_password_reset_continue_url) === null || _a === void 0 ? void 0 : _a.trim();
    if (custom)
        return custom.replace(/\/$/, '');
    return getPanelLoginUrl();
}
function getPanelSupportInboxUrl() {
    const cfg = functions.config().app;
    let base = ((cfg === null || cfg === void 0 ? void 0 : cfg.panel_url) || 'http://localhost:3001').replace(/\/$/, '');
    base = base.replace(/\/login$/i, '');
    return `${base}/support`;
}
/** Optional override: `firebase functions:config:set support.notify_emails="a@x.com,b@x.com"` */
async function collectSupportNotifyEmails() {
    const cfg = functions.config().support;
    const fromConfig = String((cfg === null || cfg === void 0 ? void 0 : cfg.notify_emails) || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes('@'));
    if (fromConfig.length)
        return [...new Set(fromConfig)];
    const out = new Set();
    try {
        const snap = await admin
            .firestore()
            .collection('users')
            .where('role', 'in', ['admin', 'Admin'])
            .get();
        snap.docs.forEach((d) => {
            var _a;
            const e = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.email;
            if (typeof e === 'string' && e.includes('@'))
                out.add(e.trim().toLowerCase());
        });
    }
    catch (e) {
        console.warn('collectSupportNotifyEmails: query failed', e);
    }
    return Array.from(out);
}
async function isActivePanelUserByEmail(email) {
    var _a;
    try {
        const userRecord = await admin.auth().getUserByEmail(email.trim());
        const role = await (0, panelAuth_1.getUserRole)(userRecord.uid);
        if (!(0, panelAuth_1.isPanelRole)(role))
            return false;
        const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
        return userDoc.exists && ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.isActive) !== false;
    }
    catch (_b) {
        return false;
    }
}
/**
 * Send password reset link via SMTP (Gmail) for admin / operations panel users.
 * Uses Firebase Admin generatePasswordResetLink + existing smtp.* Functions config.
 */
exports.sendPanelPasswordResetEmail = functions.https.onCall(async (data, context) => {
    var _a;
    let email = String((data === null || data === void 0 ? void 0 : data.email) || '').trim();
    if (!email && context.auth) {
        try {
            const userRecord = await admin.auth().getUser(context.auth.uid);
            email = String(userRecord.email || '').trim();
        }
        catch (_b) {
            email = '';
        }
    }
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Email is required');
    }
    const genericMessage = 'If this email is registered for the admin or operations panel, you will receive a reset link shortly.';
    const isPanelUser = await isActivePanelUserByEmail(email);
    if (!isPanelUser) {
        return { success: true, message: genericMessage, emailSent: false };
    }
    if (context.auth) {
        const callerRole = await (0, panelAuth_1.getUserRole)(context.auth.uid);
        if (!(0, panelAuth_1.isAdminOrOperationsRole)(callerRole)) {
            throw new functions.https.HttpsError('permission-denied', 'Panel access required');
        }
        const caller = await admin.auth().getUser(context.auth.uid);
        if (((_a = caller.email) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== email.toLowerCase()) {
            throw new functions.https.HttpsError('permission-denied', 'You can only request a reset for your own account');
        }
    }
    let resetLink;
    try {
        resetLink = await admin.auth().generatePasswordResetLink(email, {
            url: getPanelLoginUrl(),
            handleCodeInApp: false,
        });
    }
    catch (err) {
        console.error('generatePasswordResetLink failed:', err === null || err === void 0 ? void 0 : err.message);
        throw new functions.https.HttpsError('internal', 'Could not generate password reset link');
    }
    const mail = await sendSmtpMail({
        to: email,
        subject: 'SimpliPharma — Reset your panel password',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Password reset</h2>
        <p>We received a request to reset the password for your SimpliPharma admin/operations panel account.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}"
             style="background: #00a99d; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
            Reset password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Or copy this link into your browser:</p>
        <p style="word-break: break-all; font-size: 13px; color: #333;">${escapeHtmlText(resetLink)}</p>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">If you did not request this, you can ignore this email. The link expires after a short time.</p>
      </div>
    `,
    });
    if (!mail.ok) {
        throw new functions.https.HttpsError('failed-precondition', mail.error || 'SMTP is not configured. Set smtp.user and smtp.password in Firebase Functions config.');
    }
    return {
        success: true,
        message: 'Password reset link sent to your email.',
        emailSent: true,
    };
});
/**
 * Admin only: send a password reset link to a Sales Officer’s email (mobile app account).
 * Requires SMTP (same as other transactional emails).
 */
exports.sendSalesOfficerPasswordResetEmail = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdmin)(context.auth.uid);
    }
    catch (_b) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const rawEmail = String((data === null || data === void 0 ? void 0 : data.email) || '').trim();
    if (!rawEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Email is required');
    }
    let userRecord;
    try {
        userRecord = await admin.auth().getUserByEmail(rawEmail);
    }
    catch (_c) {
        throw new functions.https.HttpsError('not-found', 'No user found with this email');
    }
    const role = await (0, panelAuth_1.getUserRole)(userRecord.uid);
    if (!(0, panelAuth_1.isSalesOfficerRole)(role)) {
        throw new functions.https.HttpsError('failed-precondition', 'This email is not a Sales Officer account');
    }
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.isActive) === false) {
        throw new functions.https.HttpsError('failed-precondition', 'This Sales Officer account is inactive');
    }
    const email = String(userRecord.email || rawEmail).trim();
    let resetLink;
    try {
        resetLink = await generatePasswordResetLinkWithFallback(email, getSalesOfficerPasswordResetContinueUrl(), 'sendSalesOfficerPasswordResetEmail');
    }
    catch (err) {
        console.error('sendSalesOfficerPasswordResetEmail: generatePasswordResetLink failed:', err === null || err === void 0 ? void 0 : err.message);
        throw new functions.https.HttpsError('internal', 'Could not generate password reset link');
    }
    const mail = await sendSmtpMail({
        to: email,
        subject: 'SimpliPharma — Reset your Sales Officer password',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Password reset</h2>
        <p>An administrator requested a password reset for your SimpliPharma Sales Officer (mobile) account.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}"
             style="background: #00a99d; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
            Choose a new password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Or copy this link into your browser:</p>
        <p style="word-break: break-all; font-size: 13px; color: #333;">${escapeHtmlText(resetLink)}</p>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">If you did not expect this, contact your administrator. The link expires after a short time.</p>
      </div>
    `,
    });
    if (!mail.ok) {
        throw new functions.https.HttpsError('failed-precondition', mail.error || 'SMTP is not configured. Set smtp.user and smtp.password in Firebase Functions config.');
    }
    return {
        success: true,
        message: 'Password reset link sent to the Sales Officer email.',
        emailSent: true,
    };
});
/**
 * Admin/operations only: send a password reset link to a retailer’s email (mobile app account).
 * The retailer has no self-service reset in the mobile app, so the admin triggers it here.
 * Requires SMTP (same as other transactional emails).
 */
exports.sendRetailerPasswordResetEmail = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        await (0, panelAuth_1.assertAdminOrOperations)(context.auth.uid);
    }
    catch (_b) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }
    const rawEmail = String((data === null || data === void 0 ? void 0 : data.email) || '').trim();
    if (!rawEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Email is required');
    }
    let userRecord;
    try {
        userRecord = await admin.auth().getUserByEmail(rawEmail);
    }
    catch (_c) {
        throw new functions.https.HttpsError('not-found', 'No user found with this email');
    }
    const role = await (0, panelAuth_1.getUserRole)(userRecord.uid);
    if (!(0, panelAuth_1.isRetailerRole)(role)) {
        throw new functions.https.HttpsError('failed-precondition', 'This email is not a retailer account');
    }
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.isActive) === false) {
        throw new functions.https.HttpsError('failed-precondition', 'This retailer account is inactive');
    }
    const email = String(userRecord.email || rawEmail).trim();
    let resetLink;
    try {
        const continueUrl = getRetailerPasswordResetContinueUrl();
        resetLink = await generatePasswordResetLinkWithFallback(email, continueUrl, 'sendRetailerPasswordResetEmail');
    }
    catch (err) {
        console.error('sendRetailerPasswordResetEmail: generatePasswordResetLink failed:', err === null || err === void 0 ? void 0 : err.message);
        throw new functions.https.HttpsError('internal', 'Could not generate password reset link');
    }
    const mail = await sendSmtpMail({
        to: email,
        subject: 'SimpliPharma — Reset your password',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Password reset</h2>
        <p>An administrator requested a password reset for your SimpliPharma (mobile app) account.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}"
             style="background: #00a99d; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
            Choose a new password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Or copy this link into your browser:</p>
        <p style="word-break: break-all; font-size: 13px; color: #333;">${escapeHtmlText(resetLink)}</p>
        <p style="color: #666; font-size: 12px; margin-top: 24px;">If you did not expect this, contact your administrator. The link expires after a short time.</p>
      </div>
    `,
    });
    if (!mail.ok) {
        throw new functions.https.HttpsError('failed-precondition', mail.error || 'SMTP is not configured. Set smtp.user and smtp.password in Firebase Functions config.');
    }
    return {
        success: true,
        message: 'Password reset link sent to the retailer email.',
        emailSent: true,
    };
});
/** Notify admins / ops by email when a retailer creates an in-app support ticket (Phase 1). */
exports.onSupportTicketCreated = functions.firestore
    .document('support_tickets/{ticketId}')
    .onCreate(async (snap, context) => {
    const data = snap.data();
    const ticketId = context.params.ticketId;
    const recipients = await collectSupportNotifyEmails();
    if (!recipients.length) {
        console.warn('onSupportTicketCreated: no notify emails (set support.notify_emails or add admin users with email)');
        return null;
    }
    const subject = `SimpliPharma — New support ticket ${ticketId.slice(0, 8)}`;
    const preview = escapeHtmlText(String(data.lastMessagePreview || data.subject || '').slice(0, 280));
    const who = escapeHtmlText(String(data.userDisplayLabel || data.userEmail || data.userId || 'User'));
    const inboxUrl = escapeHtmlText(getPanelSupportInboxUrl());
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">New support ticket</h2>
        <p><strong>From:</strong> ${who}</p>
        <p><strong>Email:</strong> ${escapeHtmlText(String(data.userEmail || ''))}</p>
        <p><strong>Preview:</strong></p>
        <p style="background:#f5f5f5;padding:12px;border-radius:6px;">${preview || '—'}</p>
        <p style="margin:24px 0;">
          <a href="${inboxUrl}" style="background:#00a99d;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Open support inbox</a>
        </p>
        <p style="color:#666;font-size:12px;">Ticket id: ${escapeHtmlText(ticketId)}</p>
      </div>`;
    for (const to of recipients) {
        const mail = await sendSmtpMail({ to, subject, html });
        if (!mail.ok)
            console.error('onSupportTicketCreated: failed for', to, mail.error);
    }
    return null;
});
/** Email the app user when an admin posts a reply in the support thread. */
exports.onSupportThreadAdminMessageCreated = functions.firestore
    .document('support_threads/{userId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
    var _a;
    const msg = snap.data();
    if (!msg || msg.from !== 'admin')
        return null;
    const userId = context.params.userId;
    const text = String(msg.text || '').trim();
    if (!text)
        return null;
    let email = null;
    try {
        const doc = await admin.firestore().collection('users').doc(userId).get();
        const e = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.email;
        if (typeof e === 'string' && e.includes('@'))
            email = e.trim();
    }
    catch (e) {
        console.warn('onSupportThreadAdminMessageCreated: user doc', e);
    }
    if (!email) {
        try {
            const rec = await admin.auth().getUser(userId);
            if (rec.email)
                email = rec.email;
        }
        catch (e) {
            console.warn('onSupportThreadAdminMessageCreated: auth user', e);
        }
    }
    if (!email) {
        console.warn('onSupportThreadAdminMessageCreated: no email for user', userId);
        return null;
    }
    const excerpt = escapeHtmlText(text.length > 400 ? `${text.slice(0, 400)}…` : text);
    const subject = 'SimpliPharma — Support replied to your message';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">You have a reply from support</h2>
        <p>Open the SimpliPharma app and tap <strong>Help & support</strong> to view the full conversation.</p>
        <div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0;border-left:4px solid #00a99d;">
          ${excerpt}
        </div>
        <p style="color:#666;font-size:12px;">This is an automated message. Please do not reply directly to this email unless instructed.</p>
      </div>`;
    const mail = await sendSmtpMail({ to: email, subject, html });
    if (!mail.ok)
        console.error('onSupportThreadAdminMessageCreated: SMTP failed', mail.error);
    return null;
});
var bulkMedicineJob_1 = require("./bulkMedicineJob");
Object.defineProperty(exports, "onBulkMedicineJobCreated", { enumerable: true, get: function () { return bulkMedicineJob_1.onBulkMedicineJobCreated; } });
const MAX_ORDER_INVOICE_PDF_BYTES = 12 * 1024 * 1024;
const MAX_ORDER_INVOICE_CSV_BYTES = 8 * 1024 * 1024;
const MAX_CREDIT_NOTE_PDF_BYTES = 12 * 1024 * 1024;
function decodeDataUriBase64(payload) {
    let s = typeof payload === 'string' ? payload.trim() : '';
    if (!s)
        return '';
    if (s.includes(',')) {
        s = s.split(',').pop() || '';
    }
    return s;
}
/**
 * Callable: admin/operations uploads a freshly generated order-invoice PDF; we email it to order.retailerEmail.
 * SMTP must be configured (smtp.user / smtp.password) like other transactional mail.
 */
exports.sendOrderInvoicePdfEmail = functions
    .runWith({ memory: '512MB', timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    try {
        await (0, panelAuth_1.assertAdminOrOperations)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }
    const orderId = typeof (data === null || data === void 0 ? void 0 : data.orderId) === 'string' ? data.orderId.trim() : '';
    let pdfBase64 = decodeDataUriBase64(typeof (data === null || data === void 0 ? void 0 : data.pdfBase64) === 'string' ? data.pdfBase64 : '');
    const csvBase64Payload = typeof (data === null || data === void 0 ? void 0 : data.invoiceCsvBase64) === 'string'
        ? String(data.invoiceCsvBase64)
        : typeof (data === null || data === void 0 ? void 0 : data.csvBase64) === 'string'
            ? String(data.csvBase64)
            : '';
    let csvBase64Decoded = csvBase64Payload.trim()
        ? decodeDataUriBase64(csvBase64Payload)
        : '';
    /** PDF attachment name (callable clients should send pdfFileName; fileName retained for compat). */
    const requestedPdfFileName = typeof (data === null || data === void 0 ? void 0 : data.pdfFileName) === 'string'
        ? data.pdfFileName.trim()
        : typeof (data === null || data === void 0 ? void 0 : data.fileName) === 'string'
            ? data.fileName.trim()
            : '';
    const requestedCsvFileName = typeof (data === null || data === void 0 ? void 0 : data.invoiceCsvFileName) === 'string'
        ? data.invoiceCsvFileName.trim()
        : typeof (data === null || data === void 0 ? void 0 : data.csvFileName) === 'string'
            ? data.csvFileName.trim()
            : '';
    if (!orderId || !pdfBase64) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId and pdfBase64 are required');
    }
    let buffer;
    try {
        buffer = Buffer.from(pdfBase64, 'base64');
    }
    catch (_b) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid pdfBase64 encoding');
    }
    const header = buffer.slice(0, 5).toString('ascii');
    if (buffer.length < 128 || header.indexOf('%PDF') !== 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Uploaded payload is not a valid PDF');
    }
    if (buffer.length > MAX_ORDER_INVOICE_PDF_BYTES) {
        throw new functions.https.HttpsError('invalid-argument', `PDF exceeds ${MAX_ORDER_INVOICE_PDF_BYTES / (1024 * 1024)}MB limit`);
    }
    /** Validated CSV body for the second attachment (UTF-8). */
    let invoiceCsvUtf8Text;
    let invoiceCsvAttachmentName;
    if (csvBase64Decoded) {
        let csvDecodedBuffer;
        try {
            csvDecodedBuffer = Buffer.from(csvBase64Decoded, 'base64');
        }
        catch (_c) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid invoice CSV base64 encoding');
        }
        const looksPdf = csvDecodedBuffer.length >= 4 &&
            csvDecodedBuffer[0] === 0x25 &&
            csvDecodedBuffer[1] === 0x50 &&
            csvDecodedBuffer[2] === 0x44 &&
            csvDecodedBuffer[3] === 0x46;
        if (looksPdf) {
            throw new functions.https.HttpsError('invalid-argument', 'Invoice CSV attachment is not CSV (payload looks like a PDF). Ensure the CSV data URI/body is sent separately from the PDF.');
        }
        if (csvDecodedBuffer.length < 16 ||
            csvDecodedBuffer.length > MAX_ORDER_INVOICE_CSV_BYTES) {
            throw new functions.https.HttpsError('invalid-argument', 'CSV attachment is invalid or exceeds size limit');
        }
        const csvText = csvDecodedBuffer.toString('utf8');
        const looksCsv = csvText.includes('PRODUCT NAME') || csvText.includes('Company Name');
        const hasNull = csvDecodedBuffer.includes(0);
        if (!looksCsv || hasNull) {
            throw new functions.https.HttpsError('invalid-argument', 'Uploaded CSV attachment does not look like a UTF-8 invoice export');
        }
        invoiceCsvUtf8Text = csvText;
        invoiceCsvAttachmentName =
            requestedCsvFileName &&
                /^[a-zA-Z0-9][a-zA-Z0-9._()-]*\.csv$/i.test(requestedCsvFileName)
                ? requestedCsvFileName
                : `order-invoice-${orderId.slice(0, 32)}.csv`;
    }
    const snap = await admin.firestore().collection('orders').doc(orderId).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    const od = snap.data() || {};
    const toRaw = od.retailerEmail;
    const toEmail = typeof toRaw === 'string'
        ? toRaw.trim().toLowerCase()
        : '';
    const retailerName = od.retailerName != null ? String(od.retailerName).trim() : '';
    const shopLabel = retailerName ? escapeHtmlText(retailerName) : 'there';
    if (!toEmail || !toEmail.includes('@')) {
        throw new functions.https.HttpsError('failed-precondition', 'This order has no retailer email — update retailerEmail before emailing the invoice.');
    }
    const invNo = typeof od.invoiceNumber === 'string' && od.invoiceNumber.trim()
        ? od.invoiceNumber.trim()
        : orderId;
    const subject = `SimpliPharma — Tax invoice ${invNo}`;
    const safePdfFile = requestedPdfFileName &&
        /^[a-zA-Z0-9][a-zA-Z0-9._()-]*\.pdf$/i.test(requestedPdfFileName)
        ? requestedPdfFileName
        : `order-invoice-${orderId.slice(0, 32)}.pdf`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hello ${shopLabel},</p>
        <p>Your tax invoice <strong>${escapeHtmlText(invNo)}</strong> is attached${invoiceCsvUtf8Text ? ' as a PDF and a CSV spreadsheet' : ' as a PDF'}.</p>
        <p style="color:#666;font-size:12px;">If you did not expect this email, please contact your sales representative.</p>
      </div>`;
    const mail = await sendSmtpMail({
        to: toEmail,
        subject,
        html,
        attachments: [
            {
                filename: safePdfFile,
                content: buffer,
                contentType: 'application/pdf',
                contentDisposition: 'attachment',
            },
            ...(invoiceCsvUtf8Text && invoiceCsvAttachmentName
                ? [
                    {
                        filename: invoiceCsvAttachmentName,
                        content: invoiceCsvUtf8Text,
                        contentType: 'text/csv; charset=UTF-8',
                        encoding: 'utf8',
                        contentDisposition: 'attachment',
                    },
                ]
                : []),
        ],
    });
    if (!mail.ok) {
        console.error('sendOrderInvoicePdfEmail: SMTP failed', mail.error);
        throw new functions.https.HttpsError('internal', mail.error || 'Could not send email (check SMTP in Functions config)');
    }
    return { ok: true, emailedTo: toEmail };
});
/**
 * Callable: admin/operations uploads a freshly generated credit-note PDF; we email it to credit_note.retailerEmail.
 */
exports.sendCreditNotePdfEmail = functions
    .runWith({ memory: '512MB', timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    try {
        await (0, panelAuth_1.assertAdminOrOperations)(context.auth.uid);
    }
    catch (_a) {
        throw new functions.https.HttpsError('permission-denied', 'Admin or operations access required');
    }
    const creditNoteId = typeof (data === null || data === void 0 ? void 0 : data.creditNoteId) === 'string' ? data.creditNoteId.trim() : '';
    const pdfBase64 = decodeDataUriBase64(typeof (data === null || data === void 0 ? void 0 : data.pdfBase64) === 'string' ? data.pdfBase64 : '');
    const requestedPdfFileName = typeof (data === null || data === void 0 ? void 0 : data.pdfFileName) === 'string' ? data.pdfFileName.trim() : '';
    if (!creditNoteId || !pdfBase64) {
        throw new functions.https.HttpsError('invalid-argument', 'creditNoteId and pdfBase64 are required');
    }
    let buffer;
    try {
        buffer = Buffer.from(pdfBase64, 'base64');
    }
    catch (_b) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid pdfBase64 encoding');
    }
    const header = buffer.slice(0, 5).toString('ascii');
    if (buffer.length < 128 || header.indexOf('%PDF') !== 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Uploaded payload is not a valid PDF');
    }
    if (buffer.length > MAX_CREDIT_NOTE_PDF_BYTES) {
        throw new functions.https.HttpsError('invalid-argument', `PDF exceeds ${MAX_CREDIT_NOTE_PDF_BYTES / (1024 * 1024)}MB limit`);
    }
    const snap = await admin.firestore().collection('credit_notes').doc(creditNoteId).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Credit note not found');
    }
    const note = snap.data() || {};
    const toRaw = note.retailerEmail;
    const toEmail = typeof toRaw === 'string'
        ? toRaw.trim().toLowerCase()
        : '';
    const retailerName = note.retailerName != null ? String(note.retailerName).trim() : '';
    const shopLabel = retailerName ? escapeHtmlText(retailerName) : 'there';
    if (!toEmail || !toEmail.includes('@')) {
        throw new functions.https.HttpsError('failed-precondition', 'This credit note has no retailer email — update retailerEmail before emailing.');
    }
    const creditNoteNumber = typeof note.creditNoteNumber === 'string' && note.creditNoteNumber.trim()
        ? note.creditNoteNumber.trim()
        : creditNoteId;
    const subject = `SimpliPharma — Credit note ${creditNoteNumber}`;
    const safePdfFile = requestedPdfFileName &&
        /^[a-zA-Z0-9][a-zA-Z0-9._()-]*\.pdf$/i.test(requestedPdfFileName)
        ? requestedPdfFileName
        : `credit-note-${creditNoteNumber.replace(/[^a-zA-Z0-9._()-]/g, '-')}.pdf`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hello ${shopLabel},</p>
        <p>Your credit note <strong>${escapeHtmlText(creditNoteNumber)}</strong> is attached as a PDF.</p>
        <p style="color:#666;font-size:12px;">If you did not expect this email, please contact your sales representative.</p>
      </div>`;
    const mail = await sendSmtpMail({
        to: toEmail,
        subject,
        html,
        attachments: [
            {
                filename: safePdfFile,
                content: buffer,
                contentType: 'application/pdf',
                contentDisposition: 'attachment',
            },
        ],
    });
    if (!mail.ok) {
        console.error('sendCreditNotePdfEmail: SMTP failed', mail.error);
        throw new functions.https.HttpsError('internal', mail.error || 'Could not send email (check SMTP in Functions config)');
    }
    return { ok: true, emailedTo: toEmail };
});
var typesenseMedicines_1 = require("./typesenseMedicines");
Object.defineProperty(exports, "onMedicineWriteTypesense", { enumerable: true, get: function () { return typesenseMedicines_1.onMedicineWriteTypesense; } });
Object.defineProperty(exports, "searchMedicinesTypesense", { enumerable: true, get: function () { return typesenseMedicines_1.searchMedicinesTypesense; } });
Object.defineProperty(exports, "adminReindexMedicinesTypesense", { enumerable: true, get: function () { return typesenseMedicines_1.adminReindexMedicinesTypesense; } });
var typesenseOrders_1 = require("./typesenseOrders");
Object.defineProperty(exports, "onOrderWriteTypesense", { enumerable: true, get: function () { return typesenseOrders_1.onOrderWriteTypesense; } });
Object.defineProperty(exports, "searchOrdersTypesense", { enumerable: true, get: function () { return typesenseOrders_1.searchOrdersTypesense; } });
Object.defineProperty(exports, "adminReindexOrdersTypesense", { enumerable: true, get: function () { return typesenseOrders_1.adminReindexOrdersTypesense; } });
var typesensePurchaseInvoices_1 = require("./typesensePurchaseInvoices");
Object.defineProperty(exports, "onPurchaseInvoiceWriteTypesense", { enumerable: true, get: function () { return typesensePurchaseInvoices_1.onPurchaseInvoiceWriteTypesense; } });
Object.defineProperty(exports, "searchPurchaseInvoicesTypesense", { enumerable: true, get: function () { return typesensePurchaseInvoices_1.searchPurchaseInvoicesTypesense; } });
Object.defineProperty(exports, "adminReindexPurchaseInvoicesTypesense", { enumerable: true, get: function () { return typesensePurchaseInvoices_1.adminReindexPurchaseInvoicesTypesense; } });
var typesenseCreditNotes_1 = require("./typesenseCreditNotes");
Object.defineProperty(exports, "onCreditNoteWriteTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.onCreditNoteWriteTypesense; } });
Object.defineProperty(exports, "searchCreditNotesTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.searchCreditNotesTypesense; } });
Object.defineProperty(exports, "adminReindexCreditNotesTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.adminReindexCreditNotesTypesense; } });
Object.defineProperty(exports, "onDebitNoteWriteTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.onDebitNoteWriteTypesense; } });
Object.defineProperty(exports, "searchDebitNotesTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.searchDebitNotesTypesense; } });
Object.defineProperty(exports, "adminReindexDebitNotesTypesense", { enumerable: true, get: function () { return typesenseCreditNotes_1.adminReindexDebitNotesTypesense; } });
var typesenseProductDemands_1 = require("./typesenseProductDemands");
Object.defineProperty(exports, "onProductDemandWriteTypesense", { enumerable: true, get: function () { return typesenseProductDemands_1.onProductDemandWriteTypesense; } });
Object.defineProperty(exports, "searchProductDemandsTypesense", { enumerable: true, get: function () { return typesenseProductDemands_1.searchProductDemandsTypesense; } });
Object.defineProperty(exports, "adminReindexProductDemandsTypesense", { enumerable: true, get: function () { return typesenseProductDemands_1.adminReindexProductDemandsTypesense; } });
//# sourceMappingURL=index.js.map
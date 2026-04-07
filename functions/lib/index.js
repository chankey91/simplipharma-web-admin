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
exports.onBulkMedicineJobCreated = exports.onRetailerRegistrationRequestCreated = exports.rejectRetailerRequest = exports.approveRetailerRequest = exports.createStoreUser = exports.sendVendorPasswordEmail = exports.sendVendorPasswordEmailHttp = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
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
    console.log('Creating SMTP transporter with config:', {
        host: 'smtp.gmail.com',
        port: 587,
        user: config.user,
        hasPassword: !!config.password
    });
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
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
/** Single path for transactional mail (logs failures, does not throw). */
async function sendSmtpMail(options) {
    try {
        const smtpConfig = functions.config().smtp;
        if (!(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) || !(smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password)) {
            console.warn('sendSmtpMail: smtp.user or smtp.password missing in Functions config');
            return { ok: false, error: 'SMTP not configured' };
        }
        const transporter = getTransporter();
        await transporter.sendMail({
            from: smtpConfig.user,
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
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
    var _a;
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
        // Check if user is admin
        const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
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
    var _a, _b, _c, _d;
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
        if (!userDoc.exists || ((_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.role) !== 'admin') {
            console.error('User is not admin:', {
                exists: userDoc.exists,
                role: (_d = userDoc.data()) === null || _d === void 0 ? void 0 : _d.role
            });
            throw new functions.https.HttpsError('permission-denied', 'Admin access required');
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
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }
    const { email, password, storeData } = data || {};
    if (!email || !password) {
        throw new functions.https.HttpsError('invalid-argument', 'Email and password are required');
    }
    const role = (storeData === null || storeData === void 0 ? void 0 : storeData.role) || 'retailer';
    const displayName = (storeData === null || storeData === void 0 ? void 0 : storeData.displayName) || (storeData === null || storeData === void 0 ? void 0 : storeData.shopName) || email;
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
            const smtpConfig = functions.config().smtp;
            if ((smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.user) && (smtpConfig === null || smtpConfig === void 0 ? void 0 : smtpConfig.password)) {
                const transporter = getTransporter();
                await transporter.sendMail({
                    from: smtpConfig.user,
                    to: email,
                    subject: role === 'salesOfficer' ? 'Your SimpliPharma Sales Officer Account' : 'Your SimpliPharma Store Account',
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
              <p>Your ${role === 'salesOfficer' ? 'Sales Officer' : 'store'} account has been created.</p>
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
 * Approve retailer registration request: create user account from pending request
 */
exports.approveRetailerRequest = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'admin') {
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
        const approvalMail = await sendSmtpMail({
            to: cred.email,
            subject: 'Your SimpliPharma Store Account - Approved',
            html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
              <p>Your retailer registration has been approved. Your account is now active.</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Email:</strong> ${cred.email}</p>
                <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${cred.password}</code></p>
              </div>
              <p><strong>Important:</strong> Please change your password on first login.</p>
            </div>
          `,
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
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'admin') {
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
            const soEmail = soDoc.exists ? String(((_b = soDoc.data()) === null || _b === void 0 ? void 0 : _b.email) || '').trim() : '';
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
var bulkMedicineJob_1 = require("./bulkMedicineJob");
Object.defineProperty(exports, "onBulkMedicineJobCreated", { enumerable: true, get: function () { return bulkMedicineJob_1.onBulkMedicineJobCreated; } });
//# sourceMappingURL=index.js.map
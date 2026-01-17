"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVendorPasswordEmail = exports.sendVendorPasswordEmailHttp = void 0;
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
//# sourceMappingURL=index.js.map
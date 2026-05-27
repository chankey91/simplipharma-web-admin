import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import {
  assertAdmin,
  assertAdminOrOperations,
  getUserRole,
  isAdminOrOperationsRole,
  isPanelRole,
  isSalesOfficerRole,
} from './panelAuth';

admin.initializeApp();

// Helper function to set CORS headers
const setCorsHeaders = (res: functions.Response) => {
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
function resolveRetailerRequestCredentials(req: Record<string, any>): { email: string; password: string } | null {
  const emailRaw = req.email ?? req.retailerEmail ?? req.contactEmail ?? '';
  const email = String(emailRaw).trim();
  const passwordRaw =
    req.password ?? req.initialPassword ?? req.plainPassword ?? req.tempPassword ?? '';
  const password = String(passwordRaw);
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

function getRetailerRegistrationEmail(req: Record<string, any>): string | null {
  const email = String(req.email ?? req.retailerEmail ?? req.contactEmail ?? '').trim();
  return email || null;
}

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Single path for transactional mail (logs failures; optional PDF attachment). */
async function sendSmtpMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: {
    filename: string;
    content: Buffer | string;
    contentType?: string;
    contentDisposition?: 'attachment' | 'inline';
    encoding?: string;
  }[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const smtpConfig = functions.config().smtp;
    if (!smtpConfig?.user || !smtpConfig?.password) {
      console.warn('sendSmtpMail: smtp.user or smtp.password missing in Functions config');
      return { ok: false, error: 'SMTP not configured' };
    }
    const transporter = getTransporter();
    await transporter.sendMail({
      from: smtpConfig.user,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.attachments?.length
        ? { attachments: options.attachments.map((a) => ({ ...a })) }
        : {}),
    });
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = err?.responseCode || err?.code;
    console.error('sendSmtpMail failed:', { msg, code, to: options.to });
    return { ok: false, error: msg };
  }
}

/**
 * Send password email to vendor (HTTP version with CORS)
 * Alternative to callable function with explicit CORS handling
 */
export const sendVendorPasswordEmailHttp = functions.https.onRequest(async (req, res) => {
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
    } catch (error: any) {
      console.error('Token verification failed:', error);
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    const role = await getUserRole(decodedToken.uid);
    if (!isAdminOrOperationsRole(role)) {
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
  } catch (error: any) {
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
export const sendVendorPasswordEmail = functions.https.onCall(async (data, context) => {
  try {
    console.log('sendVendorPasswordEmail called with data:', {
      email: data?.email,
      hasPassword: !!data?.password,
      vendorName: data?.vendorName,
      hasAuth: !!context.auth,
      authUid: context.auth?.uid
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
        role: userDoc.data()?.role
      });
    } catch (error: any) {
      console.error('Error fetching user document:', error);
      throw new functions.https.HttpsError('internal', 'Failed to verify user permissions');
    }

    const callerRole = userDoc.data()?.role;
    if (!userDoc.exists || !isAdminOrOperationsRole(callerRole)) {
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
      hasUser: !!smtpConfig?.user,
      hasPassword: !!smtpConfig?.password,
      user: smtpConfig?.user || 'NOT SET'
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
    } catch (verifyError: any) {
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
  } catch (error: any) {
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
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Could not connect to SMTP server. Please check your network connection.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new functions.https.HttpsError('internal', errorMessage);
  }
});

/**
 * Create store/retailer or sales officer user (Firebase Auth + Firestore)
 */
export const createStoreUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await assertAdmin(context.auth.uid);
  } catch {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { email, password, storeData } = data || {};
  if (!email || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Email and password are required');
  }

  const role = storeData?.role || 'retailer';
  const displayName = storeData?.displayName || storeData?.shopName || email;

  const allowedRoles = ['retailer', 'salesOfficer', 'operations'];
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`);
  }

  const accountLabel =
    role === 'salesOfficer'
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

    const { role: _r, ...restStoreData } = storeData || {};
    // Firestore rejects undefined - strip them
    const cleanData: Record<string, any> = {};
    for (const [k, v] of Object.entries(restStoreData)) {
      if (v !== undefined) cleanData[k] = v;
    }
    cleanData.uid = userRecord.uid;
    cleanData.email = email;
    cleanData.role = role;
    cleanData.mustResetPassword = true;
    cleanData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    cleanData.isActive = storeData?.isActive !== false;
    await admin.firestore().collection('users').doc(userRecord.uid).set(cleanData);

    // Send password email if SMTP configured
    let emailSent = false;
    try {
      const smtpConfig = functions.config().smtp;
      if (smtpConfig?.user && smtpConfig?.password) {
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
    } catch (emailErr: any) {
      console.error('Email send failed:', emailErr?.message);
      // Return success with emailSent: false so admin knows to share password manually
    }

    return { success: true, uid: userRecord.uid, id: userRecord.uid, emailSent };
  } catch (error: any) {
    console.error('createStoreUser error:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to create user');
  }
});

/**
 * Approve retailer registration request: create user account from pending request
 */
export const approveRetailerRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await assertAdmin(context.auth.uid);
  } catch {
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

  const req = reqDoc.data() as any;
  if (req.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', 'Request already processed');
  }

  const cred = resolveRetailerRequestCredentials(req);
  if (!cred) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Request missing email or password (expected email/retailerEmail and password/initialPassword on the registration document)'
    );
  }

  try {
    const userRecord = await admin.auth().createUser({
      email: cred.email,
      password: cred.password,
      displayName: req.displayName || req.shopName || cred.email,
      emailVerified: false,
      disabled: false,
    });

    const userData: Record<string, any> = {
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
      if (v === undefined) delete userData[k];
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
  } catch (error: any) {
    console.error('approveRetailerRequest error:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to approve request');
  }
});

/**
 * Reject retailer registration: update Firestore and notify retailer + Sales Officer by email.
 */
export const rejectRetailerRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await assertAdmin(context.auth.uid);
  } catch {
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

  const req = reqDoc.data() as any;
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

  let retailerEmailSent: boolean | null = null;
  let salesOfficerEmailSent: boolean | null = null;
  const emailErrors: string[] = [];

  if (retailerEmail) {
    const mail = await sendSmtpMail({
      to: retailerEmail,
      subject: 'SimpliPharma — Retailer registration not approved',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c62828;">Registration update</h2>
          <p>We are unable to approve your retailer registration for <strong>${escapeHtmlText(
            String(shopLabel)
          )}</strong> at this time.</p>
          ${reasonHtml}
          <p>If you have questions, please contact your Sales Officer or SimpliPharma support.</p>
          <p style="color:#666;font-size:12px;">Reference: ${escapeHtmlText(requestId)}</p>
        </div>`,
    });
    retailerEmailSent = mail.ok;
    if (!mail.ok && mail.error) emailErrors.push(`Retailer email: ${mail.error}`);
  } else {
    console.warn('rejectRetailerRequest: no retailer email on request', requestId);
  }

  const soId = req.salesOfficerId;
  if (soId) {
    try {
      const soDoc = await admin.firestore().collection('users').doc(String(soId)).get();
      const soEmail = soDoc.exists ? String(soDoc.data()?.email || '').trim() : '';
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
        if (!mail.ok && mail.error) emailErrors.push(`Sales Officer email: ${mail.error}`);
      } else {
        console.warn('rejectRetailerRequest: Sales Officer has no email', soId);
      }
    } catch (e: any) {
      console.error('rejectRetailerRequest: SO lookup failed', e?.message);
      emailErrors.push(`SO lookup: ${e?.message || String(e)}`);
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
export const onRetailerRegistrationRequestCreated = functions.firestore
  .document('retailer_registration_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as Record<string, any>;
    if (!data || data.status === 'rejected') {
      return null;
    }

    const requestId = context.params.requestId;
    const retailerEmail = String(data.email || data.retailerEmail || data.contactEmail || '').trim();
    const shopLabel = data.shopName || data.displayName || 'your pharmacy';
    const smtpConfig = functions.config().smtp;
    if (!smtpConfig?.user || !smtpConfig?.password) {
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
      if (!ack.ok) console.error('Retailer ack email failed:', ack.error);
    } else {
      console.warn('onRetailerRegistrationRequestCreated: no retailer email on document, skipping retailer ack');
    }

    const soId = data.salesOfficerId;
    if (soId) {
      try {
        const soDoc = await admin.firestore().collection('users').doc(String(soId)).get();
        const soEmail = soDoc.exists ? String(soDoc.data()?.email || '').trim() : '';
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
          if (!soMail.ok) console.error('Sales Officer notify email failed:', soMail.error);
        } else {
          console.warn('onRetailerRegistrationRequestCreated: Sales Officer has no email on users/', soId);
        }
      } catch (e: any) {
        console.error('onRetailerRegistrationRequestCreated: failed to load Sales Officer', e?.message);
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
      if (!adminMail.ok) console.error('Admin notify email failed:', adminMail.error);
    }

    return null;
  });

function getPanelLoginUrl(): string {
  const cfg = functions.config().app as { panel_url?: string } | undefined;
  const base = (cfg?.panel_url || 'http://localhost:3001').replace(/\/$/, '');
  return base.endsWith('/login') ? base : `${base}/login`;
}

/** Continue URL after Firebase password reset for Sales Officer (mobile); configurable via `app.so_password_reset_continue_url`. */
function getSalesOfficerPasswordResetContinueUrl(): string {
  const cfg = functions.config().app as { so_password_reset_continue_url?: string } | undefined;
  const custom = cfg?.so_password_reset_continue_url?.trim();
  if (custom) return custom.replace(/\/$/, '');
  return getPanelLoginUrl();
}

function getPanelSupportInboxUrl(): string {
  const cfg = functions.config().app as { panel_url?: string } | undefined;
  let base = (cfg?.panel_url || 'http://localhost:3001').replace(/\/$/, '');
  base = base.replace(/\/login$/i, '');
  return `${base}/support`;
}

/** Optional override: `firebase functions:config:set support.notify_emails="a@x.com,b@x.com"` */
async function collectSupportNotifyEmails(): Promise<string[]> {
  const cfg = functions.config().support as { notify_emails?: string } | undefined;
  const fromConfig = String(cfg?.notify_emails || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (fromConfig.length) return [...new Set(fromConfig)];

  const out = new Set<string>();
  try {
    const snap = await admin
      .firestore()
      .collection('users')
      .where('role', 'in', ['admin', 'Admin'])
      .get();
    snap.docs.forEach((d) => {
      const e = d.data()?.email;
      if (typeof e === 'string' && e.includes('@')) out.add(e.trim().toLowerCase());
    });
  } catch (e) {
    console.warn('collectSupportNotifyEmails: query failed', e);
  }
  return Array.from(out);
}

async function isActivePanelUserByEmail(email: string): Promise<boolean> {
  try {
    const userRecord = await admin.auth().getUserByEmail(email.trim());
    const role = await getUserRole(userRecord.uid);
    if (!isPanelRole(role)) return false;
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
    return userDoc.exists && userDoc.data()?.isActive !== false;
  } catch {
    return false;
  }
}

/**
 * Send password reset link via SMTP (Gmail) for admin / operations panel users.
 * Uses Firebase Admin generatePasswordResetLink + existing smtp.* Functions config.
 */
export const sendPanelPasswordResetEmail = functions.https.onCall(async (data, context) => {
  let email = String(data?.email || '').trim();
  if (!email && context.auth) {
    try {
      const userRecord = await admin.auth().getUser(context.auth.uid);
      email = String(userRecord.email || '').trim();
    } catch {
      email = '';
    }
  }
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  }

  const genericMessage =
    'If this email is registered for the admin or operations panel, you will receive a reset link shortly.';

  const isPanelUser = await isActivePanelUserByEmail(email);
  if (!isPanelUser) {
    return { success: true, message: genericMessage, emailSent: false };
  }

  if (context.auth) {
    const callerRole = await getUserRole(context.auth.uid);
    if (!isAdminOrOperationsRole(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Panel access required');
    }
    const caller = await admin.auth().getUser(context.auth.uid);
    if (caller.email?.toLowerCase() !== email.toLowerCase()) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'You can only request a reset for your own account'
      );
    }
  }

  let resetLink: string;
  try {
    resetLink = await admin.auth().generatePasswordResetLink(email, {
      url: getPanelLoginUrl(),
      handleCodeInApp: false,
    });
  } catch (err: any) {
    console.error('generatePasswordResetLink failed:', err?.message);
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
    throw new functions.https.HttpsError(
      'failed-precondition',
      mail.error || 'SMTP is not configured. Set smtp.user and smtp.password in Firebase Functions config.'
    );
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
export const sendSalesOfficerPasswordResetEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await assertAdmin(context.auth.uid);
  } catch {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const rawEmail = String(data?.email || '').trim();
  if (!rawEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  }

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(rawEmail);
  } catch {
    throw new functions.https.HttpsError('not-found', 'No user found with this email');
  }

  const role = await getUserRole(userRecord.uid);
  if (!isSalesOfficerRole(role)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This email is not a Sales Officer account'
    );
  }

  const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
  if (!userDoc.exists || userDoc.data()?.isActive === false) {
    throw new functions.https.HttpsError('failed-precondition', 'This Sales Officer account is inactive');
  }

  const email = String(userRecord.email || rawEmail).trim();

  let resetLink: string;
  try {
    resetLink = await admin.auth().generatePasswordResetLink(email, {
      url: getSalesOfficerPasswordResetContinueUrl(),
      handleCodeInApp: false,
    });
  } catch (err: any) {
    console.error('sendSalesOfficerPasswordResetEmail: generatePasswordResetLink failed:', err?.message);
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
    throw new functions.https.HttpsError(
      'failed-precondition',
      mail.error || 'SMTP is not configured. Set smtp.user and smtp.password in Firebase Functions config.'
    );
  }

  return {
    success: true,
    message: 'Password reset link sent to the Sales Officer email.',
    emailSent: true,
  };
});

/** Notify admins / ops by email when a retailer creates an in-app support ticket (Phase 1). */
export const onSupportTicketCreated = functions.firestore
  .document('support_tickets/{ticketId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const ticketId = context.params.ticketId as string;
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
      if (!mail.ok) console.error('onSupportTicketCreated: failed for', to, mail.error);
    }
    return null;
  });

/** Email the app user when an admin posts a reply in the support thread. */
export const onSupportThreadAdminMessageCreated = functions.firestore
  .document('support_threads/{userId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data();
    if (!msg || msg.from !== 'admin') return null;

    const userId = context.params.userId as string;
    const text = String(msg.text || '').trim();
    if (!text) return null;

    let email: string | null = null;
    try {
      const doc = await admin.firestore().collection('users').doc(userId).get();
      const e = doc.data()?.email;
      if (typeof e === 'string' && e.includes('@')) email = e.trim();
    } catch (e) {
      console.warn('onSupportThreadAdminMessageCreated: user doc', e);
    }
    if (!email) {
      try {
        const rec = await admin.auth().getUser(userId);
        if (rec.email) email = rec.email;
      } catch (e) {
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
    if (!mail.ok) console.error('onSupportThreadAdminMessageCreated: SMTP failed', mail.error);
    return null;
  });

export { onBulkMedicineJobCreated } from './bulkMedicineJob';

const MAX_ORDER_INVOICE_PDF_BYTES = 12 * 1024 * 1024;
const MAX_ORDER_INVOICE_CSV_BYTES = 8 * 1024 * 1024;
const MAX_CREDIT_NOTE_PDF_BYTES = 12 * 1024 * 1024;

function decodeDataUriBase64(payload: string): string {
  let s = typeof payload === 'string' ? payload.trim() : '';
  if (!s) return '';
  if (s.includes(',')) {
    s = s.split(',').pop() || '';
  }
  return s;
}

/**
 * Callable: admin/operations uploads a freshly generated order-invoice PDF; we email it to order.retailerEmail.
 * SMTP must be configured (smtp.user / smtp.password) like other transactional mail.
 */
export const sendOrderInvoicePdfEmail = functions
  .runWith({ memory: '512MB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }

    try {
      await assertAdminOrOperations(context.auth.uid);
    } catch {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Admin or operations access required'
      );
    }

    const orderId = typeof data?.orderId === 'string' ? data.orderId.trim() : '';
    let pdfBase64 = decodeDataUriBase64(
      typeof data?.pdfBase64 === 'string' ? data.pdfBase64 : ''
    );
    const csvBase64Payload =
      typeof data?.invoiceCsvBase64 === 'string'
        ? String(data.invoiceCsvBase64)
        : typeof data?.csvBase64 === 'string'
          ? String(data.csvBase64)
          : '';
    let csvBase64Decoded = csvBase64Payload.trim()
      ? decodeDataUriBase64(csvBase64Payload)
      : '';

    /** PDF attachment name (callable clients should send pdfFileName; fileName retained for compat). */
    const requestedPdfFileName =
      typeof data?.pdfFileName === 'string'
        ? data.pdfFileName.trim()
        : typeof data?.fileName === 'string'
          ? data.fileName.trim()
          : '';
    const requestedCsvFileName =
      typeof data?.invoiceCsvFileName === 'string'
        ? data.invoiceCsvFileName.trim()
        : typeof data?.csvFileName === 'string'
          ? data.csvFileName.trim()
          : '';

    if (!orderId || !pdfBase64) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'orderId and pdfBase64 are required'
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(pdfBase64, 'base64');
    } catch {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid pdfBase64 encoding');
    }

    const header = buffer.slice(0, 5).toString('ascii');
    if (buffer.length < 128 || header.indexOf('%PDF') !== 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Uploaded payload is not a valid PDF'
      );
    }

    if (buffer.length > MAX_ORDER_INVOICE_PDF_BYTES) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `PDF exceeds ${MAX_ORDER_INVOICE_PDF_BYTES / (1024 * 1024)}MB limit`
      );
    }

    /** Validated CSV body for the second attachment (UTF-8). */
    let invoiceCsvUtf8Text: string | undefined;
    let invoiceCsvAttachmentName: string | undefined;
    if (csvBase64Decoded) {
      let csvDecodedBuffer: Buffer;
      try {
        csvDecodedBuffer = Buffer.from(csvBase64Decoded, 'base64');
      } catch {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invalid invoice CSV base64 encoding'
        );
      }

      const looksPdf =
        csvDecodedBuffer.length >= 4 &&
        csvDecodedBuffer[0] === 0x25 &&
        csvDecodedBuffer[1] === 0x50 &&
        csvDecodedBuffer[2] === 0x44 &&
        csvDecodedBuffer[3] === 0x46;
      if (looksPdf) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invoice CSV attachment is not CSV (payload looks like a PDF). Ensure the CSV data URI/body is sent separately from the PDF.'
        );
      }

      if (
        csvDecodedBuffer.length < 16 ||
        csvDecodedBuffer.length > MAX_ORDER_INVOICE_CSV_BYTES
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'CSV attachment is invalid or exceeds size limit'
        );
      }

      const csvText = csvDecodedBuffer.toString('utf8');
      const looksCsv =
        csvText.includes('PRODUCT NAME') || csvText.includes('Company Name');
      const hasNull = csvDecodedBuffer.includes(0);
      if (!looksCsv || hasNull) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Uploaded CSV attachment does not look like a UTF-8 invoice export'
        );
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
    const toRaw = od.retailerEmail as unknown;
    const toEmail =
      typeof toRaw === 'string'
        ? toRaw.trim().toLowerCase()
        : '';
    const retailerName =
      od.retailerName != null ? String(od.retailerName).trim() : '';
    const shopLabel = retailerName ? escapeHtmlText(retailerName) : 'there';

    if (!toEmail || !toEmail.includes('@')) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This order has no retailer email — update retailerEmail before emailing the invoice.'
      );
    }

    const invNo =
      typeof od.invoiceNumber === 'string' && od.invoiceNumber.trim()
        ? od.invoiceNumber.trim()
        : orderId;
    const subject = `SimpliPharma — Tax invoice ${invNo}`;
    const safePdfFile =
      requestedPdfFileName &&
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
          contentDisposition: 'attachment' as const,
        },
        ...(invoiceCsvUtf8Text && invoiceCsvAttachmentName
          ? [
              {
                filename: invoiceCsvAttachmentName,
                content: invoiceCsvUtf8Text,
                contentType: 'text/csv; charset=UTF-8',
                encoding: 'utf8',
                contentDisposition: 'attachment' as const,
              },
            ]
          : []),
      ],
    });

    if (!mail.ok) {
      console.error('sendOrderInvoicePdfEmail: SMTP failed', mail.error);
      throw new functions.https.HttpsError(
        'internal',
        mail.error || 'Could not send email (check SMTP in Functions config)'
      );
    }

    return { ok: true, emailedTo: toEmail };
  });

/**
 * Callable: admin/operations uploads a freshly generated credit-note PDF; we email it to credit_note.retailerEmail.
 */
export const sendCreditNotePdfEmail = functions
  .runWith({ memory: '512MB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }

    try {
      await assertAdminOrOperations(context.auth.uid);
    } catch {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Admin or operations access required'
      );
    }

    const creditNoteId =
      typeof data?.creditNoteId === 'string' ? data.creditNoteId.trim() : '';
    const pdfBase64 = decodeDataUriBase64(
      typeof data?.pdfBase64 === 'string' ? data.pdfBase64 : ''
    );
    const requestedPdfFileName =
      typeof data?.pdfFileName === 'string' ? data.pdfFileName.trim() : '';

    if (!creditNoteId || !pdfBase64) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'creditNoteId and pdfBase64 are required'
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(pdfBase64, 'base64');
    } catch {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid pdfBase64 encoding');
    }

    const header = buffer.slice(0, 5).toString('ascii');
    if (buffer.length < 128 || header.indexOf('%PDF') !== 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Uploaded payload is not a valid PDF'
      );
    }

    if (buffer.length > MAX_CREDIT_NOTE_PDF_BYTES) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `PDF exceeds ${MAX_CREDIT_NOTE_PDF_BYTES / (1024 * 1024)}MB limit`
      );
    }

    const snap = await admin.firestore().collection('credit_notes').doc(creditNoteId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Credit note not found');
    }

    const note = snap.data() || {};
    const toRaw = note.retailerEmail as unknown;
    const toEmail =
      typeof toRaw === 'string'
        ? toRaw.trim().toLowerCase()
        : '';
    const retailerName =
      note.retailerName != null ? String(note.retailerName).trim() : '';
    const shopLabel = retailerName ? escapeHtmlText(retailerName) : 'there';

    if (!toEmail || !toEmail.includes('@')) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This credit note has no retailer email — update retailerEmail before emailing.'
      );
    }

    const creditNoteNumber =
      typeof note.creditNoteNumber === 'string' && note.creditNoteNumber.trim()
        ? note.creditNoteNumber.trim()
        : creditNoteId;
    const subject = `SimpliPharma — Credit note ${creditNoteNumber}`;
    const safePdfFile =
      requestedPdfFileName &&
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
          contentDisposition: 'attachment' as const,
        },
      ],
    });

    if (!mail.ok) {
      console.error('sendCreditNotePdfEmail: SMTP failed', mail.error);
      throw new functions.https.HttpsError(
        'internal',
        mail.error || 'Could not send email (check SMTP in Functions config)'
      );
    }

    return { ok: true, emailedTo: toEmail };
  });

export {
  onMedicineWriteTypesense,
  searchMedicinesTypesense,
  adminReindexMedicinesTypesense,
} from './typesenseMedicines';

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

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

/** Single path for transactional mail (logs failures, does not throw). */
async function sendSmtpMail(options: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
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

    // Check if user is admin
    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
    
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
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

    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      console.error('User is not admin:', {
        exists: userDoc.exists,
        role: userDoc.data()?.role
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

  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { email, password, storeData } = data || {};
  if (!email || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Email and password are required');
  }

  const role = storeData?.role || 'retailer';
  const displayName = storeData?.displayName || storeData?.shopName || email;

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

  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
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

  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
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

